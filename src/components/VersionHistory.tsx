'use client';

import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { Dialog } from './FileMenu';
import { useReadOnly, useSession, useStore } from './Session';
import { DocStore } from '../document/store';
import { useUI } from '../state/ui';
import {
  listVersionsAction,
  type FileVersion,
} from '../server/actions';

/**
 * The file menu's "Show version history".
 *
 * The history is the sync server's rolling snapshots — one a minute while the
 * file is being edited, the state before any wipe, and whatever a person has
 * saved here by name. Restoring re-inserts a version's layers into the live
 * document as one undo step; see `DocStore.restoreFrom` for why it is not a
 * file swap.
 */
export function VersionHistory() {
  const open = useUI((s) => s.versionsOpen);
  return open ? <VersionSheet /> : null;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A binary update as base64, in chunks: `btoa` on one giant string overflows the stack. */
function VersionSheet() {
  const setOpen = useUI((s) => s.setVersionsOpen);
  const { ydoc, provider } = useSession();
  const room = provider.roomname;
  const store = useStore();
  const readOnly = useReadOnly();
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    let cancelled = false;
    void listVersionsAction(room).then((list) => {
      if (!cancelled) setVersions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [room]);

  const save = async () => {
    const label = name.trim();
    if (!label) return;
    setBusy('save');
    // the bytes go as a request body: a design's snapshot is far larger than
    // a server action's arguments are allowed to be
    const response = await fetch(`/api/versions?file=${encodeURIComponent(room)}&name=${encodeURIComponent(label)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Y.encodeStateAsUpdate(ydoc) as unknown as BodyInit,
    }).catch(() => null);
    const saved = response?.ok ? ((await response.json()) as FileVersion) : null;
    setBusy(null);
    if (!saved) return setStatus('Could not save the version.');
    setName('');
    setVersions((list) => [saved, ...(list ?? [])]);
    setStatus(`Saved “${label}”.`);
  };

  const restore = async (version: FileVersion) => {
    setBusy(version.stamp);
    setStatus(null);
    const response = await fetch(
      `/api/versions?file=${encodeURIComponent(room)}&stamp=${encodeURIComponent(version.stamp)}`,
    ).catch(() => null);
    if (!response?.ok) {
      setBusy(null);
      return setStatus('That version could not be read.');
    }
    const payload = new Uint8Array(await response.arrayBuffer());
    const other = new Y.Doc();
    try {
      Y.applyUpdate(other, payload);
      const count = store.restoreFrom(new DocStore(other));
      setStatus(
        count === 0
          ? `That version from ${when.format(version.at)} has no layers on any page, so nothing was changed.`
          : `Restored ${count} top-level layer${count === 1 ? '' : 's'} from ${when.format(version.at)}. ` +
              'Undo (⌘Z) brings the current state back.',
      );
    } finally {
      other.destroy();
      setBusy(null);
    }
  };

  return (
    <Dialog title="Version history" width={440} onClose={close}>
      {!readOnly && (
        <form
          style={{ display: 'flex', gap: 6, marginBottom: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this version"
            aria-label="Version name"
            maxLength={80}
            style={{
              flex: 1,
              height: 26,
              padding: '0 8px',
              border: 0,
              borderRadius: 5,
              background: 'var(--color-control)',
              boxShadow: 'var(--shadow-control)',
              outline: 'none',
              font: 'inherit',
            }}
          />
          <button type="submit" className="btn btn-raised" disabled={busy !== null || !name.trim()}>
            Save version
          </button>
        </form>
      )}

      <div
        role="list"
        aria-label="Versions"
        style={{
          maxHeight: '48vh',
          overflowY: 'auto',
          margin: '0 -6px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {versions === null ? (
          <p style={{ margin: '8px 6px', color: 'var(--color-ink-dim)' }}>Loading…</p>
        ) : versions.length === 0 ? (
          <p style={{ margin: '8px 6px', color: 'var(--color-ink-dim)', lineHeight: 1.5 }}>
            No versions yet. One is kept every minute while the file is being edited, and you can
            save one by name above.
          </p>
        ) : (
          versions.map((version) => (
            <div
              key={`${version.stamp}-${version.name ?? ''}`}
              role="listitem"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 6px',
                borderRadius: 6,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {version.name ?? (version.kept ? 'Kept before a large deletion' : 'Autosave')}
                </div>
                <div style={{ color: 'var(--color-ink-dim)', fontSize: 11 }}>
                  {version.at ? when.format(version.at) : version.stamp} · {Math.max(1, Math.round(version.bytes / 1024))} KB
                </div>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => void restore(version)}
                >
                  {busy === version.stamp ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {status && (
        <p role="status" style={{ margin: '12px 0 0', color: 'var(--color-ink-muted)', lineHeight: 1.5 }}>
          {status}
        </p>
      )}
    </Dialog>
  );
}
