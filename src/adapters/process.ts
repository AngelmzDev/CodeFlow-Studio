import { spawn } from 'node:child_process';
export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  limited?: string;
}
export function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    maxBytes?: number;
    signal?: AbortSignal;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let stdout = '',
      stderr = '',
      bytes = 0,
      limited: string | undefined;
    const directKill = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* Already exited. */
      }
    };
    const stop = (reason: string) => {
      if (limited) return;
      limited = reason;
      if (child.pid) {
        if (process.platform === 'win32') {
          const killer = spawn(
            'taskkill',
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore' },
          );
          killer.on('error', directKill);
          killer.on('exit', (code) => {
            if (code !== 0) directKill();
          });
          const fallback = setTimeout(directKill, 1500);
          fallback.unref();
          child.once('close', () => clearTimeout(fallback));
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            directKill();
          }
        }
      }
    };
    const timer = setTimeout(
      () => stop('Wall clock limit exceeded'),
      options.timeoutMs,
    );
    const abort = () => stop('Execution cancelled');
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      bytes += Buffer.byteLength(data);
      if (bytes > (options.maxBytes ?? 24 * 1024 * 1024))
        stop('Trace byte limit exceeded');
      else stdout += data;
    });
    child.stderr.on('data', (data: string) => {
      if (stderr.length < 65536) stderr += data.slice(0, 65536 - stderr.length);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      resolve({ code, stdout, stderr, limited });
    });
    if (options.signal?.aborted) abort();
  });
}
