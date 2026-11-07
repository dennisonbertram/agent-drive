'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A button that opens a small menu in the top layer (native popover: Esc and click-outside close it,
 * and the panel's overflow cannot clip it). Tab moves through the buttons inside; no arrow keys.
 */
export function MenuButton({
  label,
  ariaLabel,
  className = '',
  testId,
  menuTestId,
  menuClassName = '',
  align = 'end',
  children,
}: {
  label: ReactNode;
  ariaLabel?: string;
  className?: string;
  testId?: string;
  menuTestId?: string;
  menuClassName?: string;
  align?: 'start' | 'end';
  children: ReactNode;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const popover = menu.current;
    if (!popover) return;
    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      const anchor = button.current;
      if (!isOpen || !anchor) return;
      // Right-aligned under the button; flipped above it when it would leave the viewport.
      const rect = anchor.getBoundingClientRect();
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const wanted = align === 'start' ? rect.left : rect.right - width;
      const left = Math.max(8, Math.min(wanted, window.innerWidth - width - 8));
      const below = rect.bottom + 6;
      const top =
        below + height > window.innerHeight && rect.top - 6 - height >= 0
          ? rect.top - 6 - height
          : below;
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };
    popover.addEventListener('toggle', onToggle);
    return () => popover.removeEventListener('toggle', onToggle);
  }, [align]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        popoverTarget={id}
        aria-controls={id}
        aria-expanded={open}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        {label}
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className={`menu-popover ${menuClassName}`}
        data-testid={menuTestId}
      >
        {children}
      </div>
    </>
  );
}
