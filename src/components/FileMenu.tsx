'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './ui/Icons';
import { Panel, type MenuItem } from './ContextMenu';
import { useDoc, useReadOnly, useStore } from './Session';
import { useUI } from '../state/ui';
import { writeText } from '../lib/actions';
import {
  duplicateAndOpenAction,
  moveFileAction,
  renameFileAction,
  setStarredAction,
  trashFileAction,
} from '../server/actions';

/**
 * Figma's file menu — the caret beside the file name in the left panel.
 *
 * What the route knows about the file that the document itself does not: who
 * owns it, where it is filed, whether it is pinned. The document is the CRDT;
 * this is the row around it.
 */
export interface FileMeta {
  id: string;
  name: string;
  /** the viewer owns it — rename, move, trash and star are theirs to do */
  owned: boolean;
  /** signed in at all; a link visitor cannot duplicate into an account they lack */
  signedIn: boolean;
  folderId: string | null;
  folderName: string | null;
  starred: boolean;
  /** the viewer's own folders, for "Move file…" */
  folders: { id: string; name: string }[];
}

/** The colour space the file's colours are meant in. Stored on the document. */
export type ColorProfile = 'srgb' | 'p3';
export const COLOR_PROFILE_KEY = 'colorProfile';
export const COLOR_PROFILES: { id: ColorProfile; label: string }[] = [
  { id: 'srgb', label: 'sRGB' },
  { id: 'p3', label: 'Display P3' },
];

/**
 * Rename, published by the mounted header for the collapsed island's menu.
 *
 * The island has no name field to type into; picking Rename there expands the
 * panel, and the header that mounts picks the request up. Same bargain as
 * `pageActions` in the UI store, and for the same reason: cheaper than lifting
 * one input's state into a store.
 */
let pendingRename = false;
export function requestRename(): void {
  pendingRename = true;
}
function takeRenameRequest(): boolean {
  const pending = pendingRename;
  pendingRename = false;
  return pending;
}

/** What the header shows besides the menu: a folder picker, or the trash confirmation. */
type Sheet = 'move' | 'trash' | null;

/**
 * The menu itself, positioned under an anchor, plus the two small sheets some
 * of its rows open. Owned by whichever control opened it.
 */
export function FileMenu({
  file,
  x,
  y,
  onClose,
  onRename,
}: {
  file: FileMeta;
  x: number;
  y: number;
  onClose: () => void;
  /** starts an inline rename; absent when the caller has no field for one */
  onRename?: () => void;
}) {
  const router = useRouter();
  const store = useStore();
  const doc = useDoc();
  const readOnly = useReadOnly();
  const page = useUI((s) => s.page);
  const setTab = useUI((s) => s.setTab);
  const setExportOpen = useUI((s) => s.setExportOpen);
  const setVersionsOpen = useUI((s) => s.setVersionsOpen);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  // `Panel` closes after every row. A row that opens a sheet needs this
  // component to stay mounted, so it sets this and the close is swallowed once.
  const opening = useRef(false);
  const openSheet = (next: Sheet) => {
    opening.current = true;
    setSheet(next);
  };

  // Outside click, Escape and the window losing focus all close it — the same
  // three exits the right-click menu has. The panel stops its own pointerdown,
  // so a click on a row never reaches here.
  useEffect(() => {
    if (sheet) return;
    const dismiss = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, sheet]);

  const profile = store.getMeta<ColorProfile>(COLOR_PROFILE_KEY) ?? 'srgb';
  const hasComponents = Object.values(doc).some((node) => node.isComponent);

  const items: MenuItem[] = [
    { label: 'Show version history', run: () => setVersionsOpen(true) },
    {
      label: 'Publish library...',
      // publishing lives on the Assets tab, one component at a time; the menu
      // takes you there, and is dim when there is nothing to publish
      disabled: readOnly || !hasComponents,
      run: () => setTab('assets'),
    },
    { label: 'Export...', shortcut: '⇧⌘E', divider: true, run: () => setExportOpen(true) },
    {
      label: 'Copy link to current page',
      run: () => writeText(`${location.origin}${location.pathname}?page=${page}`),
    },
    {
      label: file.starred ? 'Remove from sidebar' : 'Add to sidebar',
      divider: true,
      disabled: !file.owned,
      run: async () => {
        await setStarredAction(file.id, !file.starred);
        router.refresh();
      },
    },
    // Branching is not something this editor does. The row stays where Figma
    // puts it, dim, rather than pretending a copy is a branch.
    { label: 'Create branch...', divider: true, disabled: true },
    {
      label: 'File color profile',
      divider: true,
      items: COLOR_PROFILES.map((option) => ({
        label: option.label,
        checked: profile === option.id,
        disabled: readOnly,
        run: () => store.setMeta(COLOR_PROFILE_KEY, option.id),
      })),
    },
    {
      label: 'Duplicate',
      divider: true,
      disabled: !file.signedIn,
      run: async () => {
        const id = await duplicateAndOpenAction(file.id);
        if (id) router.push(`/f/${id}`);
      },
    },
    { label: 'Rename', disabled: !file.owned || !onRename, run: () => onRename?.() },
    { label: 'Move file...', disabled: !file.owned, run: () => openSheet('move') },
    { label: 'Move to trash', disabled: !file.owned, run: () => openSheet('trash') },
  ];

  if (sheet === 'move') {
    return (
      <MoveSheet
        file={file}
        busy={busy}
        onCancel={onClose}
        onMove={async (folderId) => {
          setBusy(true);
          await moveFileAction(file.id, folderId ?? '');
          router.refresh();
          onClose();
        }}
      />
    );
  }

  if (sheet === 'trash') {
    return (
      <Dialog title="Move to trash" onClose={onClose}>
        <p style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
          Move <strong>{file.name}</strong> to the trash? It leaves your files and the tab strip, and
          is hidden from everyone it is shared with. You can restore it from Trash on the dashboard.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-raised"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const form = new FormData();
              form.set('id', file.id);
              await trashFileAction(form);
              router.push('/files');
            }}
          >
            Move to trash
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Panel
      items={items}
      x={x}
      y={y}
      width={232}
      onClose={() => {
        // a row that opened a sheet keeps the component mounted; every other
        // row is done and the menu goes with it
        if (opening.current) {
          opening.current = false;
          return;
        }
        onClose();
      }}
    />
  );
}

function MoveSheet({
  file,
  busy,
  onCancel,
  onMove,
}: {
  file: FileMeta;
  busy: boolean;
  onCancel: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const [choice, setChoice] = useState<string | null>(file.folderId);
  return (
    <Dialog title="Move file" onClose={onCancel}>
      <p style={{ margin: '0 0 10px', color: 'var(--color-ink-muted)' }}>
        Where should <strong style={{ color: 'var(--color-ink)' }}>{file.name}</strong> live?
      </p>
      <div
        role="radiogroup"
        aria-label="Folder"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          maxHeight: 260,
          overflowY: 'auto',
          margin: '0 -6px 14px',
        }}
      >
        {[{ id: null as string | null, name: 'Drafts' }, ...file.folders].map((folder) => {
          const on = choice === folder.id;
          return (
            <button
              key={folder.id ?? 'drafts'}
              type="button"
              role="radio"
              aria-checked={on}
              className="fig-preset-row"
              data-on={on}
              onClick={() => setChoice(folder.id)}
              style={on ? { background: 'var(--fig-selected)', color: 'var(--fig-blue)' } : undefined}
            >
              <span style={{ width: 14, textAlign: 'center' }}>{on ? '✓' : ''}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>{folder.name}</span>
              {folder.id === null && (
                <span style={{ color: 'var(--color-ink-dim)', fontSize: 11 }}>no folder</span>
              )}
            </button>
          );
        })}
      </div>
      {file.folders.length === 0 && (
        <p style={{ margin: '0 0 14px', color: 'var(--color-ink-dim)', fontSize: 11 }}>
          You have no folders yet. Make one on the dashboard and it will be listed here.
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-raised"
          disabled={busy || choice === file.folderId}
          onClick={() => onMove(choice)}
        >
          Move
        </button>
      </div>
    </Dialog>
  );
}

/** A small centred sheet over the editor, closed by its cross, Escape, or the scrim. */
export function Dialog({
  title,
  width = 360,
  onClose,
  children,
}: {
  title: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 400 }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label={title}
        style={{
          width,
          maxWidth: '92vw',
          background: 'var(--color-panel)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-pop)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="panel-head" style={{ height: 40, gap: 10 }}>
          <span style={{ fontWeight: 500, flex: 1 }}>{title}</span>
          <button
            type="button"
            className="btn"
            aria-label="Close"
            style={{ width: 24, padding: 0 }}
            onClick={onClose}
          >
            <Icon.Close />
          </button>
        </div>
        <div style={{ padding: '12px 14px 14px' }}>{children}</div>
      </div>
    </div>
  );
}

/**
 * The header of the left panel: the file's name with the menu caret beside
 * it, the folder it lives in beneath, and the sidebar toggle on the right.
 */
export function FileHead({ file }: { file: FileMeta }) {
  const router = useRouter();
  const toggleLeftPanel = useUI((s) => s.toggleLeftPanel);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(() => takeRenameRequest());
  const caretRef = useRef<HTMLButtonElement>(null);

  const open = () => {
    const box = caretRef.current?.getBoundingClientRect();
    // under the caret, flush with the panel's left edge like Figma's
    setMenu(box ? { x: box.left - 6, y: box.bottom + 6 } : { x: 16, y: 44 });
  };

  const submit = async (value: string) => {
    setRenaming(false);
    const name = value.trim();
    if (!name || name === file.name) return;
    const form = new FormData();
    form.set('id', file.id);
    form.set('name', name);
    await renameFileAction(form);
    router.refresh();
  };

  return (
    <div className="fig-left-head fig-file-head">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="fig-file-title">
          {renaming ? (
            <input
              className="fig-file-rename"
              defaultValue={file.name}
              aria-label="File name"
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => void submit(event.currentTarget.value)}
              onKeyDown={(event) => {
                // the canvas owns most single keys; a name must be typeable
                event.stopPropagation();
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <>
              <span
                className="fig-file-name"
                title={file.name}
                onDoubleClick={() => file.owned && setRenaming(true)}
              >
                {file.name}
              </span>
              <button
                ref={caretRef}
                type="button"
                className="fig-btn fig-file-caret"
                // no tooltip while the menu is up — it would sit on top of the rows
                title={menu ? undefined : 'File menu'}
                aria-label="File menu"
                aria-haspopup="menu"
                aria-expanded={!!menu}
                data-on={menu ? 'true' : undefined}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => (menu ? setMenu(null) : open())}
              >
                <Icon.Caret />
              </button>
            </>
          )}
        </div>
        <div className="fig-file-project">{file.folderName ?? 'Drafts'}</div>
      </div>
      <button
        type="button"
        className="fig-btn"
        title={'Collapse sidebar  ⇧\\'}
        aria-label="Collapse sidebar"
        onClick={() => toggleLeftPanel()}
      >
        <Icon.PanelToggle />
      </button>
      {menu && (
        <FileMenu
          file={file}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => setRenaming(true)}
        />
      )}
    </div>
  );
}
