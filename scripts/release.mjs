import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSmoke, smokeOrigin } from './release-smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function command(name, args, capture = false) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(name, args, {
      cwd: root,
      stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    });
    let output = '';
    if (capture)
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        output += chunk;
      });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolveResult(output.trim()) : reject(new Error('Release command failed.')),
    );
  });
}

export async function runRelease({ productionUrl, execute = command, smoke = runSmoke }) {
  const production = smokeOrigin(productionUrl);
  if (!production.startsWith('https:')) throw new Error('Production requires HTTPS.');
  const stamp = new Date().toISOString().replaceAll(':', '-');
  await execute('pnpm', ['verify']);
  const candidate = smokeOrigin(
    await execute('vercel', ['deploy', '--prod', '--skip-domain'], true),
  );
  if (!candidate.startsWith('https:')) throw new Error('Candidate requires HTTPS.');
  const before = await smoke({
    url: candidate,
    reportPath: `test-results/release-${stamp}/candidate.json`,
  });
  if (!before.passed) throw new Error('Candidate smoke failed; production was not promoted.');
  await execute('vercel', ['promote', candidate]);
  const after = await smoke({
    url: production,
    reportPath: `test-results/release-${stamp}/production.json`,
  });
  if (!after.passed)
    throw new Error('Production smoke failed. Inspect and roll back the deployment.');
  return { candidate, production };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'production-url': { type: 'string' } } });
    await runRelease({ productionUrl: values['production-url'] });
    console.log('Production release passed both deployed smoke runs.');
  } catch {
    console.error(
      'Release did not pass. Inspect the command output and smoke reports; if promotion occurred, restore the previous deployment. No automatic rollback or protection bypass was attempted.',
    );
    process.exitCode = 1;
  }
}
