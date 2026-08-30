'use client';

import { useEffect, useState } from 'react';
import {
  compareVersionAction,
  listVersionsAction,
  restoreVersionAction,
  saveVersionAction,
} from '../server/actions';
import type { Version, VersionDiff } from '../server/history';
import { useReadOnly, useSession } from './Session';
import { useUI } from '../state/ui';
import { Icon } from './ui/Icons';

/**
 * Version history.
 *
 * The sync server has been keeping snapshots on disk all along; this is where
 * you can actually reach them. Restoring re-inserts that version's layers into
 * the live document rather than swapping the file underneath everyone — see
 * `server/history` for why that distinction matters with a CRDT.
 */
export function History() {
  const open = useUI((s) => s.historyOpen);
  const setOpen = useUI((s) => s.setHistoryOpen);
  const readOnly = useReadOnly();
  const { provider } = useSession();
  const room = provider.roomname;

  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ stamp: string; result: VersionDiff | null } | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    setNotice(null);
    let live = true;
    void listVersionsAction(room).then((list) => {
      if (live) setVersions(list);
    });
    return () => {
      live = false;
    };
  }, [open, room]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const restore = async (version: Version) => {
    setBusy(version.stamp);
    setNotice(null);
    const result = await restoreVersionAction(room, version.stamp);
    setBusy(null);
    if (result.error || !result.restored) return setNotice(result.error ?? 'Nothing came back.');
    const { layers, pages } = result.restored;
    setNotice(
      `Restored ${layers} layer${layers === 1 ? '' : 's'} into ` +
        (pages.length === 1 ? pages[0] : `${pages.length} pages`) +
        '.',
    );
  };

  const save = async () => {
    setBusy('save');
    setNotice(null);
    const result = await saveVersionAction(room, title, description);
    setBusy(null);
    if (result.error) return setNotice(result.error);
    setTitle('');
    setDescription('');
    setVersions(await listVersionsAction(room));
    setNotice(`Saved “${result.version!.title}”.`);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 400 }}
      onClick={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <div
        style={{
          width: 520,
          maxWidth: '90vw',
          maxHeight: '78vh',
          background: 'var(--color-panel)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-pop)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-head" style={{ height: 38 }}>
          <span style={{ flex: 1, fontWeight: 500 }}>Version history</span>
          <span style={{ color: 'var(--color-ink-dim)' }}>from the sync server</span>
          <button
            type="button"
            className="btn"
            style={{ width: 24, padding: 0 }}
            onClick={() => setOpen(false)}
          >
            <Icon.Close />
          </button>
        </div>

        {/* Figma's ⌥⌘S: a checkpoint you can find months later, because you
            said what it was. Here rather than on the shortcut, which this
            editor already spends on boolean subtract. */}
        {!readOnly && (
          <div className="fig-version-save">
            <input
              aria-label="Version name"
              placeholder="Name this version…"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter' && title.trim()) void save();
              }}
            />
            <input
              aria-label="Version description"
              placeholder="What changed (optional)"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <button
              type="button"
              className="btn btn-raised"
              disabled={!title.trim() || busy === 'save'}
              onClick={() => void save()}
            >
              {busy === 'save' ? '…' : 'Save'}
            </button>
          </div>
        )}

        <div className="scroll" style={{ flex: 1, padding: '4px 0 8px' }}>
          {versions === null && <p className="fig-hint">Reading the snapshot shelf…</p>}
          {versions?.length === 0 && (
            <p className="fig-hint">
              No versions yet. The sync server writes one a minute while a file is open, and keeps
              the state before anything destructive for good.
            </p>
          )}
          {versions?.map((version) => (
            <div key={version.stamp} className="fig-version">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  {version.title ??
                    (version.at ? new Date(version.at).toLocaleString() : version.stamp)}
                  {version.pinned && !version.title && (
                    <span
                      className="fig-version-pin"
                      title="Kept because the document shrank sharply just after it"
                    >
                      kept
                    </span>
                  )}
                </div>
                {version.title && (
                  // a named version leads with its name, so the time and the
                  // person who made it move down beside the description
                  <div style={{ color: 'var(--fig-icon-3)', marginTop: 2 }}>
                    {version.authorName ?? 'someone'} ·{' '}
                    {version.at ? new Date(version.at).toLocaleString() : version.stamp}
                    {version.description && ` · ${version.description}`}
                  </div>
                )}
                <div style={{ color: 'var(--fig-icon-3)', marginTop: 2 }}>
                  {version.nodes} layers · {version.names.join(', ') || 'empty'}
                </div>
              </div>
              <button
                type="button"
                className="btn"
                title="What changed between this version and the file now"
                onClick={async () => {
                  setDiff({ stamp: version.stamp, result: null });
                  setDiff({
                    stamp: version.stamp,
                    result: await compareVersionAction(room, version.stamp),
                  });
                }}
              >
                Compare
              </button>
              <button
                type="button"
                className="btn"
                disabled={readOnly || busy === version.stamp}
                title={
                  readOnly
                    ? 'You have view-only access to this file'
                    : 'Re-insert this version’s layers into the live document'
                }
                onClick={() => void restore(version)}
              >
                {busy === version.stamp ? '…' : 'Restore'}
              </button>
              {diff?.stamp === version.stamp && (
                <div className="fig-diff">
                  {!diff.result ? (
                    'Comparing…'
                  ) : (
                    <>
                      <Change kind="Added" names={diff.result.added} />
                      <Change kind="Removed" names={diff.result.removed} />
                      <Change kind="Edited" names={diff.result.changed} />
                      {!diff.result.added.length &&
                        !diff.result.removed.length &&
                        !diff.result.changed.length &&
                        'Nothing has changed since this version.'}
                      {diff.result.more > 0 && <div>…and {diff.result.more} more.</div>}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {notice && <div className="fig-hint">{notice}</div>}
      </div>
    </div>
  );
}

/** One line of a comparison — a kind of change and what it touched. */
function Change({ kind, names }: { kind: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <div>
      <span style={{ fontWeight: 500 }}>{kind}:</span> {names.join(', ')}
    </div>
  );
}
