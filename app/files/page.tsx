import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../src/server/auth';
import { filesPage } from '../../src/server/queries';
import {
  deleteFileAction,
  deleteFolderAction,
  duplicateFileAction,
  newFile,
  newFolderAction,
  renameFileAction,
  restoreFileAction,
  signOut,
  trashFileAction,
} from '../../src/server/actions';
import { Icon } from '../../src/components/ui/Icons';
import { ShareControl } from '../../src/components/ShareControl';
import { FileViewBar } from '../../src/components/FileViewBar';
import { FileContextMenu } from '../../src/components/FileContextMenu';
import { StarButton } from '../../src/components/StarButton';
import { SubmitButton } from '../../src/components/SubmitButton';
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
type Query = { q?: string; folder?: string; sort?: string; tab?: string; view?: string; org?: string; scope?: string; trash?: string };

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const { q = '', folder = '', sort = 'recent', tab = '', view = '', org = '', scope = '', trash = '' } = await searchParams;
  const sortBy = sort === 'name' || sort === 'created' ? sort : 'recent';
  // The trash is a view of its own — "Move to trash" in the file menu lands a
  // file here, and only here can it be restored or deleted for good.
  const showTrash = trash === '1';
  const { folders, files, total, current, trashed } = filesPage(user.id, {
    q,
    folder,
    sort: sortBy,
    trash: showTrash,
  });
  const filtered = Boolean(q || folder || showTrash);

  // View bar state – Figma file_browser_page_view tabs + filters + view mode
  const activeTab = tab === 'shared-with-you' || tab === 'shared-projects' || tab === 'shared-folders' ? (tab as 'shared-with-you' | 'shared-projects') : 'recently-viewed';
  // normalize shared-folders vs shared-projects
  const normalizedTab = tab === 'shared-folders' ? 'shared-projects' : activeTab;
  const viewMode = view === 'list' ? 'list' : 'grid';

  // Apply tab + scope filtering on top of the server query (keeps URL shareable)
  let displayFiles = files;
  if (normalizedTab === 'shared-with-you') {
    displayFiles = displayFiles.filter((f) => f.owner_id !== user.id);
  } else if (normalizedTab === 'shared-projects') {
    // "Shared folders" – show only files that live in a folder (the Figma equivalent of a project)
    displayFiles = displayFiles.filter((f) => f.folder_id);
  }
  if (scope === 'owned') displayFiles = displayFiles.filter((f) => f.owner_id === user.id);
  else if (scope === 'shared') displayFiles = displayFiles.filter((f) => f.owner_id !== user.id);
  else if (scope === 'starred') displayFiles = displayFiles.filter((f) => f.starred);

  /** A link to this same view with one thing changed. */
  const href = (patch: Query) => {
    const next = new URLSearchParams();
    const merged = { q, folder, sort: sortBy, trash, ...patch };
    if (merged.q) next.set('q', merged.q);
    if (merged.folder) next.set('folder', merged.folder);
    if (merged.trash === '1') next.set('trash', '1');
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
          <SubmitButton>Sign out</SubmitButton>
        </form>
      </header>

      <main style={{ maxWidth: 1588, margin: '0 auto', padding: '32px 24px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
            {showTrash ? 'Trash' : current ? current.name : 'Files'}
          </h1>
          <span style={{ color: 'var(--color-ink-dim)' }}>
            {displayFiles.length} {displayFiles.length === 1 ? 'file' : 'files'}
            {(filtered || normalizedTab !== 'recently-viewed' || scope) && total !== displayFiles.length ? ` of ${total}` : ''}
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
          </form>

          <form action={newFile}>
            <SubmitButton className="btn btn-raised">
              <Icon.Plus />
              New file
            </SubmitButton>
          </form>
        </div>

        <FileViewBar activeTab={normalizedTab as any} viewMode={viewMode as any} orgValue={org} scopeValue={scope} />

        {/* Folders, as a row of chips: a filter on one list rather than a second
            tree. The Trash sits at the end of the row — a file the menu moved
            there is found here, and only here can it be restored. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            margin: '0 0 18px',
          }}
        >
          <Link
            href={href({ folder: '', trash: '' })}
            className="btn"
            style={{
              textDecoration: 'none',
              ...(folder || showTrash ? {} : { background: 'var(--color-row-active)', color: 'var(--color-ink)' }),
            }}
          >
            All files
          </Link>
          {folders.map((entry) => (
            <Link
              key={entry.id}
              href={href({ folder: entry.id, trash: '' })}
              className="btn"
              style={{
                textDecoration: 'none',
                ...(folder === entry.id && !showTrash
                  ? { background: 'var(--color-row-active)', color: 'var(--color-ink)' }
                  : {}),
              }}
            >
              {entry.name}
              <span style={{ color: 'var(--color-ink-dim)' }}>{entry.count}</span>
            </Link>
          ))}
          <Link
            href={href({ folder: '', trash: '1' })}
            className="btn"
            title="Files moved to the trash"
            style={{
              textDecoration: 'none',
              ...(showTrash ? { background: 'var(--color-row-active)', color: 'var(--color-ink)' } : {}),
            }}
          >
            Trash
            <span style={{ color: 'var(--color-ink-dim)' }}>{trashed}</span>
          </Link>

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

          {current && !showTrash && (
            <>
              <div style={{ flex: 1 }} />
              <form action={deleteFolderAction}>
                <input type="hidden" name="id" value={current.id} />
                <SubmitButton title="Delete this folder — the files in it stay">
                  Delete folder
                </SubmitButton>
              </form>
            </>
          )}
        </div>

        {displayFiles.length === 0 ? (
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
              {filtered || normalizedTab !== 'recently-viewed' || scope ? 'Nothing here' : 'No files yet'}
            </p>
            <p style={{ color: 'var(--color-ink-muted)', margin: 0 }}>
              {filtered || normalizedTab !== 'recently-viewed' || scope ? (
                <Link href="/files">Clear the search and look at everything</Link>
              ) : (
                'Create one to open the canvas, then share it to design together.'
              )}
            </p>
          </div>
        ) : viewMode === 'list' ? (
          <div style={{ border: '1px solid #e5e5e5', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            {displayFiles.map((file) => {
              const { members } = file;
              const owned = file.owner_id === user.id;
              return (
                <FileContextMenu key={file.id} file={{ id: file.id, name: file.name, folder_id: file.folder_id, starred: file.starred } as any} folders={folders.map((f) => ({ id: f.id, name: f.name }))}>
                  <div
                    role="group"
                    aria-label={file.name}
                    className="file-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '0 12px',
                    height: 52,
                    borderBottom: '1px solid #f0f0f0',
                    position: 'relative',
                    background: '#fff',
                  }}
                >
                  <Link href={`/f/${file.id}`} aria-label={file.name} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                  <div style={{ width: 16, height: 16, flex: 'none', display: 'grid', placeItems: 'center', position: 'relative', zIndex: 1 }}>
                    <svg width="16" height="16" fill="none" viewBox="0 0 16 16" aria-label="Design file">
                      <path fill="#9747FF" d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2z" />
                      <path fill="#fff" fillRule="evenodd" d="M4.14 3.207a1 1 0 0 1 .837-.181l3.762.878a4.57 4.57 0 0 1 3.531 4.452l.437.436a1 1 0 0 1 0 1.415l-2.5 2.5a1 1 0 0 1-1.414 0l-.437-.437A4.57 4.57 0 0 1 3.96 8.949l-.054-.21-.879-3.762a1 1 0 0 1 .267-.935l.75-.75zm.59.813 2.623 2.624-.006.006a1.5 1.5 0 1 1-.697.697l-.004.004-2.624-2.624L4 4.749l.879 3.763a3.573 3.573 0 0 0 3.87 2.737l.75.75L12 9.5l-.75-.75a3.57 3.57 0 0 0-2.737-3.872L4.75 4zM8 7.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div style={{ width: 56, height: 32, flex: 'none', background: '#e5e5e5', borderRadius: 4, overflow: 'hidden', display: 'flex', position: 'relative', zIndex: 1 }}>
                    {file.thumbnail ? (
                      <img alt="" src={file.thumbnail} draggable={false} crossOrigin="anonymous" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: 'radial-gradient(at 22% 26%, #BDEE63 0px, transparent 55%), radial-gradient(at 78% 20%, #4CC3F0 0px, transparent 50%), radial-gradient(at 55% 85%, #9B7BF0 0px, transparent 55%), #F7F7F7' }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
                    <form action={renameFileAction} style={{ display: 'flex', minWidth: 0, position: 'relative', zIndex: 2 }}>
                      <input type="hidden" name="id" value={file.id} />
                      <input name="name" aria-label="File name" defaultValue={file.name} readOnly={!owned} title={file.name} style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', padding: 0, margin: 0, outline: 'none', fontSize: 13, fontWeight: 500, lineHeight: '16px', color: '#000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
                    </form>
                    <div style={{ fontSize: 12, fontWeight: 400, lineHeight: '14px', color: 'rgba(0,0,0,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Edited {ago(file.updated_at)} · {owned ? 'You' : file.owner_name}</div>
                  </div>
                  {members.length > 0 && (
                    <div style={{ display: 'flex', flex: 'none', position: 'relative', zIndex: 1 }}>
                      {members.slice(0, 4).map((member) => (
                        <span key={member.id} title={member.name} style={{ width: 20, height: 20, borderRadius: 999, marginLeft: -4, background: member.color, color: readableOn(member.color), display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 600, boxShadow: '0 0 0 2px #fff', border: '1px solid rgba(0,0,0,0.06)' }}>{member.name.charAt(0).toUpperCase()}</span>
                      ))}
                    </div>
                  )}
                  <div className="file-row-actions" style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative', zIndex: 1 }}>
                    {owned && <ShareControl fileId={file.id} linkRole={file.link_role} />}
                    <form action={duplicateFileAction}>
                      <input type="hidden" name="id" value={file.id} />
                      <button type="submit" className="btn" title="Make a copy you own">Duplicate</button>
                    </form>
                    {owned && showTrash && (
                      <form action={restoreFileAction}>
                        <input type="hidden" name="id" value={file.id} />
                        <button type="submit" className="btn btn-raised" title="Put the file back">Restore</button>
                      </form>
                    )}
                    {owned && (
                      <form action={showTrash ? deleteFileAction : trashFileAction}>
                        <input type="hidden" name="id" value={file.id} />
                        <button type="submit" className="btn" title={showTrash ? 'Delete the file for good' : 'Move the file to the trash'}>
                          {showTrash ? 'Delete forever' : 'Move to trash'}
                        </button>
                      </form>
                    )}
                  </div>
                  <button type="button" aria-label="Add to Starred" aria-pressed="false" data-testid="favorite-star-button" title="Add to sidebar" style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: 'rgba(0,0,0,0.32)', flex: 'none', position: 'relative', zIndex: 1 }}>
                    <svg width="16" height="16" fill="none" viewBox="0 0 16 16" style={{ display: 'block' }}>
                      <path fill="currentColor" fillRule="evenodd" d="M8.952 2.195a1 1 0 0 0-1.904 0L6.148 5H3.245a1 1 0 0 0-.58 1.815L4.993 8.47l-.937 2.701a1 1 0 0 0 1.516 1.148L8 10.63l2.429 1.691a1 1 0 0 0 1.516-1.148l-.938-2.701 2.328-1.656A1 1 0 0 0 12.755 5H9.853zM4.97 6h1.908l.597-1.863L8 2.5l.525 1.637L9.123 6h3.633l-1.407 1-1.532 1.09.625 1.802L11 11.5l-1.396-.973L8 9.41l-1.604 1.117L5 11.5l.558-1.608.626-1.802L4.65 7 3.245 6z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                </FileContextMenu>
              );
            })}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 295px)', gap: 16, justifyContent: 'start' }}>
              {displayFiles.map((file) => {
                const { members } = file;
                const owned = file.owner_id === user.id;
                return (
                  <FileContextMenu key={file.id} file={{ id: file.id, name: file.name, folder_id: file.folder_id, starred: file.starred } as any} folders={folders.map((f) => ({ id: f.id, name: f.name }))}>
                    <div
                      role="group"
                      aria-label={file.name}
                      draggable={true}
                      className="file-card"
                    style={{
                      width: 295,
                      height: 225,
                      background: '#fff',
                      border: '1px solid #e5e5e5',
                      borderRadius: 12,
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      position: 'relative',
                      transition: 'border-color 120ms ease, box-shadow 120ms ease',
                      flex: 'none',
                    }}
                  >
                    {/* Main card action – covers card, Figma-style */}
                    <Link href={`/f/${file.id}`} aria-label={file.name} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                    {/* Thumbnail – #E5E5E5 band, contain – 295×169 (225-56 footer) */}
                    <div
                      style={{
                        width: 295,
                        height: 169,
                        flex: 'none',
                        backgroundColor: '#e5e5e5',
                        overflow: 'hidden',
                        display: 'flex',
                        position: 'relative',
                        zIndex: 0,
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: file.thumbnail ? 8 : 0,
                          overflow: 'hidden',
                          backgroundColor: '#e5e5e5',
                        }}
                      >
                        {file.thumbnail ? (
                          <img
                            alt=""
                            src={file.thumbnail}
                            draggable={false}
                            crossOrigin="anonymous"
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'contain',
                              display: 'block',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              background:
                                'radial-gradient(at 22% 26%, #BDEE63 0px, transparent 55%), radial-gradient(at 78% 20%, #4CC3F0 0px, transparent 50%), radial-gradient(at 55% 85%, #9B7BF0 0px, transparent 55%), #F7F7F7',
                            }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Footer – purple icon · title / Edited… · avatars · star */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 12px',
                        background: '#fff',
                        borderTop: '1px solid #ececec',
                        minHeight: 56,
                        position: 'relative',
                        zIndex: 1,
                      }}
                    >
                      <div style={{ width: 16, height: 16, flex: 'none', display: 'grid', placeItems: 'center' }}>
                        <svg width="16" height="16" fill="none" viewBox="0 0 16 16" aria-label="Design file">
                          <path fill="#9747FF" d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2z" />
                          <path
                            fill="#fff"
                            fillRule="evenodd"
                            d="M4.14 3.207a1 1 0 0 1 .837-.181l3.762.878a4.57 4.57 0 0 1 3.531 4.452l.437.436a1 1 0 0 1 0 1.415l-2.5 2.5a1 1 0 0 1-1.414 0l-.437-.437A4.57 4.57 0 0 1 3.96 8.949l-.054-.21-.879-3.762a1 1 0 0 1 .267-.935l.75-.75zm.59.813 2.623 2.624-.006.006a1.5 1.5 0 1 1-.697.697l-.004.004-2.624-2.624L4 4.749l.879 3.763a3.573 3.573 0 0 0 3.87 2.737l.75.75L12 9.5l-.75-.75a3.57 3.57 0 0 0-2.737-3.872L4.75 4zM8 7.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>

                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          // name over date on the left, the card's actions beside
                          // them on the right — one box, so the actions belong to
                          // the title they act on
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) auto',
                          alignItems: 'center',
                          columnGap: 8,
                          rowGap: 1,
                          overflow: 'hidden',
                          position: 'relative',
                          zIndex: 2,
                        }}
                      >
                        <form action={renameFileAction} style={{ display: 'flex', minWidth: 0, position: 'relative', zIndex: 2, gridColumn: 1 }}>
                          <input type="hidden" name="id" value={file.id} />
                          <input
                            name="name"
                            aria-label="File name"
                            defaultValue={file.name}
                            readOnly={!owned}
                            title={file.name}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              border: 0,
                              background: 'transparent',
                              padding: 0,
                              margin: 0,
                              outline: 'none',
                              fontSize: 13,
                              fontWeight: 500,
                              lineHeight: '16px',
                              color: '#000',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          />
                        </form>
                        <div
                          style={{
                            gridColumn: 1,
                            fontSize: 12,
                            fontWeight: 400,
                            lineHeight: '14px',
                            color: 'rgba(0,0,0,0.5)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          Edited {ago(file.updated_at)}
                        </div>
                        {owned && (
                          <div className="file-card-actions" style={{ gridColumn: 2, gridRow: '1 / span 2', display: 'flex', gap: 6 }}>
                            <ShareControl fileId={file.id} linkRole={file.link_role} />
                          </div>
                        )}
                      </div>

                      {members.length > 0 && (
                        <div style={{ display: 'flex', marginRight: 2, flex: 'none', position: 'relative', zIndex: 2 }}>
                          {members.slice(0, 3).map((member) => (
                            <span
                              key={member.id}
                              title={member.name}
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 999,
                                marginLeft: -4,
                                background: member.color,
                                color: readableOn(member.color),
                                display: 'grid',
                                placeItems: 'center',
                                fontSize: 10,
                                fontWeight: 600,
                                boxShadow: '0 0 0 2px #fff',
                                border: '1px solid rgba(0,0,0,0.06)',
                              }}
                            >
                              {member.name.charAt(0).toUpperCase()}
                            </span>
                          ))}
                        </div>
                      )}

                      <StarButton fileId={file.id} starred={file.starred as any} />
                    </div>
                  </div>
                  </FileContextMenu>
                );
              })}
            </div>
            <style>{`
              .file-card:hover { border-color: #d6d6d6 !important; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
              .file-card .star-btn { opacity: 0; transition: opacity 80ms ease, background 80ms ease, color 80ms ease; }
              .file-card:hover .star-btn, .file-card:focus-within .star-btn { opacity: 1; }
              .file-card .star-btn:hover { background: rgba(0,0,0,0.06) !important; color: rgba(0,0,0,0.58) !important; }
              .file-card-quick-actions { opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
              .file-card:hover .file-card-quick-actions, .file-card:focus-within .file-card-quick-actions { opacity: 1; pointer-events: auto; }
              @media (hover: none) {
                .file-card .star-btn, .file-card-quick-actions { opacity: 1; pointer-events: auto; }
              }
            `}</style>
          </>
        )}
      </main>
    </div>
  );
}
