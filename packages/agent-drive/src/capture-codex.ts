/** Codex needs a provider entry (not just an env var) to reach the local proxy over plain HTTP. */

export function codexProviderFlags(port: number) {
  const p = 'model_providers.agent_drive_capture';
  const settings = [
    `${p}.name="Agent Drive capture"`,
    `${p}.base_url="http://127.0.0.1:${port}/openai/v1"`,
    `${p}.env_key="OPENAI_API_KEY"`,
    `${p}.wire_api="responses"`,
    `${p}.supports_websockets=false`,
    'model_provider="agent_drive_capture"',
  ];
  return settings.flatMap((setting) => ['-c', setting]);
}

function isProviderKey(setting: string) {
  const key = setting.split('=')[0]?.trim() ?? '';
  return key === 'model_provider' || key.startsWith('model_providers.');
}

/** Returns the flag that already selects a Codex provider or profile, if any. */
export function codexOverride(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-c' || arg === '--config') {
      if (isProviderKey(args[i + 1] ?? '')) return `${arg} ${args[i + 1]}`;
    } else if (arg.startsWith('--config=')) {
      if (isProviderKey(arg.slice(9))) return arg;
    } else if (
      arg === '-p' ||
      arg === '--profile' ||
      arg.startsWith('--profile=') ||
      arg.startsWith('-p=')
    ) {
      return arg;
    }
  }
  return undefined;
}
