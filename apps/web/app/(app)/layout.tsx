import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { clerkConfigured } from '@/src/console/auth';

export default function AppLayout({ children }: { children: ReactNode }) {
  return clerkConfigured() ? (
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
  );
}
