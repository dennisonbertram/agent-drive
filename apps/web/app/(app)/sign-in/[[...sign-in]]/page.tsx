import type { Metadata } from 'next';
import { SignIn } from '@clerk/nextjs';
import { AuthLinks, safeRedirect, SiteHeader } from '../../../site-header';
import { clerkConfigured } from '@/src/console/auth';
import { t1Appearance } from '../../sign-in/appearance';
import '../../../styles/account.css';

export const metadata: Metadata = {
  title: 'Sign in | Agent Drive',
  description: 'Sign in to Agent Drive to manage your drives, agents and billing.',
  alternates: { canonical: '/sign-in' },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const redirect = safeRedirect((await searchParams).redirect_url);
  return (
    <>
      <SiteHeader current="sign-in" />
      <main className="auth-page">
        {clerkConfigured() ? (
          <SignIn
            appearance={t1Appearance}
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
            fallbackRedirectUrl="/console"
          />
        ) : (
          <section className="panel">
            <h1>Sign in</h1>
            <p>
              Sign-in is not configured on this installation. Configure the Agent Drive Clerk
              instance to enable human access.
            </p>
          </section>
        )}
        <AuthLinks to="sign-up" redirect={redirect} />
      </main>
    </>
  );
}
