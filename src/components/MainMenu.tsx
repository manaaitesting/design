'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Panel, type MenuItem } from './ContextMenu';
import { commands } from './Palette';
import { useDoc, useReadOnly, useStore, useTokenVars } from './Session';
import { useUI, ZOOM } from '../state/ui';
import { contentBounds, fitBounds, selectionBounds } from '../lib/view';

/**
 * Figma's main menu — the glyph at the top-left of the collapsed island.
 *
 * The button has been there since the chrome was built and did nothing: it
 * carried `aria-haspopup="menu"` and no handler, which is the one combination
 * that promises a menu and never opens one.
 *
 * Nothing here is a new command. Every row runs something the app already had
 * — the quick-action registry, the zoom menu's arithmetic, the store's undo —
 * so the menu is a second way to reach commands rather than a second
 * implementation of them, and a command fixed in one place is fixed in both.
 * The grouping is Figma's: File, Edit, View, Object, Help.
 */
export function MainMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const doc = useDoc();
  const store = useStore();
  const tokenVars = useTokenVars();
  const readOnly = useReadOnly();
  const router = useRouter();

  /**
   * The three exits every menu in the app has.
   *
   * `Panel` draws the rows and owns the arrow keys, but it deliberately leaves
   * dismissal to whoever opened it — the context menu and the file menu each
   * bring their own. Without this the menu could be opened and never shut.
   */
  useEffect(() => {
    const dismiss = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // the canvas also answers Escape, and it must not hear this one
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const items = useMemo<MenuItem[]>(() => {
    const registry = new Map(commands(doc, store, tokenVars).map((command) => [command.id, command]));
    const ui = () => useUI.getState();

    /** A row for a quick action, by id. Unknown ids are dropped, never faked. */
    const row = (id: string, extra: Partial<MenuItem> = {}): MenuItem[] => {
      const command = registry.get(id);
      if (!command) return [];
      return [
        {
          label: command.label,
          shortcut: command.hint,
          disabled: readOnly && command.writes !== false,
          run: command.run,
          ...extra,
        },
      ];
    };

    /** A row this menu owns, because no palette entry covers it. */
    const own = (label: string, run: () => void, shortcut?: string, disabled?: boolean): MenuItem => ({
      label,
      shortcut,
      run,
      disabled,
    });

    // the zoom menu's own arithmetic, so "Zoom to fit" means one thing in the
    // app rather than two things that drift
    const frame = (bounds: ReturnType<typeof contentBounds>) => {
      const state = ui();
      const fitted = bounds && fitBounds(bounds, state.leftPanel, state.leftWidth, state.rightWidth);
      if (fitted) state.setViewport(fitted);
    };

    return [
      {
        label: 'File',
        items: [
          own('Back to files', () => router.push('/files')),
          own('Show version history', () => ui().setVersionsOpen(true)),
          ...row('export', { divider: true }),
          ...row('present'),
        ],
      },
      {
        label: 'Edit',
        items: [
          own('Undo', () => store.undo(), '⌘Z', readOnly),
          own('Redo', () => store.redo(), '⇧⌘Z', readOnly),
          ...row('duplicate', { divider: true }),
          ...row('delete'),
          ...row('select-inverse', { divider: true }),
          ...row('rename'),
        ],
      },
      {
        label: 'View',
        items: [
          own('Zoom in', () => ui().zoomBy(ZOOM.step), '⌘+'),
          own('Zoom out', () => ui().zoomBy(1 / ZOOM.step), '⌘−'),
          {
            ...own('Zoom to fit', () => frame(contentBounds(doc, ui().page)), '⇧1'),
            divider: true,
          },
          own('Zoom to selection', () => frame(selectionBounds(ui().selection, doc)), '⇧2'),
          ...row('zoom-100'),
          ...row('rulers', { divider: true }),
          ...row('panel'),
          ...row('assets', { divider: true }),
          ...row('variables'),
          ...row('inspect'),
          ...row('prototype'),
        ],
      },
      {
        label: 'Object',
        items: [
          ...row('group'),
          ...row('ungroup'),
          ...row('frame'),
          ...row('auto-layout'),
          ...row('section'),
          ...row('component', { divider: true }),
          ...row('components'),
          ...row('rasterize'),
          {
            label: 'Boolean groups',
            divider: true,
            items: [...row('union'), ...row('subtract'), ...row('intersect'), ...row('exclude')],
          },
          ...row('flatten', { divider: true }),
          ...row('outline-stroke'),
          ...row('mask'),
          ...row('forward', { divider: true }),
          ...row('backward'),
          ...row('flip-h', { divider: true }),
          ...row('flip-v'),
          ...row('lock'),
          ...row('hide'),
          ...row('tidy', { divider: true }),
          ...row('resize-to-fit'),
        ],
      },
      {
        label: 'Help',
        divider: true,
        items: [
          own('Keyboard shortcuts', () => ui().setShortcutsOpen(true), '⌃⇧?'),
          own('Quick actions', () => ui().setPaletteOpen(true), '⌘/'),
          own('Shaders', () => ui().setShadersOpen(true)),
        ],
      },
    ];
  }, [doc, store, tokenVars, readOnly, router]);

  return <Panel items={items} x={x} y={y} width={216} onClose={onClose} />;
}
