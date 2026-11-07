// Calls onIdle once after limitMs without a pointer or key press. Compares wall-clock time on an
// interval and on visibilitychange, because timers pause in background tabs and during sleep.
export const IDLE_LIMIT_MS = 30 * 60_000;

export function startIdleLock({
  onIdle,
  limitMs = IDLE_LIMIT_MS,
  target = document,
  now = Date.now,
}: {
  onIdle: () => void;
  limitMs?: number;
  target?: Document;
  now?: () => number;
}): { touch(): void; stop(): void } {
  let lastUse = now();
  let fired = false;
  const check = () => {
    if (!fired && now() - lastUse >= limitMs) {
      fired = true;
      onIdle();
    }
  };
  const touch = () => {
    lastUse = now();
  };
  const options = { passive: true };
  target.addEventListener('pointerdown', touch, options);
  target.addEventListener('keydown', touch, options);
  target.addEventListener('visibilitychange', check);
  const timer = setInterval(check, 15_000);
  return {
    touch,
    stop() {
      clearInterval(timer);
      target.removeEventListener('pointerdown', touch);
      target.removeEventListener('keydown', touch);
      target.removeEventListener('visibilitychange', check);
    },
  };
}
