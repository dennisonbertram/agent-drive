export const defaultDevUserId = 'e2e_uxreview';

export function devSignInAllowed(input: {
  nodeEnv: string | undefined;
  testAuth: boolean;
  host: string | null;
}) {
  if (input.nodeEnv !== 'development' || !input.testAuth || !input.host) return false;
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(input.host);
}

export function parseDevUserId(value: string | null) {
  const id = value?.trim() || defaultDevUserId;
  return /^e2e_[a-zA-Z0-9_-]+$/.test(id) ? id : null;
}
