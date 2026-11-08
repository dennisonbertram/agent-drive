import { spawn } from 'node:child_process';

export type RunResult = { code: number; stdout: string };
/** Runs a program, writes `input` to its stdin, and rejects with ENOENT when it is not installed. */
export type Run = (command: string, args: string[], input?: string) => Promise<RunResult>;
export type TargetDeps = {
  run: Run;
  sleep: (ms: number) => Promise<void>;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
};

export const realTargetDeps: TargetDeps = {
  run: (command, args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
      child.stdin.on('error', () => undefined);
      child.stdin.end(input ?? '');
    }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  platform: process.platform,
  env: process.env,
};

export const CLIPBOARD_CLEAR_SECONDS = 60;

/** `--to` is a target name or a file path. Use `./1password` for a file with that name. */
export function parseTarget(to: string | undefined) {
  if (to === '1password' || to === 'op') return '1password' as const;
  if (to === 'clipboard') return 'clipboard' as const;
  return undefined;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Creates a 1Password item whose concealed field holds the bundle. The bundle travels only on stdin. */
export async function exportTo1Password(
  bundle: string,
  title: string,
  vault: string | undefined,
  deps: TargetDeps,
) {
  const setup = (why: string) =>
    new Error(
      `${why} Nothing was exported. Install the 1Password CLI (https://developer.1password.com/docs/cli/get-started/), turn on its desktop-app integration or run \`eval $(op signin)\`, check that \`op whoami\` succeeds, then run this again.`,
    );
  try {
    if ((await deps.run('op', ['whoami'])).code !== 0)
      throw setup('The 1Password CLI (`op`) is not signed in.');
  } catch (error) {
    if (missing(error)) throw setup('The 1Password CLI (`op`) is not installed.');
    throw error;
  }
  const template = JSON.stringify({
    title,
    category: 'PASSWORD',
    fields: [
      {
        id: 'password',
        type: 'CONCEALED',
        purpose: 'PASSWORD',
        label: 'credentials',
        value: bundle,
      },
    ],
  });
  const args = ['item', 'create', ...(vault ? ['--vault', vault] : []), '-'];
  if ((await deps.run('op', args, template)).code !== 0)
    throw new Error(
      'The 1Password CLI could not create the item. Nothing was recorded as backed up.',
    );
}

type Cmd = [string, string[]];
type Tool = { copy: Cmd; paste: Cmd; clear: Cmd };
const PS = (script: string): Cmd => ['powershell.exe', ['-NoProfile', '-Command', script]];

/** macOS and Windows only. wl-copy leaves a temp file and xclip forks, which hangs a runner. */
function tool(platform: NodeJS.Platform): Tool | undefined {
  if (platform === 'darwin')
    return { copy: ['pbcopy', []], paste: ['pbpaste', []], clear: ['pbcopy', []] };
  if (platform === 'win32')
    return {
      copy: ['clip', []],
      paste: PS('Get-Clipboard'),
      clear: PS('Set-Clipboard -Value $null'),
    };
  return undefined;
}

export type ClearResult = 'cleared' | 'unchanged' | 'kept' | 'failed';

/**
 * Copies the bundle and starts the 60-second clear at once. `clearing` never rejects; await it
 * to keep the process alive until the clipboard is handled.
 */
export async function copyToClipboard(bundle: string, keep: boolean, deps: TargetDeps) {
  const found = tool(deps.platform);
  if (!found)
    throw new Error(
      'The clipboard target works on macOS and Windows only. Use `--to 1password` or `--to <a file outside the repo>` instead.',
    );
  try {
    if ((await deps.run(found.copy[0], found.copy[1], bundle)).code !== 0) throw new Error();
  } catch {
    throw new Error(
      `Could not copy to the clipboard with ${found.copy[0]}. Nothing was exported. Use \`--to 1password\` or \`--to <a file outside the repo>\` instead.`,
    );
  }
  // Waiting in-process needs no background process or temp file holding the secret.
  // Ceiling: Ctrl-C during the wait leaves it copied. If something else is copied in the same
  // instant as the compare, that may be cleared too.
  const clearing = (async (): Promise<ClearResult> => {
    if (keep) return 'kept';
    await deps.sleep(CLIPBOARD_CLEAR_SECONDS * 1000);
    try {
      const now = await deps.run(found.paste[0], found.paste[1]);
      if (now.code !== 0) return 'failed';
      if (now.stdout.replace(/\r?\n$/u, '') !== bundle) return 'unchanged';
      return (await deps.run(found.clear[0], found.clear[1], '')).code === 0 ? 'cleared' : 'failed';
    } catch {
      return 'failed';
    }
  })();
  return clearing;
}
