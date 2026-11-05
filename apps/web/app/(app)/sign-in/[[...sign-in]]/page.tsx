import { SignIn } from '@clerk/nextjs';
import { BrandMark } from '../../../brand-mark';
import { clerkConfigured } from '@/src/console/auth';
import { t1Appearance } from '../../sign-in/appearance';
import '../../../styles/account.css';

export default function SignInPage() {
  return (
    <main className="auth-page">
      <BrandMark />
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
            Sign-in is not configured on this installation. Configure the Agent Drive Clerk instance
            to enable human access.
          </p>
        </section>
      )}
    </main>
  );
}
