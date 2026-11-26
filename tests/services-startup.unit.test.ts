import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const dirs: string[] = [];
const serviceScript = resolve('scripts/services-up.mjs');
const rootPackage = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  scripts: Record<string, string | undefined>;
};

async function runServices(
  options: {
    registry?: string;
    dotenvRegistry?: string;
    failRegistry?: string;
    failCommand?: string;
    error?: string;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-drive-services-'));
  dirs.push(dir);
  const bin = join(dir, 'bin');
  const dockerLog = join(dir, 'docker.log');
  await mkdir(bin);
  const fakeDocker = join(bin, 'docker');
  await writeFile(
    fakeDocker,
    `#!/bin/sh
if [ -n "\${DOCKER_OFFICIAL_REGISTRY:-}" ]; then
  effective_registry="$DOCKER_OFFICIAL_REGISTRY"
elif [ -f .env ]; then
  effective_registry="$(sed -n 's/^DOCKER_OFFICIAL_REGISTRY=//p' .env | head -n 1)"
else
  effective_registry='public.ecr.aws/docker/library'
fi
printf '%s\\t%s\\t%s\\n' "\${DOCKER_OFFICIAL_REGISTRY-<unset>}" "$effective_registry" "$*" >> "$DOCKER_CALL_LOG"
if [ "\${DOCKER_FAIL_REGISTRY:-}" = "$effective_registry" ] && [ "\${DOCKER_FAIL_COMMAND:-}" = "$*" ]; then
  printf '%s\\n' "\${DOCKER_ERROR:-simulated failure}" >&2
  exit 17
fi
exit 0
`,
  );
  await chmod(fakeDocker, 0o755);

  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const path = process.env[pathKey] ?? '';
  const env = {
    ...process.env,
    [pathKey]: `${bin}${process.platform === 'win32' ? ';' : ':'}${path}`,
    DOCKER_CALL_LOG: dockerLog,
    DOCKER_FAIL_REGISTRY: options.failRegistry ?? '',
    DOCKER_FAIL_COMMAND: options.failCommand ?? '',
    DOCKER_ERROR: options.error ?? '',
  };
  delete env.DOCKER_OFFICIAL_REGISTRY;
  if (options.registry) env.DOCKER_OFFICIAL_REGISTRY = options.registry;
  if (options.dotenvRegistry)
    await writeFile(join(dir, '.env'), `DOCKER_OFFICIAL_REGISTRY=${options.dotenvRegistry}\n`);
  const result = spawnSync(process.execPath, [serviceScript], {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: 10_000,
  });
  const calls = (await readFile(dockerLog, 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean);
  return { result, calls };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('local service startup', () => {
  it('routes services:up through the tested startup wrapper', () => {
    expect(rootPackage.scripts['services:up']).toBe('node scripts/services-up.mjs');
  });

  it('builds MinIO, waits for healthy services, then initializes the bucket', async () => {
    const registry = 'registry.example/docker/library';
    const { result, calls } = await runServices({ registry });

    expect(result.status, result.stderr).toBe(0);
    expect(calls).toEqual([
      `${registry}\t${registry}\tcompose build minio`,
      `${registry}\t${registry}\tcompose up -d --wait postgres minio`,
      `${registry}\t${registry}\tcompose run --rm minio-init`,
    ]);
  });

  it('stops after a non-throttling service failure', async () => {
    const registry = 'registry.example/docker/library';
    const { result, calls } = await runServices({
      registry,
      failRegistry: registry,
      failCommand: 'compose up -d --wait postgres minio',
      error: 'service failed',
    });

    expect(result.status).toBe(17);
    expect(result.stderr).toContain('service failed');
    expect(calls).toEqual([
      `${registry}\t${registry}\tcompose build minio`,
      `${registry}\t${registry}\tcompose up -d --wait postgres minio`,
    ]);
  });

  it('retries the full sequence on Docker Hub after registry throttling', async () => {
    const registry = 'registry.example/docker/library';
    const hub = 'docker.io/library';
    const { result, calls } = await runServices({
      registry,
      failRegistry: registry,
      failCommand: 'compose build minio',
      error: 'Data limit exceeded',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(`${registry} was throttled`);
    expect(calls).toEqual([
      `${registry}\t${registry}\tcompose build minio`,
      `${hub}\t${hub}\tcompose build minio`,
      `${hub}\t${hub}\tcompose up -d --wait postgres minio`,
      `${hub}\t${hub}\tcompose run --rm minio-init`,
    ]);
  });

  it('preserves a Compose .env mirror initially and overrides it on fallback', async () => {
    const mirror = 'mirror.example/docker/library';
    const hub = 'docker.io/library';
    const { result, calls } = await runServices({
      dotenvRegistry: mirror,
      failRegistry: mirror,
      failCommand: 'compose build minio',
      error: 'Data limit exceeded',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(calls).toEqual([
      `<unset>\t${mirror}\tcompose build minio`,
      `${hub}\t${hub}\tcompose build minio`,
      `${hub}\t${hub}\tcompose up -d --wait postgres minio`,
      `${hub}\t${hub}\tcompose run --rm minio-init`,
    ]);
  });
});
