import { notFound, redirect } from 'next/navigation';
import { canEdit, currentUser, guestIdentity, issueSyncToken } from '../../../src/server/auth';
import { openRoom } from '../../../src/server/queries';
import { Editor } from '../../../src/components/Editor';
import { FileTabs } from '../../../src/components/FileTabs';
import { SessionProvider } from '../../../src/components/Session';

export default async function FilePage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  const user = await currentUser();

  // Which of the three ways into a file wins, and what a failure means, is a
  // decision rather than a render — so it lives in the server layer where a
  // test can reach it. The route's job is only to turn the answer into a
  // navigation: a 404 rather than a 403, because knowing a room id should not
  // confirm that the room exists.
  const access = openRoom(room, user?.id ?? null);
  if (!access.ok) {
    if (access.reason === 'sign-in') redirect(`/signin?next=${encodeURIComponent(`/f/${room}`)}`);
    notFound();
  }

  const { file, role, tabs, folders } = access;
  const identity = user ?? (await guestIdentity());
  // what the file menu needs to know about the file that the document does not
  const meta = {
    id: room,
    name: file.name,
    owned: Boolean(user && file.owner_id === user.id),
    signedIn: Boolean(user),
    folderId: file.folder_id ?? null,
    folderName: folders.find((folder) => folder.id === file.folder_id)?.name ?? null,
    starred: Boolean(file.starred),
    folders,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {user && <FileTabs active={room} files={tabs} />}
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* Switching tabs is a param change on one route, so React would keep
            this subtree mounted and hand the editor a new file while every ref
            inside it still described the last one. The key makes a file change
            a remount, which is what it is. */}
        <SessionProvider
          key={room}
          room={room}
          identity={{ id: identity.id, name: identity.name, color: identity.color }}
          token={issueSyncToken(identity.id, room, role)}
          readOnly={!canEdit(role)}
        >
          <Editor fileName={file.name} room={room} file={meta} />
        </SessionProvider>
      </div>
    </div>
  );
}
