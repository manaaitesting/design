'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  duplicateFileAction,
  moveFileAction,
  setStarredAction,
  trashFileAction,
} from '../server/actions';

type FileLite = {
  id: string;
  name: string;
  folder_id?: string | null;
  starred?: number;
};

export function FileContextMenu({
  file,
  folders,
  children,
}: {
  file: FileLite;
  folders: { id: string; name: string }[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [showMove, setShowMove] = useState(false);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const starred = Boolean(file.starred);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setPos(null);
        setShowMove(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPos(null);
        setShowMove(false);
      }
    };
    const onScroll = () => {
      setPos(null);
      setShowMove(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [pos]);

  useEffect(() => {
    try {
      const key = 'paperlike:removedRecent';
      const prev = JSON.parse(sessionStorage.getItem(key) || '[]') as string[];
      if (prev.includes(file.id)) {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab');
        const isRecent = !tab || tab === 'recently-viewed';
        if (isRecent) {
          const card = wrapperRef.current?.querySelector('[role="group"]') as HTMLElement | null;
          if (card) card.style.display = 'none';
          if (wrapperRef.current) (wrapperRef.current as HTMLElement).style.display = 'none';
        }
      }
    } catch {}
  }, [file.id]);

  function close() {
    setPos(null);
    setShowMove(false);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = Math.min(e.clientY, window.innerHeight - 420);
    setPos({ x, y });
    setShowMove(false);
  }

  // keep menu inside viewport – clamp after render
  const menuStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : {};

  return (
    <div ref={wrapperRef} onContextMenu={handleContextMenu} style={{ display: 'contents' }}>
      {children}
      {pos && (
        <div
          ref={menuRef}
          className="ctx"
          role="menu"
          style={{ ...menuStyle, minWidth: 220, maxWidth: 260 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="ctx-row"
            role="menuitem"
            onClick={() => {
              close();
              if (file.folder_id) router.push(`/files?folder=${file.folder_id}`);
              else router.push('/files');
            }}
          >
            <span className="ctx-label">Show in folder</span>
          </button>
          <button
            className="ctx-row"
            role="menuitem"
            onClick={() => {
              close();
              router.push(`/f/${file.id}`);
            }}
          >
            <span className="ctx-label">Open</span>
          </button>
          <button
            className="ctx-row"
            role="menuitem"
            onClick={() => {
              close();
              window.open(`/f/${file.id}`, '_blank');
            }}
          >
            <span className="ctx-label">Open in new tab</span>
          </button>

          <div className="ctx-sep" />

          <button
            className="ctx-row"
            role="menuitem"
            onClick={() => {
              close();
              const fd = new FormData();
              fd.set('id', file.id);
              startTransition(() => duplicateFileAction(fd));
            }}
          >
            <span className="ctx-label">Create new branch</span>
          </button>
          <button
            className="ctx-row"
            role="menuitem"
            disabled={isPending}
            onClick={() => {
              close();
              startTransition(() => setStarredAction(file.id, !starred));
            }}
          >
            <span className="ctx-label">{starred ? 'Remove from favorites' : 'Add to your favorites'}</span>
          </button>

          <div className="ctx-sep" />

          <button
            className="ctx-row"
            role="menuitem"
            onClick={async () => {
              close();
              try {
                await navigator.clipboard.writeText(`${window.location.origin}/f/${file.id}`);
              } catch {}
            }}
          >
            <span className="ctx-label">Copy link</span>
          </button>
          <button
            className="ctx-row"
            role="menuitem"
            onClick={async () => {
              close();
              try {
                await navigator.clipboard.writeText(`${window.location.origin}/f/${file.id}`);
              } catch {}
              // also hint share – the card's Share button handles invites
            }}
          >
            <span className="ctx-label">Share</span>
          </button>
          <button
            className="ctx-row"
            role="menuitem"
            disabled={isPending}
            onClick={() => {
              close();
              const fd = new FormData();
              fd.set('id', file.id);
              startTransition(() => duplicateFileAction(fd));
            }}
          >
            <span className="ctx-label">Duplicate</span>
          </button>

          <div className="ctx-sep" />

          <button
            className="ctx-row"
            role="menuitem"
            onClick={() => {
              close();
              router.push(`/f/${file.id}`);
            }}
          >
            <span className="ctx-label">Show version history</span>
          </button>
          <button
            className="ctx-row"
            role="menuitem"
            onClick={() => {
              close();
              // focus the rename input inside this card
              const root = wrapperRef.current?.parentElement ?? document;
              // find the closest group for this file
              const group = document.querySelector(`[role="group"][aria-label="${CSS.escape(file.name)}"]`) ?? wrapperRef.current;
              const input = (group as HTMLElement)?.querySelector('input[aria-label="File name"]') as HTMLInputElement | null;
              if (input) {
                input.focus();
                input.select();
              } else {
                // fallback: find any input for this file id
                const fallback = document.querySelector(`input[name="name"][defaultValue]`) as HTMLInputElement | null;
                fallback?.focus();
              }
            }}
          >
            <span className="ctx-label">Rename</span>
          </button>

          {/* Move file… with submenu */}
          <button
            className="ctx-row"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={showMove}
            onClick={() => setShowMove((v) => !v)}
          >
            <span className="ctx-label">Move file…</span>
            <span className="ctx-arrow">›</span>
          </button>
          {showMove && (
            <div style={{ padding: '4px 6px 2px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.55)', padding: '4px 8px 4px' }}>Move to folder</div>
              <button
                className="ctx-row"
                role="menuitem"
                disabled={isPending}
                onClick={() => {
                  close();
                  startTransition(() => moveFileAction(file.id, ''));
                }}
                style={{ opacity: !file.folder_id ? 0.7 : 1 }}
              >
                <span className="ctx-label">No folder</span>
                {!file.folder_id && <span style={{ color: 'rgba(255,255,255,0.55)' }}>•</span>}
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  className="ctx-row"
                  role="menuitem"
                  disabled={isPending}
                  onClick={() => {
                    close();
                    startTransition(() => moveFileAction(file.id, f.id));
                  }}
                >
                  <span className="ctx-label">{f.name}</span>
                  {file.folder_id === f.id && <span style={{ color: 'rgba(255,255,255,0.55)' }}>•</span>}
                </button>
              ))}
              {folders.length === 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', padding: '4px 8px' }}>No folders yet</div>}
            </div>
          )}

          <button
            className="ctx-row"
            role="menuitem"
            disabled={isPending}
            onClick={() => {
              close();
              const fd = new FormData();
              fd.set('id', file.id);
              startTransition(() => trashFileAction(fd));
            }}
          >
            <span className="ctx-label">Move to trash</span>
          </button>
          <button
            className="ctx-row"
            role="menuitem"
            onClick={() => {
              close();
              // Remove from recent – hide the card for this session (Figma removes it from Recently viewed)
              try {
                const key = 'paperlike:removedRecent';
                const prev = JSON.parse(sessionStorage.getItem(key) || '[]');
                if (!prev.includes(file.id)) sessionStorage.setItem(key, JSON.stringify([...prev, file.id]));
              } catch {}
              const card = wrapperRef.current?.querySelector('[role="group"]') as HTMLElement | null;
              if (card) card.style.display = 'none';
              // also hide the wrapper's placeholder in grid so gap collapses
              if (wrapperRef.current) (wrapperRef.current as HTMLElement).style.display = 'none';
            }}
          >
            <span className="ctx-label">Remove from recent</span>
          </button>
        </div>
      )}
    </div>
  );
}
