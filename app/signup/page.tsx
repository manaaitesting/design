import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../src/server/auth';
import { signUp } from '../../src/server/actions';
import { AuthForm } from '../../src/components/AuthForm';
import { safeNext } from '../../src/lib/next';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // the commonest way into this page is a file link sent to someone who has no
  // account yet, so the destination has to survive the hop from sign-in
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next ?? '/files');
  return (
    <AuthForm
      action={signUp}
      title="Create an account"
      subtitle={
        next ? 'Create an account to open this file.' : 'A connected canvas for you and your team.'
      }
      submitLabel="Create account"
      withName
      next={next}
      footer={
        <>
          Already have an account?{' '}
          <Link href={next ? `/signin?next=${encodeURIComponent(next)}` : '/signin'}>Sign in</Link>
        </>
      }
    />
  );
}
