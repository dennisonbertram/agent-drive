import Link from 'next/link';

/** Shared T1 logo tile (decorative). Styles: `.brand-logo` in globals.css. */
export function BrandLogo({ className = '' }: { className?: string }) {
  return <span className={`brand-logo ${className}`.trim()} aria-hidden />;
}

/** Logo tile plus "Agent Drive" wordmark. Pass `href={null}` for a non-link. */
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
      <BrandLogo /> Agent Drive
    </>
  );
  return href === null ? (
    <span className={cls}>{body}</span>
  ) : (
    <Link href={href} className={cls}>
      {body}
    </Link>
  );
}
