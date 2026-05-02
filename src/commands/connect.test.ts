import { __testables } from './connect';

describe('filterSystemOwnersForBettyPort', () => {
  test('keeps all processes when Betty does not own port 443', () => {
    const owners = [
      'wslrelay (PID 1)',
      'com.docker.backend (PID 2)',
      'nginx (PID 3)',
    ];

    expect(__testables.filterSystemOwnersForBettyPort(owners, false)).toEqual(owners);
  });

  test('filters expected Docker Desktop relay processes when Betty owns port 443', () => {
    const owners = [
      'wslrelay (PID 1)',
      'com.docker.backend (PID 2)',
      'docker-proxy (PID 4)',
      'vpnkit (PID 5)',
      'nginx (PID 3)',
    ];

    expect(__testables.filterSystemOwnersForBettyPort(owners, true)).toEqual([
      'nginx (PID 3)',
    ]);
  });

  test('returns empty list when only expected Docker Desktop relay processes remain', () => {
    const owners = [
      'wslrelay (PID 1)',
      'com.docker.backend (PID 2)',
    ];

    expect(__testables.filterSystemOwnersForBettyPort(owners, true)).toEqual([]);
  });
});
