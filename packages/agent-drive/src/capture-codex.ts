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

/** Returns the name of the flag (and config key) that already selects a provider or profile.
 * Never returns a value: config values can hold credentials. */
export function codexOverride(args: string[]): string | undefined {
  const keyOf = (setting: string) => setting.split('=')[0]?.trim() ?? '';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    let setting: string | undefined;
    if (arg === '-c' || arg === '--config') setting = args[i + 1];
    else if (arg.startsWith('--config=')) setting = arg.slice(9);
    else if (arg.startsWith('-c=')) setting = arg.slice(3);
    else if (arg.startsWith('-c') && !arg.startsWith('--')) setting = arg.slice(2);
    else if (arg.startsWith('-p') || arg === '--profile' || arg.startsWith('--profile='))
      return arg.startsWith('--') ? '--profile' : '-p';
    if (setting !== undefined && isProviderKey(setting)) return `-c ${keyOf(setting)}`;
  }
  return undefined;
}
