import { SignUp } from '@clerk/nextjs';
import { BrandMark } from '../../../brand-mark';
import { clerkConfigured } from '@/src/console/auth';
import { t1Appearance } from '../../sign-in/appearance';
import '../../../styles/account.css';

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <BrandMark />
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
          <h1>Create your workspace</h1>
          <p>
            Sign-up is not configured on this installation. Configure the Agent Drive Clerk instance
            to enable human access.
          </p>
        </section>
      )}
    </main>
  );
}
