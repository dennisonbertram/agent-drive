import { SignUp } from '@clerk/nextjs';
import { AuthLinks, safeRedirect, SiteHeader } from '../../../site-header';
import { clerkConfigured } from '@/src/console/auth';
import { t1Appearance } from '../../sign-in/appearance';
import '../../../styles/account.css';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const redirect = safeRedirect((await searchParams).redirect_url);
  return (
    <>
      <SiteHeader current="sign-up" />
      <main className="auth-page">
        {clerkConfigured() ? (
          <SignUp
            appearance={t1Appearance}
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
            fallbackRedirectUrl="/console"
          />
        ) : (
          <section className="panel">
            <h1>Create your account</h1>
            <p>
              Sign-up is not configured on this installation. Configure the Agent Drive Clerk
              instance to enable human access.
            </p>
          </section>
        )}
        <AuthLinks to="sign-in" redirect={redirect} />
      </main>
    </>
  );
}
