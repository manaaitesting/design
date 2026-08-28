import { notFound, redirect } from 'next/navigation';
import { canEdit, currentUser, issueSyncToken, roleOf } from '../../../src/server/auth';
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

  const role = roleOf(file.role);
  // a viewer never writes, so their visit does not count as activity either
  if (canEdit(role)) touchFile(room);

  return (
    <SessionProvider
      room={room}
      identity={{ id: user.id, name: user.name, color: user.color }}
      token={issueSyncToken(user.id, room, role)}
      readOnly={!canEdit(role)}
    >
      <Editor fileName={file.name} />
    </SessionProvider>
  );
}
