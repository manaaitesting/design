import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../src/server/auth';
import { signIn } from '../../src/server/actions';
import { AuthForm } from '../../src/components/AuthForm';

export default async function SignInPage() {
  if (await currentUser()) redirect('/files');
  return (
    <AuthForm
      action={signIn}
      title="Sign in"
      subtitle="Pick up where your team left off."
      submitLabel="Sign in"
      footer={
        <>
          New here? <Link href="/signup">Create an account</Link>
        </>
      }
    />
  );
}
