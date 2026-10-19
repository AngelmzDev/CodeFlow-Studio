import { spawnSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
async function config(): Promise<{ javaHome?: string; python?: string }> {
  try {
    return JSON.parse(
      await readFile(join(ROOT, '.codeflow.local.json'), 'utf8'),
    );
  } catch {
    return {};
  }
}
function works(command: string, args: string[]): boolean {
  const p = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 4000,
    windowsHide: true,
  });
  return !p.error && p.status === 0;
}
function validJdk(java: string, javac: string): number {
  const version = spawnSync(java, ['-version'], {
    encoding: 'utf8',
    timeout: 4000,
    windowsHide: true,
  });
  const major = Number(
    ((version.stdout ?? '') + (version.stderr ?? ''))
      .split('"')[1]
      ?.split('.')[0] ?? 0,
  );
  const modules = spawnSync(java, ['--list-modules'], {
    encoding: 'utf8',
    timeout: 4000,
    windowsHide: true,
  });
  return major >= 21 &&
    modules.status === 0 &&
    (modules.stdout ?? '').includes('jdk.jdi@') &&
    (modules.stdout ?? '').includes('jdk.compiler@') &&
    works(javac, ['-version'])
    ? major
    : 0;
}
export async function findJava(): Promise<{
  java: string;
  javac: string;
  major: number;
}> {
  const local = await config();
  for (const home of [
    process.env.CODEFLOW_JAVA_HOME,
    process.env.JAVA_HOME,
    local.javaHome,
  ].filter(Boolean) as string[]) {
    const java = join(
      home,
      'bin',
      'java' + (process.platform === 'win32' ? '.exe' : ''),
    );
    const javac = join(
      home,
      'bin',
      'javac' + (process.platform === 'win32' ? '.exe' : ''),
    );
    const major = validJdk(java, javac);
    if (major) return { java, javac, major };
  }
  const major = validJdk('java', 'javac');
  if (major) return { java: 'java', javac: 'javac', major };
  throw new Error(
    'JDK 21+ with jdk.jdi is required. Set CODEFLOW_JAVA_HOME or JAVA_HOME to the JDK directory.',
  );
}
export async function findPython(): Promise<string> {
  const local = await config();
  for (const command of [
    process.env.CODEFLOW_PYTHON,
    local.python,
    process.platform === 'win32' ? 'python' : 'python3',
    'python',
  ].filter(Boolean) as string[]) {
    if (
      works(command, [
        '-I',
        '-c',
        'import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)',
      ])
    )
      return command;
  }
  throw new Error(
    'Python 3.11+ is required. Set CODEFLOW_PYTHON to its executable.',
  );
}
export async function exists(path: string): Promise<boolean> {
  try {
    await access(resolve(path));
    return true;
  } catch {
    return false;
  }
}
