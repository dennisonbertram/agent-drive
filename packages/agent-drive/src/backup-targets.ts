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
const WIN_PASTE: Cmd = ['powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard']];

function tools(deps: TargetDeps): Tool[] {
  if (deps.platform === 'darwin')
    return [{ copy: ['pbcopy', []], paste: ['pbpaste', []], clear: ['pbcopy', []] }];
  if (deps.platform === 'win32')
    return [{ copy: ['clip', []], paste: WIN_PASTE, clear: ['clip', []] }];
  return [
    {
      copy: ['wl-copy', []],
      paste: ['wl-paste', ['--no-newline']],
      clear: ['wl-copy', ['--clear']],
    },
    {
      copy: ['xclip', ['-selection', 'clipboard']],
      paste: ['xclip', ['-selection', 'clipboard', '-o']],
      clear: ['xclip', ['-selection', 'clipboard']],
    },
    ...(deps.env.WSL_DISTRO_NAME
      ? [{ copy: ['clip.exe', []], paste: WIN_PASTE, clear: ['clip.exe', []] } as Tool]
      : []),
  ];
}

/** Copies the bundle with the first clipboard tool present. Returns a function that clears it later. */
export async function copyToClipboard(bundle: string, keep: boolean, deps: TargetDeps) {
  for (const tool of tools(deps)) {
    try {
      if ((await deps.run(tool.copy[0], tool.copy[1], bundle)).code !== 0) continue;
    } catch (error) {
      if (missing(error)) continue;
      throw error;
    }
    // Waiting in-process needs no background process or temp file holding the secret, and the
    // compare-then-clear stays in one place. Ceiling: Ctrl-C during the wait leaves it copied.
    return async () => {
      if (keep) return false;
      await deps.sleep(CLIPBOARD_CLEAR_SECONDS * 1000);
      try {
        const now = await deps.run(tool.paste[0], tool.paste[1]);
        if (now.code !== 0 || now.stdout.replace(/\r?\n$/u, '') !== bundle) return false;
        await deps.run(tool.clear[0], tool.clear[1], '');
        return true;
      } catch {
        return false;
      }
    };
  }
  throw new Error(
    'No clipboard tool found (pbcopy on macOS; wl-copy or xclip on Linux; clip.exe on Windows or WSL). Nothing was exported. Use `--to <path>` instead.',
  );
}
