const loopbackHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);

export function shareTransportAllowed(url: URL, environment: string | undefined) {
  if (url.protocol === 'https:') return true;
  return (
    environment !== 'production' && url.protocol === 'http:' && loopbackHostnames.has(url.hostname)
  );
}
