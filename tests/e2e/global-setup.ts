import { execFileSync } from 'node:child_process';

export default function globalSetup() {
  execFileSync('pnpm', ['--filter', '@agent-drive/web', 'db:migrate'], {
    stdio: 'pipe',
    env: process.env,
  });
  execFileSync('pnpm', ['--filter', './packages/agent-drive', 'build'], {
    stdio: 'pipe',
    env: process.env,
  });
}
