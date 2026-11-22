import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { clerkConfigured } from '@/src/console/auth';
import { VaultKeyGuard } from './console/vault-key-guard';

export default function AppLayout({ children }: { children: ReactNode }) {
  return clerkConfigured() ? (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/console"
      signUpFallbackRedirectUrl="/console"
    >
      <VaultKeyGuard clerkEnabled />
      {children}
    </ClerkProvider>
  ) : (
    children
  );
}
