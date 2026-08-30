'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore } from './Session';
import { useUI } from '../state/ui';
import { alignText, stepFontSize, TEXT_ALIGN_KEYS } from '../lib/actions';
import {
  applyToRange,
  diffText,
  isPlain,
  listBoxStyle,
  plainText,
  replaceRange,
  runStyle,
  styleAt,
  runsOf,
  styleOfRange,
  textBlocks,
  type RunPatch,
  type TextRun,
} from '../document/text';
import type { SceneNode } from '../document/types';

/**
 * Editing text in place, with the styling per range.
 *
 * The hard part of rich text is not applying bold; it is keeping a model in
 * step with a `contentEditable`, which will happily rewrite your markup on a
 * paste and has opinions about where a caret goes. So this does not try to
 * control the DOM keystroke by keystroke. It reads the element's plain text
 * after every change, works out the one insertion that turns the old string
 * into the new one, and applies exactly that edit to the runs — which makes
 * typing, pasting, dictation, autocorrect and drag-and-drop all the same case.
 *
 * The spans are built once, when editing begins, and left alone while the
 * browser edits them — see the layout effect below for why that matters.
 */
export function TextEditor({ node, style }: { node: SceneNode; style: CSSProperties }) {
  const store = useStore();
  const setEditing = useUI((s) => s.setEditing);
  const setEditingRange = useUI((s) => s.setEditingRange);
  const editorRef = useRef<HTMLDivElement>(null);
  /** the runs as they stand — the DOM is a view of this, not the other way round */
  const runs = useRef<TextRun[]>(runsOf(node));
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  /** bumping this re-seeds the DOM from the model, after a styling change */
  const [generation, setGeneration] = useState(0);

  /**
   * The spans are built by hand rather than rendered.
   *
   * React reconciling children under a live caret is what makes a rich-text
   * editor jump the cursor to the start halfway through a word: the model
   * updates on every keystroke, the component re-renders, and React rewrites
   * the very text node the browser is editing. Building the spans imperatively
   * — once, and again only when the *styling* changes — leaves the browser in
   * sole charge of the DOM it is editing.
   */
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    let index = 0;
    const paint = (run: TextRun) => {
      const span = document.createElement('span');
      span.dataset.run = String(index++);
      Object.assign(span.style, runStyle(run, node.font) as Record<string, string>);
      span.textContent = run.text;
      return span;
    };

    // The same blocks the canvas draws: editing is in place, so a bulleted list
    // has to stay bulleted and a paragraph gap has to stay open while the caret
    // is in it, or the text jumps the moment you double-click it.
    const blocks = textBlocks(runs.current, node.font);
    if (!blocks) {
      el.replaceChildren(...runs.current.map(paint));
      return;
    }

    const lines = blocks.lines.map((line, at) => {
      const box = document.createElement(blocks.list ? 'li' : 'div');
      if (at && blocks.spacing) box.style.marginTop = `${blocks.spacing}px`;
      // an empty paragraph has no text to give it a height, and a block with no
      // height cannot be clicked into
      box.replaceChildren(...(line.length ? line.map(paint) : [document.createElement('br')]));
      return box;
    });
    if (!blocks.list) {
      el.replaceChildren(...lines);
      return;
    }
    const list = document.createElement(blocks.list);
    Object.assign(list.style, listBoxStyle(node.font) as Record<string, string>);
    list.replaceChildren(...lines);
    el.replaceChildren(list);
  }, [generation, node.font]);

  /**
   * A styling change that came from outside — the type panel acting on the
   * selected characters — has to land in the editor's own copy of the runs, or
   * the next keystroke would write the stale copy back over it. The comparison
   * is against the model rather than the array's identity because the document
   * is rebuilt from Yjs on every write, so nothing survives by reference.
   */
  useLayoutEffect(() => {
    const incoming = runsOf(node);
    if (JSON.stringify(incoming) === JSON.stringify(runs.current)) return;
    runs.current = incoming;
    setGeneration((value) => value + 1);
  }, [node.runs, node.text]);

  // the panel needs to know what is selected; publishing it here is what makes
  // the Text section act on the characters rather than on the layer
  useEffect(() => {
    setEditingRange(selection.end > selection.start ? selection : null);
  }, [selection, setEditingRange]);

  // focus once, and select everything, as Figma does when you enter a layer
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const live = window.getSelection();
      live?.removeAllRanges();
      live?.addRange(range);
      setSelection({ start: 0, end: plainText(runs.current).length });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  /**
   * Where the caret is.
   *
   * `selectionchange` on the document is the only signal that catches every way
   * a selection can move — mouse, keyboard, ⌘A, an assistive device — which is
   * why it is listened for rather than the element's own events.
   */
  useEffect(() => {
    const read = () => {
      const el = editorRef.current;
      const live = window.getSelection();
      if (!el || !live || live.rangeCount === 0) return;
      const range = live.getRangeAt(0);
      if (!el.contains(range.startContainer)) return;
      setSelection({
        start: offsetOf(el, range.startContainer, range.startOffset),
        end: offsetOf(el, range.endContainer, range.endOffset),
      });
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, []);

  /**
   * Applies a patch to the selected range.
   *
   * With nothing selected the patch lands on the whole layer, which is the rule
   * the type panel already follows: no range means the text object. It is also
   * the only answer that is never a no-op, and a shortcut that silently does
   * nothing is worse than one that is missing.
   */
  const targetRange = () =>
    selection.end > selection.start
      ? { start: selection.start, end: selection.end }
      : { start: 0, end: plainText(runs.current).length };

  const applyStyle = (patch: RunPatch) => {
    const { start, end } = targetRange();
    if (end <= start) return;
    runs.current = applyToRange(runs.current, start, end, patch);
    store.update(node.id, { runs: runs.current, text: plainText(runs.current) });
    // the DOM has to be rebuilt from the model for the new spans to exist
    setGeneration((value) => value + 1);
    requestAnimationFrame(() => restore(editorRef.current, start, end));
  };

  /**
   * ⇧⌥⌘V — paste without formatting.
   *
   * The text goes in at the caret wearing whatever the caret was wearing, which
   * is what `replaceRange` does with an insertion: it takes the style of the run
   * it lands in. Going through the model rather than letting the browser paste
   * is the same reason ⌘B does — a `contentEditable` pastes markup this editor
   * treats as a view of the runs, so anything the model did not learn is gone
   * the next time the spans are rebuilt.
   */
  const pastePlain = async () => {
    const text = (await navigator.clipboard.readText()).replace(/\r\n/g, '\n');
    if (!text) return;
    const { start, end } = selection;

    // `replaceRange` gives an insertion the style of the character *before* it,
    // which is the right rule for typing and the wrong one for replacing a
    // range: paste over a bold word and the result should be bold, not the
    // colour of the space in front of it. So the style of what is being
    // replaced is read first and put back on afterwards — every key the
    // insertion would otherwise have inherited is cleared, or an unwanted bold
    // would survive the overlay.
    const wanted = end > start ? styleOfRange(runs.current, start, end) : null;
    const inherited = styleAt(runs.current, Math.max(0, start - 1));
    runs.current = replaceRange(runs.current, start, end, text);
    if (wanted) {
      const patch: RunPatch = {};
      for (const key of Object.keys(inherited)) (patch as Record<string, unknown>)[key] = undefined;
      runs.current = applyToRange(runs.current, start, start + text.length, { ...patch, ...wanted });
    }
    store.update(node.id, { runs: runs.current, text: plainText(runs.current) });
    setGeneration((value) => value + 1);
    const caret = start + text.length;
    requestAnimationFrame(() => restore(editorRef.current, caret, caret));
  };

  const current = styleOfRange(runs.current, selection.start, selection.end);
  const hasRange = selection.end > selection.start;
  // Truncation is a view of the text rather than the text itself, and keeping
  // the clamp on while you edit hides the very lines you are typing. `display`
  // comes off with it because the clamp is what made the box a `-webkit-box`.
  const clamp = node.font?.maxLines
    ? { display: undefined, WebkitBoxOrient: undefined, WebkitLineClamp: undefined, overflow: undefined }
    : null;

  return (
    <>
      <div
        ref={editorRef}
        data-node-id={node.id}
        contentEditable
        suppressContentEditableWarning
        style={{ ...style, ...clamp, outline: '1.5px solid var(--color-select)', cursor: 'text' }}
        // the DOM inside is the browser's while it is being edited; see above
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            (event.currentTarget as HTMLElement).blur();
            return;
          }
          const mod = event.metaKey || event.ctrlKey;
          if (!mod) return;

          // ⇧⌥⌘V drops whatever the clipboard was wearing and takes the
          // caret's style instead. Claimed before the ⌥ guard below, which
          // exists for the marks and would swallow it.
          if (event.altKey && event.shiftKey && event.code === 'KeyV') {
            event.preventDefault();
            void pastePlain();
            return;
          }

          // ⌥⌘L / ⌥⌘T / ⌥⌘R / ⌥⌘J and ⇧⌘< / ⇧⌘> are properties of the layer
          // rather than of a run, and Figma keeps them working with the caret
          // inside it. Changing `node.font` re-seeds the spans, so the caret has
          // to be put back where it was.
          const layer =
            event.altKey && !event.shiftKey && TEXT_ALIGN_KEYS[event.code]
              ? () => alignText(store, [node.id], TEXT_ALIGN_KEYS[event.code])
              : !event.altKey && event.shiftKey && (event.code === 'Comma' || event.code === 'Period')
                ? () => stepFontSize(store, [node.id], event.code === 'Period' ? 1 : -1)
                : null;
          if (layer) {
            event.preventDefault();
            const { start, end } = selection;
            layer();
            requestAnimationFrame(() => restore(editorRef.current, start, end));
            return;
          }

          // ⌘B / ⌘I / ⌘U / ⇧⌘X, as Figma binds them.
          //
          // These have to be claimed rather than left to the browser: a
          // `contentEditable` answers ⌘B by writing a <b> into the DOM, which
          // this editor treats as a view of the runs rather than the truth. The
          // plain text is unchanged, so `onInput` sees nothing, the model never
          // learns, and the styling disappears the next time the spans are
          // rebuilt. Doing it ourselves is the only way it survives.
          if (event.altKey) return;
          const key = event.key.toLowerCase();
          const mark =
            !event.shiftKey && key === 'b'
              ? 'bold'
              : !event.shiftKey && key === 'i'
                ? 'italic'
                : !event.shiftKey && key === 'u'
                  ? 'underline'
                  : event.shiftKey && key === 'x'
                    ? 'strike'
                    : null;
          if (!mark) return;
          event.preventDefault();
          // read the mark off the span the change will land on, which is not
          // `current` when the caret is collapsed and the whole layer is meant
          const span = targetRange();
          const on = styleOfRange(runs.current, span.start, span.end)[mark];
          applyStyle({ [mark]: on ? undefined : true });
        }}
        onInput={(event) => {
          const after = (event.currentTarget as HTMLElement).innerText ?? '';
          const before = plainText(runs.current);
          if (after === before) return;
          const { start, end, inserted } = diffText(before, after);
          runs.current = replaceRange(runs.current, start, end, inserted);
          // the model follows the element; the element is not re-rendered, so
          // the caret stays exactly where the browser put it
          store.update(node.id, { runs: runs.current, text: after });
        }}
        onBlur={(event) => {
          // Clicking the range bar moves focus out of the editable, and ending
          // the edit there would close the very bar that was clicked. Focus
          // going *into* the bar is not leaving — nor is going into the right
          // panel, whose type controls act on the selection and would otherwise
          // end the edit they were reaching for.
          const next = event.relatedTarget as HTMLElement | null;
          if (next?.closest?.('.fig-range-bar, .fig')) return;

          const text = (event.currentTarget as HTMLElement).innerText ?? '';
          const before = plainText(runs.current);
          if (text !== before) {
            const { start, end, inserted } = diffText(before, text);
            runs.current = replaceRange(runs.current, start, end, inserted);
          }
          const styled = !isPlain(runs.current);
          store.update(node.id, {
            text,
            // a layer with nothing to say about its runs should not carry them
            runs: styled ? runs.current : undefined,
          });
          store.commit();
          setEditing(null);
        }}
      />

      {hasRange && <RangeBar node={node} current={current} onApply={applyStyle} />}
    </>
  );
}

/**
 * The bar that appears over a selection.
 *
 * Figma shows the type panel's controls acting on the selection; a floating bar
 * is the same idea where the eye already is. Only the properties that can differ
 * within a paragraph are here — the rest still belong to the layer.
 */
function RangeBar({
  node,
  current,
  onApply,
}: {
  node: SceneNode;
  current: RunPatch;
  onApply: (patch: RunPatch) => void;
}) {
  const rect = document.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)?.getBoundingClientRect();
  if (!rect) return null;

  const toggle = (key: 'bold' | 'italic' | 'underline' | 'strike') => () =>
    onApply({ [key]: current[key] ? undefined : true });

  return (
    <div
      className="fig-range-bar"
      style={{ left: rect.left, top: rect.top - 38 }}
      onPointerDown={(event) => {
        // Buttons act without taking focus, so the text selection survives the
        // click. A field has to be focusable to be typed into, so it keeps its
        // default — the editor knows not to end the edit for it.
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      <button type="button" data-on={current.bold || undefined} title="Bold" onClick={toggle('bold')}>
        B
      </button>
      <button
        type="button"
        data-on={current.italic || undefined}
        title="Italic"
        style={{ fontStyle: 'italic' }}
        onClick={toggle('italic')}
      >
        I
      </button>
      <button
        type="button"
        data-on={current.underline || undefined}
        title="Underline"
        style={{ textDecoration: 'underline' }}
        onClick={toggle('underline')}
      >
        U
      </button>
      <button
        type="button"
        data-on={current.strike || undefined}
        title="Strikethrough"
        style={{ textDecoration: 'line-through' }}
        onClick={toggle('strike')}
      >
        S
      </button>
      <span className="fig-range-sep" />
      <input
        type="color"
        title="Colour"
        value={current.color ?? node.font?.color ?? '#111111'}
        onChange={(event) => onApply({ color: event.target.value.toUpperCase() })}
      />
      <input
        type="number"
        title="Size"
        min={1}
        placeholder={String(node.font?.size ?? 16)}
        value={current.size ?? ''}
        onChange={(event) =>
          onApply({ size: event.target.value ? Number(event.target.value) : undefined })
        }
      />
      <button
        type="button"
        title="Clear formatting"
        onClick={() =>
          onApply({
            bold: undefined,
            italic: undefined,
            underline: undefined,
            strike: undefined,
            color: undefined,
            size: undefined,
            weight: undefined,
            family: undefined,
            letterSpacing: undefined,
            link: undefined,
          })
        }
      >
        ⨯
      </button>
    </div>
  );
}

/** The elements that end a line: a paragraph, a list item, whatever the browser drops in. */
const BLOCK = new Set(['DIV', 'P', 'LI']);

/**
 * Walks the editable in document order, counting characters as the model does.
 *
 * The model speaks in offsets and the browser speaks in nodes; this is the only
 * place the two have to be introduced to each other. A line break is one
 * character in the model and none at all in the DOM — it is a `<div>`, an
 * `<li>` or a `<br>` — so the walk pays for each boundary as it crosses it,
 * which is what lets the editor draw real paragraphs and lists without the
 * offsets sliding under it.
 *
 * `onText` is told where each text node starts and stops the walk by returning
 * true; `onChild` is told where each position *between* children falls, which
 * is how a selection anchored on an element rather than in its text is read.
 */
function walkText(
  root: HTMLElement,
  onText: (node: Text, from: number) => boolean | void,
  onChild?: (parent: Node, index: number, at: number) => void,
): number {
  let total = 0;
  // a block owes a newline only once something is already in front of it
  let emitted = false;
  let done = false;

  const step = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (onText(text, total)) done = true;
      total += text.data.length;
      if (text.data.length) emitted = true;
      return;
    }
    if (node.nodeName === 'BR') {
      total += 1;
      emitted = true;
      return;
    }
    const element = node as HTMLElement;
    const block = BLOCK.has(element.nodeName);
    if (block && emitted) total += 1;
    for (let i = 0; i < element.childNodes.length; i++) {
      onChild?.(element, i, total);
      if (done) return;
      step(element.childNodes[i]);
    }
    onChild?.(element, element.childNodes.length, total);
    if (block) emitted = true;
  };

  step(root);
  return total;
}

/** A DOM position as a character offset in the element's text. */
function offsetOf(root: HTMLElement, container: Node, offset: number): number {
  let answer: number | null = null;
  const total = walkText(
    root,
    (text, from) => {
      if (text !== container) return false;
      answer = from + offset;
      return true;
    },
    (parent, index, at) => {
      if (answer === null && parent === container && index === offset) answer = at;
    },
  );
  return answer ?? total;
}

/** Puts a selection back after the spans have been rebuilt. */
function restore(root: HTMLElement | null, start: number, end: number): void {
  if (!root) return;
  const at = (offset: number): { node: Node; offset: number } | null => {
    let found: { node: Node; offset: number } | null = null;
    let last: { node: Node; offset: number } | null = null;
    walkText(root, (text, from) => {
      last = { node: text, offset: text.data.length };
      if (offset > from + text.data.length) return false;
      found = { node: text, offset: offset - from };
      return true;
    });
    return found ?? last;
  };

  const from = at(start);
  const to = at(end);
  if (!from || !to) return;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  const live = window.getSelection();
  live?.removeAllRanges();
  live?.addRange(range);
  root.focus();
}
