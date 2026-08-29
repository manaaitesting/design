import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../src/server/auth';
import { listFiles, listFolders, listMembers } from '../../src/server/db';
import {
  deleteFileAction,
  deleteFolderAction,
  duplicateFileAction,
  newFile,
  newFolderAction,
  renameFileAction,
  signOut,
} from '../../src/server/actions';
import { FolderPicker } from '../../src/components/FolderPicker';
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

/** The controls above the grid are a GET form, so a view is a shareable URL. */
type Query = { q?: string; folder?: string; sort?: string };

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const { q = '', folder = '', sort = 'recent' } = await searchParams;
  const folders = listFolders(user.id);
  const sortBy = sort === 'name' || sort === 'created' ? sort : 'recent';
  const files = listFiles(user.id, { q, folder, sort: sortBy });
  const total = listFiles(user.id).length;
  const filtered = Boolean(q || folder);
  const current = folders.find((entry) => entry.id === folder);
  // Rows come back from node:sqlite with a null prototype, and a client
  // component may only be handed plain objects — so the picker gets a copy
  // rather than the query result.
  const folderOptions = folders.map((entry) => ({ id: entry.id, name: entry.name }));

  /** A link to this same view with one thing changed. */
  const href = (patch: Query) => {
    const next = new URLSearchParams();
    const merged = { q, folder, sort: sortBy, ...patch };
    if (merged.q) next.set('q', merged.q);
    if (merged.folder) next.set('folder', merged.folder);
    if (merged.sort && merged.sort !== 'recent') next.set('sort', merged.sort);
    const search = next.toString();
    return search ? `/files?${search}` : '/files';
  };

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
            {current ? current.name : 'Files'}
          </h1>
          <span style={{ color: 'var(--color-ink-dim)' }}>
            {files.length} {files.length === 1 ? 'file' : 'files'}
            {filtered && total !== files.length ? ` of ${total}` : ''}
          </span>
          <div style={{ flex: 1 }} />

          {/* A GET form, so the view you are looking at is a URL you can send
              to yourself. The hidden fields carry the rest of the query, or
              searching would silently drop the folder you were in. */}
          <form method="get" action="/files" style={{ display: 'flex', gap: 6 }}>
            {folder && <input type="hidden" name="folder" value={folder} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search files"
              aria-label="Search files"
              style={{
                width: 168,
                height: 24,
                padding: '0 8px',
                border: 0,
                borderRadius: 5,
                background: 'var(--color-control)',
                boxShadow: 'var(--shadow-control)',
                outline: 'none',
              }}
            />
            <select
              name="sort"
              defaultValue={sortBy}
              aria-label="Sort files"
              style={{
                height: 24,
                border: 0,
                borderRadius: 5,
                padding: '0 4px',
                background: 'var(--color-control)',
                boxShadow: 'var(--shadow-control)',
                outline: 'none',
              }}
            >
              <option value="recent">Recently edited</option>
              <option value="created">Recently created</option>
              <option value="name">Name</option>
            </select>
            <button type="submit" className="btn">
              Search
            </button>
          </form>

          <form action={newFile}>
            <button type="submit" className="btn btn-raised">
              <Icon.Plus />
              New file
            </button>
          </form>
        </div>

        {/* Folders, as a row of chips rather than a sidebar: they are a filter
            on one list, not a second tree to keep in your head. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            marginBottom: 18,
          }}
        >
          <Link
            href={href({ folder: '' })}
            className="btn"
            style={{
              textDecoration: 'none',
              ...(folder ? {} : { background: 'var(--color-row-active)', color: 'var(--color-ink)' }),
            }}
          >
            All files
          </Link>
          {folders.map((entry) => (
            <Link
              key={entry.id}
              href={href({ folder: entry.id })}
              className="btn"
              style={{
                textDecoration: 'none',
                ...(folder === entry.id
                  ? { background: 'var(--color-row-active)', color: 'var(--color-ink)' }
                  : {}),
              }}
            >
              {entry.name}
              <span style={{ color: 'var(--color-ink-dim)' }}>{entry.count}</span>
            </Link>
          ))}

          <form action={newFolderAction} style={{ display: 'flex', gap: 6 }}>
            <input
              name="name"
              placeholder="New folder"
              aria-label="New folder name"
              required
              style={{
                width: 120,
                height: 24,
                padding: '0 8px',
                border: 0,
                borderRadius: 5,
                background: 'var(--color-control)',
                boxShadow: 'var(--shadow-control)',
                outline: 'none',
              }}
            />
            <button type="submit" className="btn" title="Create the folder">
              <Icon.Plus />
            </button>
          </form>

          {current && (
            <>
              <div style={{ flex: 1 }} />
              <form action={deleteFolderAction}>
                <input type="hidden" name="id" value={current.id} />
                <button type="submit" className="btn" title="Delete this folder — the files in it stay">
                  Delete folder
                </button>
              </form>
            </>
          )}
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
            <p style={{ fontWeight: 500, margin: '0 0 6px' }}>
              {filtered ? 'Nothing here' : 'No files yet'}
            </p>
            <p style={{ color: 'var(--color-ink-muted)', margin: 0 }}>
              {filtered ? (
                <Link href="/files">Clear the search and look at everything</Link>
              ) : (
                'Create one to open the canvas, then share it to design together.'
              )}
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
                  {/* the editor captures a picture of the first artboard; the
                      gradient is what a file that has never been opened gets */}
                  <Link
                    href={`/f/${file.id}`}
                    style={{
                      display: 'block',
                      height: 120,
                      background: file.thumbnail
                        ? `#F7F7F7 url(${file.thumbnail}) center / contain no-repeat`
                        : 'radial-gradient(at 22% 26%, #BDEE63 0px, transparent 55%), radial-gradient(at 78% 20%, #4CC3F0 0px, transparent 50%), radial-gradient(at 55% 85%, #9B7BF0 0px, transparent 55%), #F7F7F7',
                      borderBottom: '1px solid var(--color-line)',
                    }}
                  />
                  <div style={{ padding: 10 }}>
                    <form action={renameFileAction} style={{ display: 'flex', gap: 6 }}>
                      <input type="hidden" name="id" value={file.id} />
                      <input
                        name="name"
                        aria-label="File name"
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

                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      {owned && (
                        <FolderPicker
                          fileId={file.id}
                          folderId={file.folder_id ?? ''}
                          folders={folderOptions}
                        />
                      )}
                      {owned && <ShareControl fileId={file.id} linkRole={file.link_role} />}
                      <form action={duplicateFileAction}>
                        <input type="hidden" name="id" value={file.id} />
                        <button type="submit" className="btn" title="Make a copy you own">
                          Duplicate
                        </button>
                      </form>
                      {owned && (
                        <form action={deleteFileAction}>
                          <input type="hidden" name="id" value={file.id} />
                          <button type="submit" className="btn" title="Delete file">
                            Delete
                          </button>
                        </form>
                      )}
                    </div>
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
