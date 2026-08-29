import { notFound, redirect } from 'next/navigation';
import {
  canEdit,
  currentUser,
  guestIdentity,
  issueSyncToken,
  roleOf,
} from '../../../src/server/auth';
import { getFileByLink, getFileFor, listFiles, touchFile } from '../../../src/server/db';
import { Editor } from '../../../src/components/Editor';
import { FileTabs } from '../../../src/components/FileTabs';
import { SessionProvider } from '../../../src/components/Session';

export default async function FilePage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  const user = await currentUser();

  /*
   * Three ways in, in order of authority.
   *
   * A membership row is the strongest claim and wins even over a more generous
   * link — an editor invited by email is not demoted because the link is
   * view-only. Failing that, the file's `link_role` lets anyone through, signed
   * in or not; a visitor with no account gets a guest identity so their cursor
   * has a name. If neither applies the file is invisible, and it is a 404
   * rather than a 403: knowing a room id should not confirm that the room
   * exists.
   */
  const member = user ? getFileFor(room, user.id) : undefined;
  const file = member ?? getFileByLink(room);
  if (!file) {
    // signing in might turn this into a membership, so ask before giving up
    if (!user) redirect(`/signin?next=${encodeURIComponent(`/f/${room}`)}`);
    notFound();
  }

  const identity = user ?? (await guestIdentity());
  const role = roleOf(file.role);
  // a viewer never writes, so their visit does not count as activity either
  if (canEdit(role)) touchFile(room);

  // The tab strip names files the browser only knows by id, and a file that has
  // left this list has left your account — its tab goes with it. A link visitor
  // has no file browser to tab between, so they get the canvas and nothing else.
  const files = user
    ? listFiles(user.id).map((row) => ({
        id: row.id,
        name: row.name,
        owned: row.owner_id === user.id,
      }))
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {user && <FileTabs active={room} files={files} />}
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
          <Editor fileName={file.name} room={room} />
        </SessionProvider>
      </div>
    </div>
  );
}
