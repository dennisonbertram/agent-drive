'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * A button that opens a small menu in the top layer (native popover: Esc and click-outside close it,
 * and the panel's overflow cannot clip it). Opening focuses the first button; Arrow Up/Down (wrapping),
 * Home and End move between the buttons; Tab keeps its normal behaviour. No ARIA menu roles, because
 * some menus hold plain text.
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
    const position = () => {
      const anchor = button.current;
      if (!popover.matches(':popover-open') || !anchor) return;
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
    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      window.removeEventListener('resize', position);
      if (!isOpen) return;
      position();
      window.addEventListener('resize', position);
      popover
        .querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus({ preventScroll: true });
    };
    popover.addEventListener('toggle', onToggle);
    return () => {
      popover.removeEventListener('toggle', onToggle);
      window.removeEventListener('resize', position);
    };
  }, [align]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ];
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

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
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </>
  );
}
