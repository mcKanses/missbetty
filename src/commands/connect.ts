import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import yaml from 'yaml';
import inquirer from 'inquirer';

const TRAEFIK_NETWORK = 'traefik_default';
const BETTY_HOSTS_START = '### BETTY DOMAINS START ###';
const BETTY_HOSTS_END = '### BETTY DOMAINS END ###';

const resolveTraefikComposePath = (): string => {
  const candidates = [
    path.resolve(process.cwd(), 'traefik', 'compose.yml'),
    path.resolve(__dirname, '..', '..', 'traefik', 'compose.yml'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  console.error('Kein traefik/compose.yml gefunden. Gesucht in:');
  for (const candidate of candidates) console.error(` - ${candidate}`);
  process.exit(1);
};

const resolveDynamicDir = (composePath: string): string => path.resolve(path.dirname(composePath), 'dynamic');

const ensureProxyRunning = (traefikComposePath: string) => {
  execSync(`docker compose -f "${traefikComposePath}" up -d`, {
    cwd: path.dirname(traefikComposePath),
    stdio: 'inherit',
  });
};

const ensureTraefikNetwork = () => {
  try {
    execSync(`docker network inspect ${TRAEFIK_NETWORK}`, { stdio: 'pipe' });
  } catch {
    execSync(`docker network create ${TRAEFIK_NETWORK}`, { stdio: 'inherit' });
    console.log(`Docker-Netzwerk '${TRAEFIK_NETWORK}' angelegt.`);
  }
};

const connectContainerToNetwork = (containerName: string) => {
  try {
    const info = JSON.parse(
      execSync(`docker inspect ${containerName}`, { stdio: 'pipe' }).toString()
    );
    const networks: Record<string, unknown> = info[0]?.NetworkSettings?.Networks || {};
    if (networks[TRAEFIK_NETWORK]) {
      return; // bereits verbunden
    }
  } catch {
    console.error(`Container '${containerName}' nicht gefunden.`);
    process.exit(1);
  }

  execSync(`docker network connect ${TRAEFIK_NETWORK} ${containerName}`, { stdio: 'inherit' });
  console.log(`Container '${containerName}' mit Netzwerk '${TRAEFIK_NETWORK}' verbunden.`);
};

const getContainerIp = (containerName: string): string => {
  const info = JSON.parse(
    execSync(`docker inspect ${containerName}`, { stdio: 'pipe' }).toString()
  );
  const ip: string | undefined = info[0]?.NetworkSettings?.Networks?.[TRAEFIK_NETWORK]?.IPAddress;
  if (!ip) {
    console.error(`Konnte IP von '${containerName}' im Netzwerk '${TRAEFIK_NETWORK}' nicht ermitteln.`);
    process.exit(1);
  }
  return ip;
};

const writeDynamicConfig = (name: string, domain: string, ip: string, port: number, traefikComposePath: string) => {
  const config = {
    http: {
      routers: {
        [name]: {
          rule: `Host("${domain}")`,
          entryPoints: ['web'],
          service: name,
        },
      },
      services: {
        [name]: {
          loadBalancer: {
            servers: [{ url: `http://${ip}:${port}` }],
          },
        },
      },
    },
  };

  const configYaml = yaml.stringify(config);
  const dynamicDir = resolveDynamicDir(traefikComposePath);

  if (!fs.existsSync(dynamicDir)) {
    fs.mkdirSync(dynamicDir, { recursive: true });
  }
  fs.writeFileSync(path.join(dynamicDir, `${name}.yml`), configYaml, 'utf8');
  console.log(`Routing-Konfiguration geschrieben: ${name}.yml`);

  // Traefik neu starten damit die Config übernommen wird
  // (Windows-Bind-Mounts lösen keine inotify-Events im Container aus)
  execSync(`docker compose -f "${traefikComposePath}" restart traefik`, {
    cwd: path.dirname(traefikComposePath),
    stdio: 'inherit',
  });
  console.log('Traefik neu gestartet.');
};

const ensureFileProviderInTraefik = (composePath: string) => {
  const raw = fs.readFileSync(composePath, 'utf8');
  const composeDoc = yaml.parse(raw);

  const traefik = composeDoc?.services?.traefik;
  if (!traefik) return;

  let changed = false;

  // commands: docker-provider entfernen (Socket nicht verfügbar im devcontainer), file-provider setzen
  if (!Array.isArray(traefik.command)) traefik.command = [];
  traefik.command = (traefik.command as string[]).filter(
    (c) => c !== '--providers.docker=true' && c !== '--providers.docker'
  );
  const fileProviderFlag = '--providers.file.directory=/dynamic';
  const fileWatchFlag = '--providers.file.watch=true';
  if (!traefik.command.includes(fileProviderFlag)) {
    traefik.command.push(fileProviderFlag);
    changed = true;
  }
  if (!traefik.command.includes(fileWatchFlag)) {
    traefik.command.push(fileWatchFlag);
    changed = true;
  }

  // Docker-Socket-Volume entfernen
  if (Array.isArray(traefik.volumes)) {
    const before = traefik.volumes.length;
    traefik.volumes = (traefik.volumes as string[]).filter(
      (v) => !v.includes('docker.sock')
    );
    if (traefik.volumes.length !== before) changed = true;
  } else {
    traefik.volumes = [];
  }

  // Named volumes auf /dynamic entfernen, Bind-Mount auf lokales Verzeichnis setzen
  traefik.volumes = (traefik.volumes as string[]).filter(
    (v) => !(typeof v === 'string' && v.includes(':/dynamic'))
  );
  const bindMount = './dynamic:/dynamic:ro';
  if (!(traefik.volumes as string[]).includes(bindMount)) {
    traefik.volumes.push(bindMount);
    changed = true;
  }

  // Named volume für traefik-dynamic entfernen falls vorhanden
  if (composeDoc.volumes && composeDoc.volumes['traefik-dynamic'] !== undefined) {
    delete composeDoc.volumes['traefik-dynamic'];
    if (Object.keys(composeDoc.volumes).length === 0) delete composeDoc.volumes;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(composePath, yaml.stringify(composeDoc), 'utf8');
    console.log('Traefik file-provider aktiviert (traefik/compose.yml aktualisiert).');
  }
};

const ensureHostsEntry = (domain: string): boolean => {
  const isWindows = process.platform === 'win32';
  const hostsPath = isWindows
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts';
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const hasEntry = () => {
    const content = fs.readFileSync(hostsPath, 'utf8');
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'm').test(content);
  };

  const addDomainToBettyBlock = (content: string): string | null => {
    if (new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'm').test(content)) return null;

    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    const startIndex = lines.findIndex((line) => line.trim() === BETTY_HOSTS_START);
    const endIndex = lines.findIndex((line, index) => index > startIndex && line.trim() === BETTY_HOSTS_END);
    const entry = `127.0.0.1 ${domain} # added by betty`;

    let nextLines = lines;
    if (startIndex >= 0 && endIndex > startIndex) {
      nextLines = [...lines.slice(0, endIndex), entry, ...lines.slice(endIndex)];
    } else {
      nextLines = [...lines];
      if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== '') nextLines.push('');
      nextLines.push(BETTY_HOSTS_START, entry, BETTY_HOSTS_END);
    }

    return `${nextLines.join(newline).replace(/[\r\n]*$/, '')}${newline}`;
  };

  const tryAutoElevateWindows = () => {
    const scriptPath = path.join(os.tmpdir(), `betty-hosts-${Date.now()}.ps1`);
    const scriptDomain = domain.replace(/'/g, "''");
    const scriptStart = BETTY_HOSTS_START.replace(/'/g, "''");
    const scriptEnd = BETTY_HOSTS_END.replace(/'/g, "''");
    // SAFE: only appends, never overwrites the entire file
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$domain = '${scriptDomain}'`,
      `$startMarker = '${scriptStart}'`,
      `$endMarker = '${scriptEnd}'`,
      "$hostsPath = Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts'",
      "$content = [System.IO.File]::ReadAllText($hostsPath)",
      "if ($content -match ('(?m)(^|\\s)' + [regex]::Escape($domain) + '(\\s|$)')) { exit 0 }",
      "$entry = \"127.0.0.1 $domain # added by betty\"",
      "$append = \"`r`n$startMarker`r`n$entry`r`n$endMarker`r`n\"",
      "[System.IO.File]::AppendAllText($hostsPath, $append, [System.Text.Encoding]::ASCII)",
    ].join('\n');

    fs.writeFileSync(scriptPath, script, 'utf8');
    try {
      execSync(
        `powershell -NoProfile -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}' -Wait"`,
        { stdio: 'inherit' }
      );
    } finally {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        // ignore cleanup errors
      }
    }
  };

  try {
    if (hasEntry()) return true;

    try {
      fs.accessSync(hostsPath, fs.constants.W_OK);
      const content = fs.readFileSync(hostsPath, 'utf8');
      const updated = addDomainToBettyBlock(content);
      if (updated !== null) {
        fs.writeFileSync(hostsPath, updated, 'utf8');
        console.log(`Hosts-Eintrag gesetzt: 127.0.0.1 ${domain}`);
        return true;
      }
      return true;
    } catch {
      if (isWindows) {
        try {
          console.log('Erhöhe Rechte, um Hosts-Eintrag automatisch zu setzen...');
          tryAutoElevateWindows();
          if (hasEntry()) {
            console.log(`Hosts-Eintrag gesetzt: 127.0.0.1 ${domain}`);
            return true;
          }
        } catch {
          // fallback hint below
        }
        console.log(`\n⚠️  Hosts-Eintrag konnte nicht automatisch gesetzt werden (UAC evtl. abgebrochen).`);
        console.log('   Bitte hosts-Datei manuell bearbeiten: 127.0.0.1 ' + domain);
        return false;
      } else {
        console.log(`\n⚠️  Bitte einmalig ausführen: sudo sh -c 'echo "127.0.0.1 ${domain}" >> /etc/hosts'`);
        return false;
      }
    }
  } catch {
    if (isWindows) {
      try {
        console.log('Erhöhe Rechte, um Hosts-Eintrag automatisch zu setzen...');
        tryAutoElevateWindows();
        if (hasEntry()) {
          console.log(`Hosts-Eintrag gesetzt: 127.0.0.1 ${domain}`);
          return true;
        }
      } catch {
        // fallback hint below
      }
      console.log(`\n⚠️  Hosts-Eintrag konnte nicht automatisch gesetzt werden (UAC evtl. abgebrochen).`);
      console.log('   Bitte hosts-Datei manuell bearbeiten: 127.0.0.1 ' + domain);
      return false;
    } else {
      console.log(`Konnte /etc/hosts nicht lesen. Stelle sicher, dass ${domain} auf 127.0.0.1 zeigt.`);
      return false;
    }
  }
};

const getRunningContainers = (): string[] => {
  try {
    return execSync('docker ps --format {{.Names}}', { stdio: 'pipe' })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
};

const connectCommand = async (containerName: string | undefined, opts: { domain?: string; port?: string }) => {
  let resolvedContainer = containerName;
  let resolvedDomain = opts.domain;
  let resolvedPort = opts.port;

  if (!resolvedContainer || !resolvedDomain) {
    const runningContainers = getRunningContainers();

    const answers = await inquirer.prompt([
      ...(!resolvedContainer ? [{
        type: runningContainers.length > 0 ? 'list' : 'input',
        name: 'container',
        message: 'Container-Name:',
        ...(runningContainers.length > 0 ? { choices: runningContainers } : {}),
      }] : []),
      ...(!resolvedDomain ? [{
        type: 'input',
        name: 'domain',
        message: 'Domain (z.B. myapp.localhost):',
        validate: (v: string) => !!v || 'Domain darf nicht leer sein',
      }] : []),
      ...(!resolvedPort ? [{
        type: 'input',
        name: 'port',
        message: 'Port:',
        default: '80',
        validate: (v: string) => (Number.isFinite(parseInt(v, 10)) && parseInt(v, 10) > 0) || 'Bitte einen gültigen Port angeben',
      }] : []),
    ]);

    if (answers.container) resolvedContainer = answers.container as string;
    if (answers.domain) resolvedDomain = answers.domain as string;
    if (answers.port) resolvedPort = answers.port as string;
  }

  if (!resolvedContainer) {
    console.error('Kein Container angegeben.');
    process.exit(1);
  }

  if (!resolvedDomain) {
    console.error('Keine Domain angegeben.');
    process.exit(1);
  }

  const port = parseInt(resolvedPort || '80', 10);
  if (!Number.isFinite(port) || port <= 0) {
    console.error('Ungültiger Port. Beispiel: --port 3000');
    process.exit(1);
  }

  const containerNameResolved = resolvedContainer;
  const domainResolved = resolvedDomain;
  const traefikComposePath = resolveTraefikComposePath();

  console.log(`Verbinde '${containerNameResolved}' mit Domain '${domainResolved}' auf Port ${port}...`);

  ensureFileProviderInTraefik(traefikComposePath);
  ensureProxyRunning(traefikComposePath);        // proxy startet und legt traefik_default-Netz an
  ensureTraefikNetwork();      // sicherstellen, falls compose das Netz nicht angelegt hat
  connectContainerToNetwork(containerNameResolved);
  const ip = getContainerIp(containerNameResolved);
  writeDynamicConfig(containerNameResolved.replace(/[^a-zA-Z0-9-]/g, '-'), domainResolved, ip, port, traefikComposePath);
  const hostsUpdated = ensureHostsEntry(domainResolved);
  if (!hostsUpdated) {
    console.log(`\n⚠️  Domain ist erst erreichbar, nachdem der Hosts-Eintrag gesetzt wurde: ${domainResolved}`);
  }

  console.log(`\n✅ '${containerNameResolved}' ist jetzt erreichbar unter http://${domainResolved}`);
};

export default connectCommand;
