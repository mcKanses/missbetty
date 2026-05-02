import { execSync } from 'child_process';

const BETTY_SYSTEM_443_OWNER_PATTERNS = [
  /^wslrelay\b/i,
  /^com\.docker\.backend\b/i,
  /^docker-proxy\b/i,
  /^vpnkit\b/i,
];

const getDockerPortOwners = (port: number): string[] => {
  try {
    return execSync(`docker ps --filter "publish=${String(port)}" --format "{{.Names}}\t{{.Ports}}"`, { stdio: 'pipe' })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
};

const getSystemPortOwners = (port: number): string[] => {
  try {
    if (process.platform === 'win32') {
      const command = [
        'powershell',
        '-NoProfile',
        '-Command',
        `"Get-NetTCPConnection -LocalPort ${String(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p) { $p.ProcessName + ' (PID ' + $_ + ')' } else { 'PID ' + $_ } }"`,
      ].join(' ');
      return execSync(command, { stdio: 'pipe' }).toString().trim().split('\n').filter(Boolean);
    }

    return execSync(`lsof -nP -iTCP:${String(port)} -sTCP:LISTEN`, { stdio: 'pipe' })
      .toString()
      .trim()
      .split('\n')
      .slice(1)
      .filter(Boolean);
  } catch {
    return [];
  }
};

const filterSystemOwnersForBettyPort = (systemOwners: string[], bettyOwnsPort: boolean): string[] => {
  if (!bettyOwnsPort) return systemOwners;

  return systemOwners.filter((owner) => {
    const normalized = owner.trim();
    return !BETTY_SYSTEM_443_OWNER_PATTERNS.some((pattern) => pattern.test(normalized));
  });
};

export {
  getDockerPortOwners,
  getSystemPortOwners,
  filterSystemOwnersForBettyPort,
};
