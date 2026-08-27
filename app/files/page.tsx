import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../src/server/auth';
import { listFiles, listMembers } from '../../src/server/db';
import { deleteFileAction, newFile, renameFileAction, signOut } from '../../src/server/actions';
import { Icon } from '../../src/components/ui/Icons';
import { ShareControl } from '../../src/components/ShareControl';
import { readableOn } from '../../src/lib/color';

function ago(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(timestamp).toLocaleDateString();
}

export default async function FilesPage() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const files = listFiles(user.id);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-canvas)' }}>
      <header
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 24px',
          background: 'var(--color-panel)',
          borderBottom: '1px solid var(--color-line)',
        }}
      >
        <Icon.Logo />
        <span style={{ fontWeight: 500 }}>Paperlike</span>
        <div style={{ flex: 1 }} />
        <span
          title={user.email}
          style={{
            width: 24,
            height: 24,
            borderRadius: 999,
            background: user.color,
            color: readableOn(user.color),
            display: 'grid',
            placeItems: 'center',
            fontWeight: 500,
          }}
        >
          {user.name.charAt(0).toUpperCase()}
        </span>
        <span style={{ color: 'var(--color-ink-muted)' }}>{user.name}</span>
        <form action={signOut}>
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Files</h1>
          <span style={{ color: 'var(--color-ink-dim)' }}>
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
          <div style={{ flex: 1 }} />
          <form action={newFile}>
            <button type="submit" className="btn btn-raised">
              <Icon.Plus />
              New file
            </button>
          </form>
        </div>

        {files.length === 0 ? (
          <div
            style={{
              padding: '64px 24px',
              textAlign: 'center',
              background: 'var(--color-panel)',
              borderRadius: 10,
              border: '1px solid var(--color-line)',
            }}
          >
            <p style={{ fontWeight: 500, margin: '0 0 6px' }}>No files yet</p>
            <p style={{ color: 'var(--color-ink-muted)', margin: 0 }}>
              Create one to open the canvas, then share it to design together.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {files.map((file) => {
              const members = listMembers(file.id);
              const owned = file.owner_id === user.id;
              return (
                <div
                  key={file.id}
                  style={{
                    background: 'var(--color-panel)',
                    border: '1px solid var(--color-line)',
                    borderRadius: 10,
                    overflow: 'hidden',
                  }}
                >
                  <Link
                    href={`/f/${file.id}`}
                    style={{
                      display: 'block',
                      height: 120,
                      background:
                        'radial-gradient(at 22% 26%, #BDEE63 0px, transparent 55%), radial-gradient(at 78% 20%, #4CC3F0 0px, transparent 50%), radial-gradient(at 55% 85%, #9B7BF0 0px, transparent 55%), #F7F7F7',
                      borderBottom: '1px solid var(--color-line)',
                    }}
                  />
                  <div style={{ padding: 10 }}>
                    <form action={renameFileAction} style={{ display: 'flex', gap: 6 }}>
                      <input type="hidden" name="id" value={file.id} />
                      <input
                        name="name"
                        defaultValue={file.name}
                        readOnly={!owned}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          height: 24,
                          padding: '0 6px',
                          border: 0,
                          borderRadius: 5,
                          background: 'transparent',
                          fontWeight: 500,
                          outline: 'none',
                        }}
                      />
                    </form>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 6,
                        padding: '0 6px',
                        color: 'var(--color-ink-dim)',
                      }}
                    >
                      <span>
                        {owned ? 'You' : file.owner_name} · {ago(file.updated_at)}
                      </span>
                      <div style={{ flex: 1 }} />
                      <div style={{ display: 'flex' }}>
                        {members.slice(0, 4).map((member) => (
                          <span
                            key={member.id}
                            title={member.name}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 999,
                              marginLeft: -4,
                              background: member.color,
                              color: readableOn(member.color),
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: 10,
                              fontWeight: 500,
                              boxShadow: '0 0 0 2px var(--color-panel)',
                            }}
                          >
                            {member.name.charAt(0).toUpperCase()}
                          </span>
                        ))}
                      </div>
                    </div>

                    {owned && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <ShareControl fileId={file.id} />
                        <form action={deleteFileAction}>
                          <input type="hidden" name="id" value={file.id} />
                          <button type="submit" className="btn" title="Delete file">
                            Delete
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
