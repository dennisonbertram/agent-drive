import Link from 'next/link';

/** Shared square-with-bar logo mark (decorative). Styles: `.brand-logo` in globals.css. */
export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`brand-logo ${className}`.trim()}
      viewBox="0 0 16 16"
      aria-hidden
      focusable="false"
    >
      <rect
        x="0.75"
        y="0.75"
        width="14.5"
        height="14.5"
        rx="3"
        fill="#fff"
        stroke="#111"
        strokeWidth="1.5"
      />
      <rect x="2" y="11" width="12" height="3" fill="#111" />
    </svg>
  );
}

/** Logo mark plus "Agent Drive" wordmark. Pass `href={null}` for a non-link. */
export function BrandMark({
  href = '/',
  className = '',
}: {
  href?: string | null;
  className?: string;
}) {
  const cls = `brand ${className}`.trim();
  const body = (
    <>
      <BrandLogo /> <span className="brand-text">Agent Drive</span>
    </>
  );
  return href === null ? (
    <span className={cls}>{body}</span>
  ) : (
    <Link href={href} className={cls} aria-label="Agent Drive">
      {body}
    </Link>
  );
}
