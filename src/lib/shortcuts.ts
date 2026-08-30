import type { FontSpec } from '../document/types';

/**
 * Every chord the editor answers, written down once.
 *
 * Figma's ⌃⇧? panel is the app's discovery surface: the keys that belong to no
 * menu row — the tool letters, the zoom digits, the opacity digits, the six ⌥
 * alignments — can only be found there. Paperlike printed a binding beside a
 * command you had already found and nowhere else, which teaches you nothing you
 * did not already know.
 *
 * The list is written rather than derived, because the handler's branches are
 * conditions and not a table, and a derivation would be a second, worse parser
 * of the same file. What keeps it honest instead is `keyboard.spec.ts`: it
 * presses a sample of these chords and asserts the editor answers.
 *
 * `code` is what a row matches for the "you have used this" mark — the physical
 * key with its modifiers, in the same shape the handler tests.
 */
export interface Shortcut {
  /** how the chord reads, in Figma's glyphs */
  keys: string;
  label: string;
  /** the chord as a normalized id, e.g. "cmd+shift+KeyE"; used for the mark */
  code?: string;
}

export interface ShortcutGroup {
  title: string;
  rows: Shortcut[];
}

/** Turns a keydown into the id a row is written with. */
export function chordOf(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey) parts.push('cmd');
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(event.code);
  return parts.join('+');
}

/**
 * The modifier glyphs, in the order macOS prints them — ⌃ ⌥ ⇧ ⌘, Command last.
 * A chord id spells its modifiers in a different order because an id only has
 * to be stable; a printed chord has to look like the one on the key cap.
 */
export const MODIFIER_GLYPHS: [string, string][] = [
  ['ctrl', '⌃'],
  ['alt', '⌥'],
  ['shift', '⇧'],
  ['cmd', '⌘'],
];

/** ⌥⌘L / ⌥⌘T / ⌥⌘R / ⌥⌘J, which `actions.ts` re-exports and acts on. */
export const TEXT_ALIGN_KEYS: Record<string, FontSpec['align']> = {
  KeyL: 'left',
  KeyT: 'center',
  KeyR: 'right',
  KeyJ: 'justify',
};

const TEXT_ALIGN_ROWS: Shortcut[] = Object.entries(TEXT_ALIGN_KEYS).map(([code, align]) => ({
  keys: `⌥⌘${code.slice(3)}`,
  label: `Align text ${align}`,
  code: `cmd+alt+${code}`,
}));

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Essential',
    rows: [
      { keys: '⌘/', label: 'Quick actions', code: 'cmd+Slash' },
      { keys: '⌃⇧?', label: 'Keyboard shortcuts', code: 'ctrl+shift+Slash' },
      { keys: '⌘\\', label: 'Show or hide the UI', code: 'cmd+Backslash' },
      { keys: '⇧⌘⏎', label: 'Present', code: 'cmd+shift+Enter' },
      { keys: '⇧D', label: 'Dev Mode', code: 'shift+KeyD' },
      { keys: '⇧M', label: 'Timeline', code: 'shift+KeyM' },
      { keys: '⌘L', label: 'Copy link to selection', code: 'cmd+KeyL' },
      { keys: '⌥⌘H', label: 'Version history', code: 'cmd+alt+KeyH' },
      { keys: '⇧⌘E', label: 'Export…', code: 'cmd+shift+KeyE' },
    ],
  },
  {
    title: 'Tools',
    rows: [
      { keys: 'V', label: 'Move', code: 'KeyV' },
      { keys: 'K', label: 'Scale', code: 'KeyK' },
      { keys: 'H', label: 'Hand tool', code: 'KeyH' },
      { keys: 'F  A', label: 'Frame', code: 'KeyF' },
      { keys: '⇧S', label: 'Section', code: 'shift+KeyS' },
      { keys: 'R', label: 'Rectangle', code: 'KeyR' },
      { keys: 'O', label: 'Ellipse', code: 'KeyO' },
      { keys: 'L', label: 'Line', code: 'KeyL' },
      { keys: '⇧L', label: 'Arrow', code: 'shift+KeyL' },
      { keys: 'P', label: 'Pen', code: 'KeyP' },
      { keys: 'S', label: 'Slice', code: 'KeyS' },
      { keys: 'T', label: 'Text', code: 'KeyT' },
      { keys: 'C', label: 'Comment', code: 'KeyC' },
      { keys: '⇧E', label: 'Measure', code: 'shift+KeyE' },
    ],
  },
  {
    title: 'View',
    rows: [
      { keys: '⇧G', label: 'Layout grids', code: 'shift+KeyG' },
      { keys: '⇧C', label: 'Comments', code: 'shift+KeyC' },
      { keys: '⇧Y', label: 'Annotations', code: 'shift+KeyY' },
      { keys: '⌥⇧O', label: 'Outlines', code: 'alt+shift+KeyO' },
      { keys: '⌥⌘\\', label: 'Multiplayer cursors', code: 'cmd+alt+Backslash' },
      { keys: "⇧'", label: 'Pixel grid', code: 'shift+Quote' },
      { keys: "⇧⌘'", label: 'Snap to pixel grid', code: 'cmd+shift+Quote' },
      { keys: '⌃⇧P', label: 'Pixel preview', code: 'ctrl+shift+KeyP' },
      { keys: '⌥L', label: 'Collapse the layers panel', code: 'alt+KeyL' },
    ],
  },
  {
    title: 'Zoom',
    rows: [
      { keys: '+', label: 'Zoom in', code: 'Equal' },
      { keys: '−', label: 'Zoom out', code: 'Minus' },
      { keys: '⇧0', label: 'Zoom to 100%', code: 'shift+Digit0' },
      { keys: '⇧1', label: 'Zoom to fit', code: 'shift+Digit1' },
      { keys: '⇧2', label: 'Zoom to selection', code: 'shift+Digit2' },
      { keys: 'N', label: 'Next frame', code: 'KeyN' },
      { keys: '⇧N', label: 'Previous frame', code: 'shift+KeyN' },
    ],
  },
  {
    title: 'Selection',
    rows: [
      { keys: '⌘A', label: 'Select all', code: 'cmd+KeyA' },
      { keys: '⇧⌘A', label: 'Select inverse', code: 'cmd+shift+KeyA' },
      { keys: '⌥⌘A', label: 'Select matching layers', code: 'cmd+alt+KeyA' },
      { keys: '⏎', label: 'Step into the selection', code: 'Enter' },
      { keys: '⇥', label: 'Next sibling', code: 'Tab' },
      { keys: '⇧⇥', label: 'Previous sibling', code: 'shift+Tab' },
      { keys: '⎋', label: 'Step out, then deselect', code: 'Escape' },
    ],
  },
  {
    title: 'Edit',
    rows: [
      { keys: '⌘Z', label: 'Undo', code: 'cmd+KeyZ' },
      { keys: '⇧⌘Z', label: 'Redo', code: 'cmd+shift+KeyZ' },
      { keys: '⌘C', label: 'Copy', code: 'cmd+KeyC' },
      { keys: '⌘X', label: 'Cut', code: 'cmd+KeyX' },
      { keys: '⌘V', label: 'Paste', code: 'cmd+KeyV' },
      { keys: '⇧⌘V', label: 'Paste in place', code: 'cmd+shift+KeyV' },
      { keys: '⇧⌘R', label: 'Paste to replace', code: 'cmd+shift+KeyR' },
      { keys: '⌘D', label: 'Duplicate', code: 'cmd+KeyD' },
      { keys: '⌘R', label: 'Rename', code: 'cmd+KeyR' },
      { keys: '⌫', label: 'Delete', code: 'Backspace' },
      { keys: '⌥⌘C', label: 'Copy properties', code: 'cmd+alt+KeyC' },
      { keys: '⌥⌘V', label: 'Paste properties', code: 'cmd+alt+KeyV' },
      { keys: '⇧⌘C', label: 'Copy as PNG', code: 'cmd+shift+KeyC' },
      { keys: '⌥T', label: 'Copy as Tailwind', code: 'alt+KeyT' },
      { keys: 'I', label: 'Sample a colour', code: 'KeyI' },
      { keys: '⇧⌘H', label: 'Show or hide the layer', code: 'cmd+shift+KeyH' },
      { keys: '⇧⌘L', label: 'Lock or unlock the layer', code: 'cmd+shift+KeyL' },
    ],
  },
  {
    title: 'Text',
    rows: [
      { keys: '⌘B', label: 'Bold', code: 'cmd+KeyB' },
      { keys: '⌘I', label: 'Italic', code: 'cmd+KeyI' },
      { keys: '⌘U', label: 'Underline', code: 'cmd+KeyU' },
      { keys: '⇧⌘X', label: 'Strikethrough', code: 'cmd+shift+KeyX' },
      ...TEXT_ALIGN_ROWS,
      { keys: '⇧⌘<', label: 'Decrease the font size', code: 'cmd+shift+Comma' },
      { keys: '⇧⌘>', label: 'Increase the font size', code: 'cmd+shift+Period' },
      { keys: '⌘K', label: 'Create a link', code: 'cmd+KeyK' },
    ],
  },
  {
    title: 'Transform',
    rows: [
      { keys: '⇧H', label: 'Flip horizontal', code: 'shift+KeyH' },
      { keys: '⇧V', label: 'Flip vertical', code: 'shift+KeyV' },
      { keys: '⇧X', label: 'Swap the fill and the stroke', code: 'shift+KeyX' },
      { keys: '0…9', label: 'Set the opacity' },
      { keys: '←↑→↓', label: 'Nudge' },
      { keys: '⇧←↑→↓', label: 'Nudge by the big step' },
    ],
  },
  {
    title: 'Arrange',
    rows: [
      { keys: '⌘G', label: 'Group', code: 'cmd+KeyG' },
      { keys: '⇧⌘G', label: 'Ungroup', code: 'cmd+shift+KeyG' },
      { keys: '⇧F', label: 'Frame the selection', code: 'shift+KeyF' },
      { keys: '⌘S', label: 'Section the selection', code: 'cmd+KeyS' },
      { keys: '⇧A', label: 'Add auto layout', code: 'shift+KeyA' },
      { keys: '⌥⇧A', label: 'Remove auto layout', code: 'alt+shift+KeyA' },
      { keys: ']', label: 'Bring to front', code: 'BracketRight' },
      { keys: '[', label: 'Send to back', code: 'BracketLeft' },
      { keys: '⌘]', label: 'Bring forward', code: 'cmd+BracketRight' },
      { keys: '⌘[', label: 'Send backward', code: 'cmd+BracketLeft' },
      { keys: '⌥A  ⌥D', label: 'Align left, align right', code: 'alt+KeyA' },
      { keys: '⌥W  ⌥S', label: 'Align top, align bottom', code: 'alt+KeyW' },
      { keys: '⌥H  ⌥V', label: 'Centre horizontally, vertically', code: 'alt+KeyH' },
      { keys: '⌃⌥T', label: 'Tidy up', code: 'ctrl+alt+KeyT' },
      { keys: '⌃⌥V', label: 'Distribute vertically', code: 'ctrl+alt+KeyV' },
      { keys: '⌃⌥H', label: 'Distribute horizontally', code: 'ctrl+alt+KeyH' },
      { keys: '⌃⌘M', label: 'Use as mask', code: 'cmd+ctrl+KeyM' },
    ],
  },
  {
    title: 'Shape',
    rows: [
      { keys: '⏎', label: 'Edit the points' },
      { keys: '⌘E', label: 'Flatten', code: 'cmd+KeyE' },
      { keys: '⇧⌘O', label: 'Outline the stroke', code: 'cmd+shift+KeyO' },
      { keys: '⌥⌘U', label: 'Union', code: 'cmd+alt+KeyU' },
      { keys: '⌥⌘S', label: 'Subtract', code: 'cmd+alt+KeyS' },
      { keys: '⌥⌘I', label: 'Intersect', code: 'cmd+alt+KeyI' },
      { keys: '⌥⌘E', label: 'Exclude', code: 'cmd+alt+KeyE' },
    ],
  },
  {
    title: 'Components',
    rows: [
      { keys: '⌥⌘K', label: 'Create a component', code: 'cmd+alt+KeyK' },
      { keys: '⌥⌘B', label: 'Detach the instance', code: 'cmd+alt+KeyB' },
      { keys: '⌥⌘G', label: 'Frame the selection in a flex frame', code: 'cmd+alt+KeyG' },
    ],
  },
];

/** Every chord in the panel, for the test that presses them. */
export const EVERY_CHORD = SHORTCUTS.flatMap((group) => group.rows.map((row) => row.code)).filter(
  (code): code is string => !!code,
);
