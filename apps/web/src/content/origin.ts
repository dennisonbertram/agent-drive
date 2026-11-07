/** The origin this deployment is served from. AGENT_DRIVE_PUBLIC_URL pins it. */
export function publicOrigin(h: Headers): string {
  if (process.env.AGENT_DRIVE_PUBLIC_URL) return new URL(process.env.AGENT_DRIVE_PUBLIC_URL).origin;
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'agentdrive.xyz';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
