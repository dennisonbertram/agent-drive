/**
 * The signed-in console's Files view of the folder holding a saved path: a private link the
 * owner can open, never a share link and never a credential. The origin comes from the
 * configured API URL, so a self-hosted install links its own console and nothing is sent to
 * the hosted service. It carries only metadata the console already shows — the drive id and
 * the folder of the committed version's canonical path.
 */
export function consoleFolderUrl(apiOrigin: string, driveId: string, savedPath: string) {
  let origin: string;
  try {
    // URL.origin never contains userinfo, so the link cannot carry credentials even if the
    // configured API URL were to.
    origin = new URL(apiOrigin).origin;
  } catch {
    return undefined;
  }
  if (origin === 'null' || !driveId) return undefined;
  const path = typeof savedPath === 'string' && savedPath.startsWith('/') ? savedPath : '/';
  const cut = path.lastIndexOf('/');
  const folder = cut > 0 ? path.slice(0, cut) : '/';
  return `${origin}/console?${new URLSearchParams({ drive: driveId, path: folder })}`;
}
