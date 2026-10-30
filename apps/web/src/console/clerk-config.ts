const placeholderPattern =
  /(?:replace[_-]?me|placeholder|your[_-]?(?:publishable|secret)[_-]?key)/i;

function configuredKey(value: string | undefined) {
  const normalized = value?.trim();
  return !!normalized && !placeholderPattern.test(normalized);
}

export function clerkKeysConfigured(
  publishableKey: string | undefined,
  secretKey: string | undefined,
) {
  return configuredKey(publishableKey) && configuredKey(secretKey);
}

export function isClerkConsolePage(pathname: string) {
  return pathname === '/console' || pathname.startsWith('/console/');
}
