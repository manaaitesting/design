/**
 * Rich text.
 *
 * A text layer used to carry one type spec, which meant a paragraph could not
 * have a bold word in it. It carries a list of *runs* now: a string plus the
 * handful of properties that may differ within a paragraph. Everything a run
 * does not say it inherits from the layer's own `font`, so a document that has
 * never been styled per word is still exactly one run and reads as it always
 * did.
 *
 * Runs are a flat list rather than a tree because the operations that matter —
 * "make this range bold", "type here", "delete that" — are all range
 * operations, and a flat list makes each of them one split and one merge. The
 * offsets they take are plain character positions in the concatenated text,
 * which is also what a DOM selection can be reduced to.
 */

import type { CSSProperties } from 'react';
import type { FontSpec, SceneNode } from './types';

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** overrides of the layer's own type spec, for this run alone */
  size?: number;
  weight?: number;
  family?: string;
  color?: string;
  letterSpacing?: number;
  lineHeight?: number;
  case?: FontSpec['case'];
  /** makes the run a link in the export */
  link?: string;
}

/** The properties a run may override — what a range command can set. */
export type RunPatch = Omit<TextRun, 'text'>;

const RUN_KEYS: (keyof RunPatch)[] = [
  'bold',
  'italic',
  'underline',
  'strike',
  'size',
  'weight',
  'family',
  'color',
  'letterSpacing',
  'lineHeight',
  'case',
  'link',
];

/** The runs of a text layer, whichever way it is stored. */
export function runsOf(node: Pick<SceneNode, 'runs' | 'text'>): TextRun[] {
  if (node.runs?.length) return node.runs;
  return [{ text: node.text ?? '' }];
}

export function plainText(runs: TextRun[]): string {
  return runs.map((run) => run.text).join('');
}

/** True when every run is unstyled — the fast path for rendering and export. */
export function isPlain(runs: TextRun[]): boolean {
  return runs.every((run) => RUN_KEYS.every((key) => run[key] === undefined));
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return RUN_KEYS.every((key) => a[key] === b[key]);
}

/** Merges neighbours that agree and drops the empties. */
export function normalize(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out.length ? out : [{ text: '' }];
}

/**
 * Splits the run list so that `offset` falls on a boundary.
 *
 * Every range operation starts here: once both ends of a range are boundaries,
 * the range is a whole number of runs and the operation is a map over them.
 */
function splitAt(runs: TextRun[], offset: number): TextRun[] {
  const out: TextRun[] = [];
  let at = 0;
  for (const run of runs) {
    const end = at + run.text.length;
    if (offset > at && offset < end) {
      const cut = offset - at;
      out.push({ ...run, text: run.text.slice(0, cut) });
      out.push({ ...run, text: run.text.slice(cut) });
    } else {
      out.push({ ...run });
    }
    at = end;
  }
  return out;
}

/** Applies a patch to everything between two character offsets. */
export function applyToRange(
  runs: TextRun[],
  start: number,
  end: number,
  patch: RunPatch,
): TextRun[] {
  if (end <= start) return runs;
  const split = splitAt(splitAt(runs, start), end);

  let at = 0;
  const out = split.map((run) => {
    const from = at;
    at += run.text.length;
    if (from < start || from >= end) return run;
    const next: TextRun = { ...run, ...patch };
    // an explicit undefined means "stop overriding this", so it is dropped
    for (const key of RUN_KEYS) if (next[key] === undefined) delete next[key];
    return next;
  });
  return normalize(out);
}

/** The style in force at an offset — what a toolbar shows as active. */
export function styleAt(runs: TextRun[], offset: number): RunPatch {
  let at = 0;
  for (const run of runs) {
    const end = at + run.text.length;
    if (offset < end || end === at) {
      const { text: _text, ...rest } = run;
      return rest;
    }
    at = end;
  }
  const last = runs[runs.length - 1];
  if (!last) return {};
  const { text: _text, ...rest } = last;
  return rest;
}

/** What a whole range agrees on — anything it disagrees about is left out. */
export function styleOfRange(runs: TextRun[], start: number, end: number): RunPatch {
  if (end <= start) return styleAt(runs, start);
  const split = splitAt(splitAt(runs, start), end);
  let at = 0;
  const covered: TextRun[] = [];
  for (const run of split) {
    const from = at;
    at += run.text.length;
    if (from >= start && from < end) covered.push(run);
  }
  if (!covered.length) return {};

  const shared: RunPatch = {};
  for (const key of RUN_KEYS) {
    const first = covered[0][key];
    if (covered.every((run) => run[key] === first)) {
      (shared as Record<string, unknown>)[key] = first;
    }
  }
  return shared;
}

/**
 * Replaces a range with new text, keeping the styling around it.
 *
 * This is what typing is: the editable element reports its new plain text, the
 * difference against the old is one insertion and one deletion, and the runs
 * are edited to match. Inserted text takes the style of whatever it was typed
 * into, which is what every text editor does and nobody has to be told.
 */
export function replaceRange(
  runs: TextRun[],
  start: number,
  end: number,
  inserted: string,
): TextRun[] {
  const split = splitAt(splitAt(runs, start), end);
  const out: TextRun[] = [];
  let at = 0;
  let placed = false;
  const style = styleAt(runs, Math.max(0, start - 1));

  for (const run of split) {
    const from = at;
    at += run.text.length;
    if (from >= start && from < end) {
      // inside the replaced range: drop it, and drop the insertion in once
      if (!placed && inserted) {
        out.push({ ...style, text: inserted });
        placed = true;
      }
      continue;
    }
    if (!placed && from >= end && inserted) {
      out.push({ ...style, text: inserted });
      placed = true;
    }
    out.push(run);
  }
  if (!placed && inserted) out.push({ ...style, text: inserted });
  return normalize(out);
}

/**
 * The one insertion that turns one string into another.
 *
 * Reading the edit back off the element rather than tracking keystrokes is what
 * makes paste, autocorrect, dictation and drag-and-drop all work without a case
 * for each — they are all just "the text is different now".
 */
export function diffText(
  before: string,
  after: string,
): { start: number; end: number; inserted: string } {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;

  let tail = 0;
  while (
    tail < max - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }

  return {
    start,
    end: before.length - tail,
    inserted: after.slice(start, after.length - tail),
  };
}

/** A run's own CSS, layered over whatever the layer's type spec already said. */
export function runStyle(run: TextRun, font?: FontSpec): CSSProperties {
  const style: CSSProperties = {};
  if (run.bold) style.fontWeight = 700;
  if (run.weight !== undefined) style.fontWeight = run.weight;
  // an explicit `false` is a run saying "not italic" over an italic layer, which
  // is what picking Regular for a range in an italic paragraph means
  if (run.italic !== undefined) style.fontStyle = run.italic ? 'italic' : 'normal';
  if (run.size !== undefined) style.fontSize = run.size;
  if (run.family) style.fontFamily = run.family;
  if (run.color) style.color = run.color;
  if (run.letterSpacing !== undefined) style.letterSpacing = `${run.letterSpacing}em`;
  if (run.lineHeight !== undefined) style.lineHeight = run.lineHeight;
  // small caps are the face's own glyphs rather than a transform, the same
  // distinction the layer's own case makes in css.ts
  if (run.case === 'small') style.fontVariantCaps = 'small-caps';
  else if (run.case && run.case !== 'none') {
    style.textTransform =
      run.case === 'upper' ? 'uppercase' : run.case === 'lower' ? 'lowercase' : 'capitalize';
  }

  const lines = [run.underline && 'underline', run.strike && 'line-through'].filter(Boolean);
  if (lines.length) style.textDecorationLine = lines.join(' ');
  // a link that says nothing about its colour takes the document's blue, which
  // is what a reader expects a link to look like
  if (run.link && !run.color) style.color = font?.color === '#0D99FF' ? font.color : '#0D99FF';
  return style;
}

/**
 * How a bulleted or numbered block is indented.
 *
 * Figma's "Hanging lists" is whether the marker sits out in the indent with the
 * text column straight beside it, or inline with the first line so a wrapped
 * line runs back under the bullet. Hanging is the default because it is what
 * reads as a list; the flush version is here because sometimes a list is really
 * a paragraph that happens to be numbered.
 */
export function listBoxStyle(font?: FontSpec): CSSProperties {
  const hanging = font?.hangingList !== false;
  return hanging
    ? { margin: 0, paddingLeft: '1.4em', listStylePosition: 'outside' }
    : { margin: 0, paddingLeft: 0, listStylePosition: 'inside' };
}

/**
 * How a text layer's lines are laid out.
 *
 * `null` means the whole layer is one flowing block — no list, no paragraph
 * spacing — where the newlines can be left to `pre-wrap` and there is nothing
 * to build. Anything else has to become real elements, and the canvas and the
 * in-place editor both build them from here: they used to decide separately,
 * which is why the bullets and the paragraph gaps vanished the moment a caret
 * appeared.
 */
export function textBlocks(
  runs: TextRun[],
  font?: FontSpec,
): { list: 'ul' | 'ol' | null; spacing: number; lines: TextRun[][] } | null {
  const spacing = font?.paragraphSpacing ?? 0;
  const kind = font?.list && font.list !== 'none' ? font.list : null;
  if (!kind && !spacing) return null;
  return { list: kind ? (kind === 'number' ? 'ol' : 'ul') : null, spacing, lines: runLines(runs) };
}

/**
 * The soft line break.
 *
 * ⏎ starts a paragraph and ⇧⏎ breaks a line inside one, and the two have to be
 * different characters or paragraph spacing opens up between every line and a
 * two-line list item becomes two items. U+2028 LINE SEPARATOR is what Unicode
 * has for exactly this, so it is what the model stores.
 */
export const LINE_BREAK = '\u2028';

function splitRuns(runs: TextRun[], at: string): TextRun[][] {
  const parts: TextRun[][] = [[]];
  for (const run of runs) {
    run.text.split(at).forEach((piece, index) => {
      if (index > 0) parts.push([]);
      if (piece) parts[parts.length - 1].push({ ...run, text: piece });
    });
  }
  return parts;
}

/** Splits runs into one list per paragraph, so spacing and lists still work. */
export function runLines(runs: TextRun[]): TextRun[][] {
  return splitRuns(runs, '\n');
}

/** Splits one paragraph at its soft breaks — each piece is one drawn line. */
export function runSegments(line: TextRun[]): TextRun[][] {
  return splitRuns(line, LINE_BREAK);
}
