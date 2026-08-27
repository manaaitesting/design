import { notFound, redirect } from 'next/navigation';
import { currentUser, issueSyncToken } from '../../../src/server/auth';
import { getFileFor, touchFile } from '../../../src/server/db';
import { Editor } from '../../../src/components/Editor';
import { SessionProvider } from '../../../src/components/Session';

export default async function FilePage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;

  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/f/${room}`)}`);

  // membership check — an unshared file is invisible even if you know its id
  const file = getFileFor(room, user.id);
  if (!file) notFound();

  touchFile(room);

  return (
    <SessionProvider
      room={room}
      identity={{ id: user.id, name: user.name, color: user.color }}
      token={issueSyncToken(user.id, room)}
    >
      <Editor fileName={file.name} />
    </SessionProvider>
  );
}
