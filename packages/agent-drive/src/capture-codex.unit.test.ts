import { describe, expect, it } from 'vitest';
import { codexOverride, codexProviderFlags } from './capture-codex.js';

describe('codex overrides', () => {
  it('emits the six provider settings as -c flags', () => {
    const flags = codexProviderFlags(4321);
    expect(flags.filter((f) => f === '-c').length).toBe(6);
    expect(flags.filter((f) => f !== '-c')).toEqual([
      'model_providers.agent_drive_capture.name="Agent Drive capture"',
      'model_providers.agent_drive_capture.base_url="http://127.0.0.1:4321/openai/v1"',
      'model_providers.agent_drive_capture.env_key="OPENAI_API_KEY"',
      'model_providers.agent_drive_capture.wire_api="responses"',
      'model_providers.agent_drive_capture.supports_websockets=false',
      'model_provider="agent_drive_capture"',
    ]);
  });

  it.each([
    [['-c', 'model_provider=x']],
    [['--config', 'model_provider=x']],
    [['--config=model_provider=x']],
    [['-c', 'model_providers.foo.base_url=http://x']],
    [['-p', 'work']],
    [['--profile', 'work']],
    [['--profile=work']],
  ])('detects %j', (args) => {
    expect(codexOverride(args)).toBeTruthy();
  });

  it('ignores unrelated config', () => {
    expect(codexOverride(['-c', 'approval_policy=never', 'exec', 'hi'])).toBeUndefined();
  });
});
