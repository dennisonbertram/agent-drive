import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { clerkConfigured } from '@/src/console/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Drive',
  description: 'Encrypted, persistent workspaces for independent agents.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {clerkConfigured() ? (
          <ClerkProvider
            signInUrl="/sign-in"
            signUpUrl="/sign-up"
            signInFallbackRedirectUrl="/console"
            signUpFallbackRedirectUrl="/console"
          >
            {children}
          </ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
