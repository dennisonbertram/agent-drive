import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { publicOrigin } from '@/src/content/origin';
import './globals.css';

const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

// Absolute social URLs follow the origin the page is served from, so previews and local runs
// advertise their own og:image instead of production's. AGENT_DRIVE_PUBLIC_URL pins it.
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  return {
    metadataBase: new URL(publicOrigin(h)),
    title: 'Agent Drive',
    description:
      "Encrypted storage your agents keep across sandboxes. Files are encrypted on the agent's machine and survive sandboxes, machines and platform switches.",
    openGraph: { siteName: 'Agent Drive', type: 'website' },
    twitter: {
      card: 'summary_large_image',
      title: 'Agent Drive',
      description: 'Encrypted storage your agents keep across sandboxes.',
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
