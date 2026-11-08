/** Path and tag rules for captured traces. No dependencies: the server imports this file too. */

export const AGENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/u;

export function sanitizeModel(model: string | null | undefined) {
  return (model ?? '').replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 50) || 'unknown';
}

export function tracePath(input: {
  agent: string;
  model: string | null | undefined;
  at: Date | null;
  suffix: string;
}) {
  const model = sanitizeModel(input.model);
  if (!input.at) return `/traces/${input.agent}/undated/${model}_${input.suffix}.json`;
  const iso = input.at.toISOString(); // 2026-11-08T12:00:01.123Z
  const date = iso.slice(0, 10);
  const time = `${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}.${iso.slice(20, 23)}Z`;
  return `/traces/${input.agent}/${date}/${time}_${model}_${input.suffix}.json`;
}

export function traceTags(agent: string, model: string | null | undefined) {
  return ['trace', `agent:${agent}`, `model:${sanitizeModel(model)}`];
}
