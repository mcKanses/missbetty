
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import yaml from 'yaml';

type ProjectStatus = {
  name: string;
  domain: string;
  port: string;
  target: string;
  uptime: string;
  health: string;
  restarts: string;
};

type StatusOptions = {
  long?: boolean;
  json?: boolean;
  format?: string;
  short?: boolean;
};

const resolveTraefikComposePath = (): string | null => {
  const composePath = path.join(os.homedir(), '.betty', 'docker-compose.yml');
  return fs.existsSync(composePath) ? composePath : null;
};

const getTraefikContainerStatus = (_composePath: string) => {
  let proxyRunning = false;
  let proxyInfo = '';
  let proxyUptime = '';
  let traefikContainer: any = null;

  try {
    const output = execSync('docker inspect betty-traefik', { stdio: 'pipe' });
    const containers = JSON.parse(output.toString());
    traefikContainer = Array.isArray(containers) ? containers[0] : containers;
    proxyRunning = traefikContainer?.State?.Running === true;
    const startedAt = traefikContainer?.State?.StartedAt;
    proxyUptime = startedAt && startedAt !== '0001-01-01T00:00:00Z'
      ? `${Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000))}m`
      : '';
    proxyInfo = proxyRunning ? 'Proxy is running.' : 'Proxy is not running.';
  } catch {
    proxyInfo = 'Proxy is not running.';
  }

  return { proxyRunning, proxyInfo, proxyUptime, traefikContainer };
};

const getContainerMetaByIp = (ip: string): { uptime: string; health: string; restarts: string } => {
  try {
    const idsOutput = execSync('docker ps --format {{.ID}}', { stdio: 'pipe' }).toString().trim();
    if (!idsOutput) return { uptime: 'n/a', health: 'n/a', restarts: 'n/a' };

    const ids = idsOutput.split('\n').filter(Boolean);
    for (const id of ids) {
      try {
        const inspectOut = execSync(`docker inspect ${id}`, { stdio: 'pipe' }).toString();
        const inspectJson = JSON.parse(inspectOut);
        const container = inspectJson[0];
        const networks = container?.NetworkSettings?.Networks || {};
        const networkMatch = Object.values(networks).find((n: any) => n?.IPAddress === ip) as any;
        if (!networkMatch) continue;

        const startedAt = container?.State?.StartedAt;
        const uptime = startedAt && startedAt !== '0001-01-01T00:00:00Z'
          ? `${Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000))}m`
          : 'n/a';
        const health = container?.State?.Health?.Status || container?.State?.Status || 'n/a';
        const restarts = String(container?.RestartCount ?? 'n/a');
        return { uptime, health, restarts };
      } catch {
        // next container
      }
    }
  } catch {
    // ignore
  }

  return { uptime: 'n/a', health: 'n/a', restarts: 'n/a' };
};

const readProjectsFromDynamicFiles = (composePath: string): ProjectStatus[] => {
  const dynamicDir = path.resolve(path.dirname(composePath), 'dynamic');
  if (!fs.existsSync(dynamicDir)) return [];

  const files = fs.readdirSync(dynamicDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  return files
    .map((file) => {
      try {
        const doc = yaml.parse(fs.readFileSync(path.join(dynamicDir, file), 'utf8'));
        const routers = doc?.http?.routers || {};
        const services = doc?.http?.services || {};
        const firstRouterKey = Object.keys(routers)[0] || path.basename(file, path.extname(file));
        const firstServiceKey = Object.keys(services)[0] || firstRouterKey;
        const rule = String(routers[firstRouterKey]?.rule || '');
        const domainMatch = rule.match(/Host\("([^"]+)"\)/);
        const domain = domainMatch?.[1] || 'n/a';
        const url = String(services[firstServiceKey]?.loadBalancer?.servers?.[0]?.url || '');
        const target = url || 'n/a';
        const port = url ? (url.match(/:(\d+)(?:\/)?$/)?.[1] || 'n/a') : 'n/a';
        const ip = url.match(/^https?:\/\/([^:/]+)(?::\d+)?/i)?.[1] || '';
        const meta = ip ? getContainerMetaByIp(ip) : { uptime: 'n/a', health: 'n/a', restarts: 'n/a' };

        return {
          name: firstRouterKey,
          domain,
          port,
          target,
          uptime: meta.uptime,
          health: meta.health,
          restarts: meta.restarts,
        } as ProjectStatus;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ProjectStatus => entry !== null);
};

const statusCommand = (opts?: StatusOptions) => {
  const composePath = resolveTraefikComposePath();
  const proxy = composePath
    ? getTraefikContainerStatus(composePath)
    : {
        proxyRunning: false,
        proxyInfo: 'Could not determine proxy status.',
        proxyUptime: '',
        traefikContainer: null,
      };

  const projects = composePath ? readProjectsFromDynamicFiles(composePath) : [];

  if (opts && (opts.json || opts.format === 'json')) {
    const output = {
      proxy: {
        running: proxy.proxyRunning,
        info: proxy.proxyInfo,
        uptime: proxy.proxyUptime,
        container: proxy.traefikContainer || null,
      },
      projects,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (projects.length > 0) {
    const nameW = Math.max(12, ...projects.map((p) => p.name.length));
    const domainW = Math.max(12, ...projects.map((p) => p.domain.length));
    const portW = Math.max(4, ...projects.map((p) => String(p.port).length));
    if (opts?.short) {
      const targetW = Math.max(12, ...projects.map((p) => p.target.length));
      const header = `${'project name'.padEnd(nameW)} | ${'domain'.padEnd(domainW)} | ${'port'.padEnd(portW)} | ${'target'.padEnd(targetW)}`;
      const sep = `${'-'.repeat(nameW)}-|-${'-'.repeat(domainW)}-|-${'-'.repeat(portW)}-|-${'-'.repeat(targetW)}`;
      console.log(`\n${header}`);
      console.log(sep);
      projects.forEach((p) => {
        console.log(`${p.name.padEnd(nameW)} | ${p.domain.padEnd(domainW)} | ${String(p.port).padEnd(portW)} | ${p.target.padEnd(targetW)}`);
      });
    } else {
      const uptimeW = Math.max(6, ...projects.map((p) => p.uptime.length));
      const healthW = Math.max(6, ...projects.map((p) => p.health.length));
      const restartsW = Math.max(8, ...projects.map((p) => p.restarts.length));
      const targetW = Math.max(12, ...projects.map((p) => p.target.length));
      const header = `${'project name'.padEnd(nameW)} | ${'domain'.padEnd(domainW)} | ${'port'.padEnd(portW)} | ${'target'.padEnd(targetW)} | ${'uptime'.padEnd(uptimeW)} | ${'health'.padEnd(healthW)} | ${'restarts'.padEnd(restartsW)}`;
      const sep = `${'-'.repeat(nameW)}-|-${'-'.repeat(domainW)}-|-${'-'.repeat(portW)}-|-${'-'.repeat(targetW)}-|-${'-'.repeat(uptimeW)}-|-${'-'.repeat(healthW)}-|-${'-'.repeat(restartsW)}`;
      console.log(`\n${header}`);
      console.log(sep);
      projects.forEach((p) => {
        console.log(`${p.name.padEnd(nameW)} | ${p.domain.padEnd(domainW)} | ${String(p.port).padEnd(portW)} | ${p.target.padEnd(targetW)} | ${p.uptime.padEnd(uptimeW)} | ${p.health.padEnd(healthW)} | ${p.restarts.padEnd(restartsW)}`);
      });
    }
  } else {
    console.log(proxy.proxyInfo);
    console.log('No links found. Link a container first with "betty link".');
  }

  if (opts && opts.long && proxy.traefikContainer) {
    console.log('\n--- Traefik Container Details ---');
    Object.entries(proxy.traefikContainer).forEach(([k, v]) => {
      console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    });
  }
};

if (require.main === module) {
  statusCommand();
}

export default statusCommand;
