import { SignUp } from '@clerk/nextjs';
import Link from 'next/link';
import { clerkConfigured } from '@/src/console/auth';

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <Link href="/" className="brand">
        <span className="brand-mark">a/</span> agent drive
      </Link>
      {clerkConfigured() ? (
        <SignUp
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
