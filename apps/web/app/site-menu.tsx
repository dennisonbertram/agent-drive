'use client';

import { useEffect, useState } from 'react';

/** Menu button for the popover nav. Mirrors the popover's open state into aria-expanded. */
export function SiteMenuButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const nav = document.getElementById('site-nav');
    if (!nav) return;
    const sync = (e: Event) => setOpen((e as ToggleEvent).newState === 'open');
    nav.addEventListener('toggle', sync);
    return () => nav.removeEventListener('toggle', sync);
  }, []);
  return (
    <button
      className="site-menu"
      popoverTarget="site-nav"
      type="button"
      aria-controls="site-nav"
      aria-expanded={open}
    >
      Menu
    </button>
  );
}
