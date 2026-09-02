'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore } from './Session';
import { useUI } from '../state/ui';
import { alignText, stepFontSize, TEXT_ALIGN_KEYS } from '../lib/actions';
import {
  applyToRange,
  diffText,
  isPlain,
  plainText,
  replaceRange,
  runStyle,
  styleAt,
  runsOf,
  styleOfRange,
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
    el.replaceChildren(
      ...runs.current.map((run, index) => {
        const span = document.createElement('span');
        span.dataset.run = String(index);
        Object.assign(span.style, runStyle(run, node.font) as Record<string, string>);
        span.textContent = run.text;
        return span;
      }),
    );
  }, [generation, node.font]);

  // Focus, and put the caret where a click landed — Figma's |, not a
  // select-all. The focus is taken synchronously, in the layout effect, while
  // the element is guaranteed to be connected: an animation frame is not a
  // safe place for it, since a background tab never gets one, and the first
  // keys after the click would then go to the canvas as tool shortcuts.
  // The frame and the timer are fallbacks for a layout that is still settling.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const place = () => {
      if (!el.isConnected) return;
      el.focus({ preventScroll: true });
      const live = window.getSelection();
      const hasCaretInEl =
        !!live &&
        live.rangeCount === 1 &&
        el.contains(live.anchorNode as Node | null) &&
        live.getRangeAt(0).collapsed;
      if (hasCaretInEl) {
        const r = live!.getRangeAt(0);
        const at = offsetOf(el, r.startContainer, r.startOffset);
        setSelection({ start: at, end: at });
        return;
      }
      // otherwise the caret goes to the end — the natural place to keep typing
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      live?.removeAllRanges();
      live?.addRange(range);
      const length = plainText(runs.current).length;
      setSelection({ start: length, end: length });
    };
    place();
    const again = () => {
      if (document.activeElement !== el) place();
    };
    const frame = requestAnimationFrame(again);
    const timer = window.setTimeout(again, 60);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  // Editing can also end without a blur — Escape handled by the editor's
  // shell, a selection change, the layer swapped out from under it — and an
  // empty layer has to go on that road too, or a stray click with the text
  // tool leaves an invisible layer behind every time.
  useEffect(
    () => () => {
      // a tick later, so a strict-mode remount — or the same layer reopened —
      // is not mistaken for leaving it
      window.setTimeout(() => {
        if (useUI.getState().editing === node.id) return;
        const latest = store.getSnapshot()[node.id];
        if (!latest || latest.type !== 'text') return;
        if ((latest.text ?? '').replace(/\n/g, '').trim()) return;
        const ui = useUI.getState();
        if (ui.selection.includes(node.id)) ui.select(ui.selection.filter((id) => id !== node.id));
        store.remove([node.id]);
        store.commit();
      }, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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

  return (
    <>
      <div
        ref={editorRef}
        data-node-id={node.id}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        // an empty layer still needs somewhere to draw the caret
        style={{ ...style, minWidth: '1ch', minHeight: '1em', outline: 'none', cursor: 'text', caretColor: 'var(--color-select-line)' }}
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
          // going *into* the bar is not leaving.
          const next = event.relatedTarget as HTMLElement | null;
          if (next?.closest?.('.fig-range-bar')) return;

          const text = (event.currentTarget as HTMLElement).innerText ?? '';
          const before = plainText(runs.current);
          if (text !== before) {
            const { start, end, inserted } = diffText(before, text);
            runs.current = replaceRange(runs.current, start, end, inserted);
          }
          // a text layer with nothing in it is not a layer — Figma drops an
          // empty one the moment you click away, and so does this
          if (!text.replace(/\n/g, '').trim()) {
            setEditing(null);
            const ui = useUI.getState();
            if (ui.selection.includes(node.id)) ui.select(ui.selection.filter((id) => id !== node.id));
            store.remove([node.id]);
            store.commit();
            return;
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

/**
 * A DOM position as a character offset in the element's text.
 *
 * The model speaks in offsets and the browser speaks in nodes; this is the only
 * place the two have to be introduced to each other.
 */
function offsetOf(root: HTMLElement, container: Node, offset: number): number {
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current === container) return total + offset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  // a position on an element rather than in a text node: count what precedes it
  if (container === root) {
    let counted = 0;
    for (let i = 0; i < offset && i < root.childNodes.length; i++) {
      counted += root.childNodes[i].textContent?.length ?? 0;
    }
    return counted;
  }
  return total;
}

/** Puts a selection back after the spans have been rebuilt. */
function restore(root: HTMLElement | null, start: number, end: number): void {
  if (!root) return;
  const at = (offset: number): { node: Node; offset: number } | null => {
    let total = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const length = current.textContent?.length ?? 0;
      if (offset <= total + length) return { node: current, offset: offset - total };
      total += length;
      current = walker.nextNode();
    }
    return current ? { node: current, offset: 0 } : null;
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
