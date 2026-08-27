import { redirect } from 'next/navigation';
import { currentUser } from '../src/server/auth';

export default async function Home() {
  redirect((await currentUser()) ? '/files' : '/signin');
}
