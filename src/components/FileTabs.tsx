'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { newFile, renameFileAction } from '../server/actions';
import { useTabs } from '../state/tabs';
import { useUI } from '../state/ui';

export interface TabFile {
  id: string;
  name: string;
  /** false for a file shared with you to read — Rename is the owner's to do */
  owned: boolean;
}

/**
 * paper.design's file tabs.
 *
 * One strip across the top of the editor, one tab per open file, a cross on
 * each. It exists because a design session is rarely one file: you are looking
 * at the marketing page while you build the dashboard, and prompting an agent
 * against both. Tabs make that a switch rather than a trip back through the
 * file browser — which is why paper calls the feature "parallel prompting".
 *
 * Modelled on what paper actually ships: a pinned Dashboard at index 0 that
 * cannot be closed, file tabs after it, the close cross showing at half
 * strength on the active tab and only on hover elsewhere, and paper's own
 * shortcut set. Clicking a tab navigates; the file you land on joins the strip
 * whether you got there from here, from the file browser, or from a pasted
 * link, so the strip is a true record of where you have been working.
 *
 * Only the active file has an editor mounted, but its *session* is cached and
 * stays connected, so a background tab keeps receiving an agent's edits and
 * switching back is instant. `saveFileView` remembers each file's viewport and
 * page, so a tab returns you to the file as you left it.
 */
export function FileTabs({ active, files }: { active: string; files: TabFile[] }) {
  const router = useRouter();
  const tabs = useTabs((s) => s.tabs);
  const hydrated = useTabs((s) => s.hydrated);
  const chrome = useUI((s) => s.chrome);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // the pointerup handler outlives the render that installed it, so it cannot
  // read `dropAt` off the closure
  const dropAtRef = useRef<number | null>(null);
  dropAtRef.current = dropAt;

  const byId = useMemo(() => {
    const map: Record<string, TabFile> = {};
    for (const file of files) map[file.id] = file;
    return map;
  }, [files]);
  const nameOf = (id: string) => byId[id]?.name ?? 'Untitled';

  // localStorage is read after mount: reading it during render would make the
  // server and client markup disagree
  const known = files.map((file) => file.id).join(',');
  useEffect(() => {
    useTabs.getState().hydrate(active, known ? known.split(',') : []);
  }, [active, known]);

  // arriving anywhere else — a link, the file browser, the back button — opens
  // a tab for it, which is what makes the strip trustworthy
  useEffect(() => {
    if (hydrated) useTabs.getState().open(active);
  }, [active, hydrated]);

  // a tab scrolled off the end is a tab you cannot see you are on
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-tab-id="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs]);

  const go = (id: string) => {
    if (id !== active) router.push(`/f/${id}`);
  };

  const close = (id: string) => {
    const next = useTabs.getState().close(id);
    if (id !== active) return;
    router.push(next ? `/f/${next}` : '/files');
  };

  // Closing tabs other than the one you are on can strand you on a file that is
  // no longer in the strip, so each of these lands you somewhere still open.
  const closeOthers = (id: string) => {
    useTabs.getState().closeOthers(id);
    if (id !== active) router.push(`/f/${id}`);
  };
  const closeAfter = (id: string) => {
    const { tabs: open } = useTabs.getState();
    const stranded = open.indexOf(active) > open.indexOf(id);
    useTabs.getState().closeAfter(id);
    if (stranded) router.push(`/f/${id}`);
  };
  const closeAll = () => {
    useTabs.getState().closeAll();
    router.push('/files');
  };

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [menu]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      // The canvas binds bare arrows to nudge and ⌥⌘-letters to structural
      // commands, and both listen on window. Capturing and stopping here is
      // what keeps ⌥⌘→ from moving a layer ten pixels on its way to the next
      // tab.
      const take = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      const step = (delta: number) => {
        take();
        const next = useTabs.getState().neighbour(active, delta);
        if (next) go(next);
      };

      // ⌃⇥ / ⌃⇧⇥ — the tab cycle every tabbed thing has, paper included
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Tab') {
        step(event.shiftKey ? -1 : 1);
        return;
      }
      if (!mod || !event.altKey) {
        // ⇧⌘T reopens what you last closed; ⇧⌘D goes back to the file browser
        if (mod && event.shiftKey && !event.altKey && event.code === 'KeyT') {
          take();
          const back = useTabs.getState().reopen();
          if (back) router.push(`/f/${back}`);
          return;
        }
        if (mod && event.shiftKey && !event.altKey && event.code === 'KeyD') {
          take();
          router.push('/files');
        }
        return;
      }

      if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
        step(event.code === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (event.code === 'KeyW') {
        take();
        close(active);
        return;
      }
      if (event.code === 'KeyT') {
        take();
        // the form's own submit path, so the server action still runs
        (document.querySelector('[data-new-tab]') as HTMLButtonElement | null)?.click();
        return;
      }
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit) {
        take();
        const open = useTabs.getState().tabs;
        // 9 is the last tab, as it is in every browser — not the ninth
        const index = digit[1] === '9' ? open.length - 1 : Number(digit[1]) - 1;
        if (open[index]) go(open[index]);
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  const startDrag = (id: string, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // paper activates on press, not on release — a tab should feel like a
    // button on the way down
    go(id);

    const startX = event.clientX;
    let moved = false;

    const move = (e: PointerEvent) => {
      if (!moved) {
        if (Math.abs(e.clientX - startX) < 4) return; // slop, so a click still clicks
        moved = true;
        setDragging(id);
      }
      const strip = stripRef.current;
      if (!strip) return;
      const boxes = [...strip.querySelectorAll<HTMLElement>('[data-tab-id]')];
      // the gap the pointer is nearest to, counted in tab boundaries
      let index = boxes.length;
      for (const [i, box] of boxes.entries()) {
        const rect = box.getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          index = i;
          break;
        }
      }
      setDropAt(index);
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved && dropAtRef.current !== null) {
        const from = useTabs.getState().tabs.indexOf(id);
        const to = dropAtRef.current > from ? dropAtRef.current - 1 : dropAtRef.current;
        useTabs.getState().move(from, to);
      }
      setDragging(null);
      setDropAt(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ⌘\ takes every other piece of chrome away; the strip goes with it
  if (!chrome) return null;

  // before hydration the only file we can honestly say is open is this one
  const shown = hydrated ? tabs : [active];

  return (
    <div className="fig-topbar">
      {/* Pinned, first, and never closable — paper's Dashboard tab. Every
          non-file route lives here rather than earning a tab of its own. */}
      <Link href="/files" className="fig-filetab fig-filetab-pinned" title="Dashboard  ⇧⌘D">
        <span className="fig-filetab-icon" aria-hidden>
          <Icon.Logo />
        </span>
        <span className="fig-filetab-name">Dashboard</span>
      </Link>
      <span className="fig-topbar-rule" aria-hidden />

      <div
        ref={stripRef}
        className="fig-tabstrip"
        role="tablist"
        aria-label="Open files"
        aria-orientation="horizontal"
      >
        {shown.map((id, index) => {
          const on = id === active;
          return (
            <div
              key={id}
              data-tab-id={id}
              className="fig-filetab"
              role="tab"
              tabIndex={on ? 0 : -1}
              aria-selected={on}
              data-on={on}
              data-dragging={dragging === id || undefined}
              data-drop-before={dropAt === index || undefined}
              title={nameOf(id)}
              onPointerDown={(event) => {
                if (renaming === id) return;
                startDrag(id, event);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  go(id);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ id, x: event.clientX, y: event.clientY });
              }}
              onAuxClick={(event) => {
                // middle-click closes, as it does on a browser tab
                if (event.button === 1) {
                  event.preventDefault();
                  close(id);
                }
              }}
            >
              <span className="fig-filetab-icon" aria-hidden>
                <Icon.Page />
              </span>
              {renaming === id ? (
                <form
                  className="fig-filetab-rename"
                  action={async (form: FormData) => {
                    setRenaming(null);
                    await renameFileAction(form);
                    router.refresh();
                  }}
                >
                  <input type="hidden" name="id" value={id} />
                  <input
                    name="name"
                    defaultValue={nameOf(id)}
                    aria-label="File name"
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={(event) => event.currentTarget.form?.requestSubmit()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Escape') setRenaming(null);
                    }}
                  />
                </form>
              ) : (
                <span className="fig-filetab-name">{nameOf(id)}</span>
              )}
              <button
                type="button"
                className="fig-filetab-close"
                title={`Close ${nameOf(id)}  ⌥⌘W`}
                aria-label={`Close ${nameOf(id)}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  close(id);
                }}
              >
                <Icon.Close />
              </button>
            </div>
          );
        })}
        {dropAt === shown.length && <span className="fig-tab-drop" aria-hidden />}
      </div>

      <form action={newFile}>
        <button
          type="submit"
          data-new-tab
          className="fig-topbar-new"
          title="New file  ⌥⌘T"
          aria-label="New file"
        >
          <Icon.Plus />
        </button>
      </form>

      {menu && (
        <div
          className="fig-tab-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {(
            [
              [
                'Copy link',
                () => void navigator.clipboard?.writeText(`${window.location.origin}/f/${menu.id}`),
                true,
              ],
              ['Rename', () => setRenaming(menu.id), byId[menu.id]?.owned ?? false],
              ['—', () => undefined, false],
              ['Close', () => close(menu.id), true],
              ['Close others', () => closeOthers(menu.id), shown.length > 1],
              [
                'Close to the right',
                () => closeAfter(menu.id),
                shown.indexOf(menu.id) < shown.length - 1,
              ],
              ['Close all', () => closeAll(), true],
            ] as const
          ).map(([label, run, enabled], index) =>
            label === '—' ? (
              <hr key={index} />
            ) : (
              <button
                key={label}
                type="button"
                role="menuitem"
                disabled={!enabled}
                onClick={() => {
                  setMenu(null);
                  run();
                }}
              >
                {label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
