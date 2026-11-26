import { spawn } from 'node:child_process';

const registries = [
  process.env.DOCKER_OFFICIAL_REGISTRY || 'public.ecr.aws/docker/library',
  'docker.io/library',
  'public.ecr.aws/docker/library',
].filter((registry, index, all) => all.indexOf(registry) === index);
const validRegistry = /^[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._-]+)*$/iu;

for (const registry of registries) {
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
    const child = spawn('docker', args, {
      env: { ...process.env, DOCKER_OFFICIAL_REGISTRY: registry },
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

for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
  const registry = registries[registryIndex];
  let retry = false;
  for (const args of steps) {
    const result = await run(args, registry);
    if (result.code === 0) continue;
    if (!throttled.test(result.output) || registryIndex === registries.length - 1) {
      process.exitCode = result.code;
      process.exit();
    }
    process.stderr.write(
      `\nRegistry ${registry} was throttled. Retrying local services with ${registries[registryIndex + 1]}.\n`,
    );
    retry = true;
    break;
  }
  if (!retry) process.exit(0);
}
