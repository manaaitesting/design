'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui/Icons';
import { FigIcon } from './ui/FigIcon';
import { FigButton, FigMenuItem, FigPopover } from './ui/Figma';
import { useCustomFonts, useDoc } from './Session';
import {
  CATEGORY_LABEL,
  customFamilies,
  ensureFont,
  ensurePreviewFonts,
  fontFor,
  FONTS,
  GOOGLE_FONTS,
  searchFonts,
  SYSTEM_FONTS,
  type FontFace,
} from '../lib/fonts';

/**
 * The font menu.
 *
 * Two thousand families is too many for a `<select>` in every sense: it cannot
 * be searched, it cannot show a face in its own type, and the browser will not
 * render two thousand rows without stalling. So this is Figma's picker instead —
 * a search box, a source filter, and a list that renders only the rows on
 * screen and fetches previews for exactly those.
 *
 * It opens beside the panel rather than under the field, because a list this
 * tall hanging off a row near the bottom of the inspector would be mostly off
 * the window, and because a picker that covers the rows you are editing is a
 * picker you have to close to see what it did.
 */

/** The sources Figma's picker filters by. */
type Source = 'all' | 'file' | 'popular' | 'google' | 'variable' | 'installed';

const SOURCE_LABEL: Record<Source, string> = {
  all: 'All fonts',
  file: 'In this file',
  popular: 'Popular fonts',
  google: 'Google fonts',
  variable: 'Variable fonts',
  installed: 'Installed by you',
};

/** How many of Google's directory count as "Popular" — its own front page's worth. */
const POPULAR = 150;

const ROW = 30;
const MAX_HEIGHT = 520;
/**
 * The header, search field, filter and padding around the list — 124px — plus
 * the 24px the popover keeps clear of the window edges. The list takes what is
 * left, so the dialog is exactly as tall as it needs to be and never ends up
 * with a scrollbar of its own around the list's.
 */
const CHROME = 148;
/** and never taller than the popover itself will allow */
const VIEW_MAX = MAX_HEIGHT - 124;
const VIEW_MIN = 150;

/** As much list as the window has room for, so the dialog never scrolls itself. */
function listHeight(): number {
  if (typeof window === 'undefined') return 300;
  return Math.max(VIEW_MIN, Math.min(VIEW_MAX, window.innerHeight - CHROME));
}

export function FontPicker({
  value,
  onChange,
  onUpload,
  title = 'Font',
}: {
  /** the CSS stack currently set on the layer */
  value: string;
  onChange: (stack: string) => void;
  /** the + beside the field: reads a font file into the document */
  onUpload?: () => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const custom = useCustomFonts();
  const uploaded = useMemo(() => customFamilies(custom), [custom]);
  const current = fontFor(value, uploaded);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="fig-input"
        title={title}
        data-on={open ? 'true' : undefined}
        style={{ flex: '1 1 0', cursor: 'default' }}
        onPointerDown={(event) => {
          event.stopPropagation();
          // the browser focuses a button on mousedown, which would take the
          // focus straight back off the search field the picker just opened
          event.preventDefault();
          setOpen((v) => !v);
        }}
      >
        <span className="fig-value">{current?.name ?? value}</span>
        <span className="fig-caret">
          <Icon.Caret />
        </span>
      </button>
      {open && (
        <FigPopover
          anchor={anchor.current}
          width={240}
          variant="card"
          placement="beside"
          maxHeight={MAX_HEIGHT}
          onClose={() => setOpen(false)}
        >
          <FontList
            value={value}
            uploaded={uploaded}
            onPick={(font) => {
              ensureFont(font.stack, uploaded);
              onChange(font.stack);
            }}
            onUpload={onUpload}
            onClose={() => setOpen(false)}
          />
        </FigPopover>
      )}
    </>
  );
}

/** Every family the document already sets somewhere — the "In this file" filter. */
function usedFamilies(doc: Record<string, { font?: { family: string } }>): Set<string> {
  const out = new Set<string>();
  for (const node of Object.values(doc)) if (node.font?.family) out.add(node.font.family);
  return out;
}

function FontList({
  value,
  uploaded,
  onPick,
  onUpload,
  onClose,
}: {
  value: string;
  uploaded: FontFace[];
  onPick: (font: FontFace) => void;
  onUpload?: () => void;
  onClose: () => void;
}) {
  const doc = useDoc();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<Source>('all');
  const [sample, setSample] = useState(false);
  const [scroll, setScroll] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const sourceAnchor = useRef<HTMLButtonElement>(null);
  const gearAnchor = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = fontFor(value, uploaded);
  const [view, setView] = useState(listHeight);

  useEffect(() => {
    const fit = () => setView(listHeight());
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const pool = useMemo(() => {
    switch (source) {
      case 'file': {
        const used = usedFamilies(doc);
        const all = [...FONTS, ...uploaded];
        return all.filter((font) => [...used].some((stack) => fontFor(stack, uploaded) === font));
      }
      case 'popular':
        return GOOGLE_FONTS.slice(0, POPULAR);
      case 'google':
        return GOOGLE_FONTS;
      case 'variable':
        return GOOGLE_FONTS.filter((font) => font.axes.length > 0);
      case 'installed':
        return uploaded;
      default:
        return [...SYSTEM_FONTS, ...uploaded, ...GOOGLE_FONTS];
    }
  }, [source, uploaded, doc]);

  // With no query the popularity order stands, which is what makes the top of
  // the list useful; with one, `searchFonts` puts the names that start with it
  // first and sorts each group by name.
  const shown = useMemo(() => searchFonts(pool, query), [pool, query]);

  // open on the family that is set, so the list starts where the design is
  useEffect(() => {
    const index = selected ? shown.indexOf(selected) : -1;
    if (index < 0) return;
    setCursor(index);
    const top = Math.max(0, index * ROW - listHeight() / 2);
    list.current?.scrollTo({ top });
    setScroll(top);
    // only when the picker opens: re-centring on every keystroke would fight
    // the person scrolling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after the click that opened the picker has finished, so the button's own
  // focus does not land on top of it
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      search.current?.focus();
      search.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const first = Math.max(0, Math.floor(scroll / ROW) - 4);
  const slice = shown.slice(first, first + Math.ceil(view / ROW) + 8);

  // the specimen for each row on screen, in one request rather than twenty
  useEffect(() => {
    ensurePreviewFonts(shown.slice(first, first + Math.ceil(view / ROW) + 8));
  }, [shown, first, view]);

  const move = (delta: number) => {
    const next = Math.min(shown.length - 1, Math.max(0, cursor + delta));
    setCursor(next);
    const element = list.current;
    if (!element) return;
    const top = next * ROW;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW - element.clientHeight;
    }
  };

  return (
    <div
      className="fig-fonts"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          const font = shown[cursor];
          if (font) {
            onPick(font);
            onClose();
          }
        } else if (event.key === 'Escape') {
          onClose();
        }
      }}
    >
      <header className="fig-fonts-head">
        <span className="fig-fonts-title">Fonts</span>
        <span ref={gearAnchor} style={{ display: 'inline-flex' }}>
          <FigButton title="Font list settings" on={gearOpen} onClick={() => setGearOpen((v) => !v)}>
            <Icon.Settings />
          </FigButton>
        </span>
        {gearOpen && (
          <FigPopover
            anchor={gearAnchor.current}
            width={190}
            onClose={() => setGearOpen(false)}
          >
            <ul role="listbox" aria-label="Preview" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              <li>
                <FigMenuItem
                  label="Show font names"
                  selected={!sample}
                  onSelect={() => {
                    setSample(false);
                    setGearOpen(false);
                  }}
                />
              </li>
              <li>
                <FigMenuItem
                  label="Show sample text"
                  selected={sample}
                  onSelect={() => {
                    setSample(true);
                    setGearOpen(false);
                  }}
                />
              </li>
              {onUpload && (
                <li>
                  <FigMenuItem
                    label="Upload a font file…"
                    divider
                    onSelect={() => {
                      setGearOpen(false);
                      onUpload();
                    }}
                  />
                </li>
              )}
            </ul>
          </FigPopover>
        )}
        <FigButton title="Close" onClick={onClose}>
          <Icon.Close />
        </FigButton>
      </header>

      <div className="fig-search">
        <span className="fig-search-glyph">
          <Icon.Search />
        </span>
        <input
          ref={search}
          value={query}
          spellCheck={false}
          placeholder="Search fonts"
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
            list.current?.scrollTo({ top: 0 });
            setScroll(0);
          }}
        />
        {query && (
          <button
            type="button"
            className="fig-search-clear"
            title="Clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              search.current?.focus();
            }}
          >
            <Icon.ClearField />
          </button>
        )}
      </div>

      <button
        ref={sourceAnchor}
        type="button"
        className="fig-source"
        title="Which fonts the list shows"
        onPointerDown={(event) => {
          event.stopPropagation();
          setSourceOpen((v) => !v);
        }}
      >
        <span>{SOURCE_LABEL[source]}</span>
        <Icon.Caret />
      </button>
      {sourceOpen && (
        <FigPopover
          anchor={sourceAnchor.current}
          width={200}
          align="left"
          onClose={() => setSourceOpen(false)}
        >
          <ul role="listbox" aria-label="Font source" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {(['all', 'file', 'popular', 'google', 'variable', 'installed'] as Source[]).map(
              (entry) => (
                <li key={entry}>
                  <FigMenuItem
                    label={SOURCE_LABEL[entry]}
                    selected={entry === source}
                    // the groups Figma separates: what you have, what is popular,
                    // and what you brought yourself
                    divider={entry === 'popular' || entry === 'installed'}
                    onSelect={() => {
                      setSource(entry);
                      setSourceOpen(false);
                      setCursor(0);
                      list.current?.scrollTo({ top: 0 });
                      setScroll(0);
                    }}
                  />
                </li>
              ),
            )}
          </ul>
        </FigPopover>
      )}

      <div
        ref={list}
        className="fig-font-list"
        role="listbox"
        aria-label="Fonts"
        style={{ height: view }}
        onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
      >
        {!shown.length && <div className="fig-note">No font matches “{query}”.</div>}
        {/* the scrollbar has to be the length of the whole list, not of the
            dozen rows that are actually rendered */}
        <div style={{ height: shown.length * ROW, position: 'relative' }}>
          {slice.map((font, index) => {
            const at = first + index;
            return (
              <button
                key={`${font.source}:${font.name}`}
                type="button"
                role="option"
                aria-selected={font === selected}
                className="fig-font-row"
                data-cursor={at === cursor ? 'true' : undefined}
                style={{ top: at * ROW, height: ROW }}
                title={`${font.name} — ${CATEGORY_LABEL[font.category]}`}
                onPointerEnter={() => setCursor(at)}
                onClick={() => {
                  onPick(font);
                  onClose();
                }}
              >
                <span className="fig-font-check">
                  {font === selected ? <FigIcon name="Selected check" size={16} /> : null}
                </span>
                <span
                  className="fig-font-name"
                  // the whole point of the list: a family shown in its own face
                  style={{ fontFamily: font.stack }}
                >
                  {sample ? 'The quick brown fox' : font.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
