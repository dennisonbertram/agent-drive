import { spawn } from 'node:child_process';

const initialRegistry = process.env.DOCKER_OFFICIAL_REGISTRY || undefined;
const fallbackRegistries = ['docker.io/library', 'public.ecr.aws/docker/library'].filter(
  (registry, index, all) => all.indexOf(registry) === index && registry !== initialRegistry,
);
const validRegistry = /^[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._-]+)*$/iu;

for (const registry of [initialRegistry, ...fallbackRegistries]) {
  if (!registry) continue;
  if (!validRegistry.test(registry)) {
    process.stderr.write(
      'DOCKER_OFFICIAL_REGISTRY must be a registry and optional namespace path.\n',
    );
    process.exitCode = 2;
    process.exit();
  }
}

const steps = [
  ['compose', 'build', 'minio'],
  ['compose', 'up', '-d', '--wait', 'postgres', 'minio'],
  ['compose', 'run', '--rm', 'minio-init'],
];
const throttled =
  /(?:too many requests|toomanyrequests|data limit exceeded|rate limit exceeded|pull rate limit)/iu;

function run(args, registry) {
  return new Promise((resolve) => {
    const output = [];
    const env = { ...process.env };
    // Preserve Compose's normal shell/.env/default precedence on the first attempt. Only
    // retries need an explicit registry to get past a throttled source.
    if (registry !== undefined) env.DOCKER_OFFICIAL_REGISTRY = registry;
    const child = spawn('docker', args, {
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        output.push(chunk);
        (stream === child.stdout ? process.stdout : process.stderr).write(chunk);
      });
    }
    child.on('error', (error) => {
      process.stderr.write(`${error.message}\n`);
      resolve({ code: 1, output: '' });
    });
    child.on('close', (code) =>
      resolve({ code: code ?? 1, output: Buffer.concat(output).toString('utf8') }),
    );
  });
}

const attempts = [undefined, ...fallbackRegistries];
for (let registryIndex = 0; registryIndex < attempts.length; registryIndex += 1) {
  const registry = attempts[registryIndex];
  let retry = false;
  for (const args of steps) {
    const result = await run(args, registry);
    if (result.code === 0) continue;
    if (!throttled.test(result.output) || registryIndex === attempts.length - 1) {
      process.exitCode = result.code;
      process.exit();
    }
    process.stderr.write(
      `\n${registry ?? initialRegistry ?? 'Configured Compose registry'} was throttled. Retrying local services with ${attempts[registryIndex + 1]}.\n`,
    );
    retry = true;
    break;
  }
  if (!retry) process.exit(0);
}
