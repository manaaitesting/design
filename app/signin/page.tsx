import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../src/server/auth';
import { signIn } from '../../src/server/actions';
import { AuthForm } from '../../src/components/AuthForm';
import { safeNext } from '../../src/lib/next';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Where the file route sent them, if it did. Being bounced off a link is a
  // different errand from coming here to sign in, and this page is the only
  // place that knows which of the two happened.
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next ?? '/files');
  return (
    <AuthForm
      action={signIn}
      title="Sign in"
      subtitle={next ? 'Sign in to open this file.' : 'Pick up where your team left off.'}
      submitLabel="Sign in"
      next={next}
      footer={
        <>
          New here?{' '}
          <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}>
            Create an account
          </Link>
        </>
      }
    />
  );
}
