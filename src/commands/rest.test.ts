import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import restCommand from './rest';

jest.mock('os', () => ({
  __esModule: true,
  default: { homedir: () => '/home/test-user' },
  homedir: () => '/home/test-user',
}));

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
  },
  existsSync: jest.fn(),
}));

describe('rest command', () => {
  const composePath = path.join('/home/test-user', '.betty', 'docker-compose.yml');
  const homeDir = path.join('/home/test-user', '.betty');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('prints setup hint when Betty proxy is not set up yet', () => {
    (fs.existsSync as unknown as jest.Mock).mockReturnValue(false);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    restCommand();

    expect(fs.existsSync).toHaveBeenCalledWith(composePath);
    expect(execSync).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("Betty's local switchboard service is not set up yet.");
    expect(logSpy).toHaveBeenCalledWith('Start it with: betty serve');

    logSpy.mockRestore();
  });

  test('runs docker compose down when Betty proxy is set up', () => {
    (fs.existsSync as unknown as jest.Mock).mockReturnValue(true);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    restCommand();

    expect(execSync).toHaveBeenCalledWith(`docker compose -f "${composePath}" down`, {
      cwd: homeDir,
      stdio: 'inherit',
    });
    expect(logSpy).toHaveBeenCalledWith("Betty is stopping her local switchboard service...");
    expect(logSpy).toHaveBeenCalledWith('Betty is resting.');

    logSpy.mockRestore();
  });

  test('prints error and exits with code 1 when stopping fails', () => {
    (fs.existsSync as unknown as jest.Mock).mockReturnValue(true);
    (execSync as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('compose down failed');
    });

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process-exit');
    }) as never);

    expect(() => restCommand()).toThrow('process-exit');
    expect(errorSpy).toHaveBeenCalledWith("Betty's switchboard service could not be stopped:", 'compose down failed');
    expect(exitSpy).toHaveBeenCalledWith(1);

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
