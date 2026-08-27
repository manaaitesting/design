import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../src/server/auth';
import { signUp } from '../../src/server/actions';
import { AuthForm } from '../../src/components/AuthForm';

export default async function SignUpPage() {
  if (await currentUser()) redirect('/files');
  return (
    <AuthForm
      action={signUp}
      title="Create an account"
      subtitle="A connected canvas for you and your team."
      submitLabel="Create account"
      withName
      footer={
        <>
          Already have an account? <Link href="/signin">Sign in</Link>
        </>
      }
    />
  );
}
