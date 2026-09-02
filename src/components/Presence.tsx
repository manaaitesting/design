'use client';

import { useState } from 'react';
import { initials } from '../collab/identity';
import { readableOn } from '../lib/color';
import { Icon } from './ui/Icons';
import { useDoc, usePresence, useReadOnly, useSession } from './Session';
import { openingFrame } from '../document/prototype';
import { ZOOM, useUI, type BooleanView } from '../state/ui';
import { FigMenuItem, FigPopover } from './ui/Figma';
import { contentBounds, fitBounds, selectionBounds, type Bounds } from '../lib/view';

/**
 * Figma's zoom control: the percentage is a menu, not a button.
 *
 * It used to reset to 100% on click, which is one of the six things this menu
 * offers and the least likely one to be wanted — there was no way at all to
 * zoom in, out, or to the selection without knowing the shortcut.
 */
function ZoomMenu({ zoom }: { zoom: number }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const doc = useDoc();
  const view = useUI((s) => s.view);
  const preview = useUI((s) => s.view.pixelPreview);
  const rulers = useUI((s) => s.rulers);

  const frame = (bounds: Bounds | null) => {
    const ui = useUI.getState();
    const fitted = bounds && fitBounds(bounds, ui.leftPanel, ui.leftWidth, ui.rightWidth);
    if (fitted) ui.setViewport(fitted);
  };

  const items: { label: string; tag: string; divider?: boolean; run: () => void }[] = [
    { label: 'Zoom in', tag: '⌘+', run: () => useUI.getState().zoomBy(ZOOM.step) },
    { label: 'Zoom out', tag: '⌘−', run: () => useUI.getState().zoomBy(1 / ZOOM.step) },
    { label: 'Zoom to fit', tag: '⇧1', divider: true, run: () => frame(contentBounds(doc, useUI.getState().page)) },
    {
      label: 'Zoom to selection',
      tag: '⇧2',
      run: () => frame(selectionBounds(useUI.getState().selection, doc)),
    },
    { label: 'Zoom to 50%', tag: '', divider: true, run: () => useUI.getState().zoomTo(0.5) },
    { label: 'Zoom to 100%', tag: '⇧0', run: () => useUI.getState().zoomTo(1) },
    { label: 'Zoom to 200%', tag: '', run: () => useUI.getState().zoomTo(2) },
  ];

  /**
   * Figma's view options, in Figma's order.
   *
   * They are the second half of this menu, and they are all about what the
   * canvas *shows* rather than what the document *is* — which is why they are
   * checkmarks here rather than properties in the panel.
   */
  const views: {
    key: BooleanView | 'rulers';
    label: string;
    tag: string;
    divider?: boolean;
  }[] = [
    { key: 'pixelGrid', label: 'Pixel grid', tag: '⇧\'' },
    { key: 'snapToPixel', label: 'Snap to pixel grid', tag: '⇧⌘\'' },
    { key: 'layoutGuides', label: 'Layout guides', tag: '⇧G' },
    { key: 'rulers', label: 'Rulers', tag: '⇧R' },
    { key: 'outlines', label: 'Outlines', tag: '⌥⇧O' },
    { key: 'cursors', label: 'Multiplayer cursors', tag: '⌥⌘\\' },
    { key: 'labels', label: 'Additional labels', tag: '' },
    { key: 'comments', label: 'Comments', tag: '⇧C', divider: true },
    { key: 'annotations', label: 'Annotations', tag: '⇧Y' },
  ];

  return (
    <>
      <button
        type="button"
        className="fig-btn"
        data-text="true"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        // Space belongs to the canvas the moment this menu is done with it
        onKeyUp={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur();
        }}
        title="Zoom"
      >
        {Math.round(zoom * 100)}%
      </button>
      {anchor && (
        <FigPopover
          anchor={anchor}
          width={230}
          // the view options make this menu tall; Figma shows it in one piece
          maxHeight={560}
          onClose={() => {
            setAnchor(null);
            anchor.blur();
          }}
        >
          {/* Figma opens this menu with the percentage editable, so a number
              you have in mind is one you can simply type */}
          <div style={{ padding: '2px 6px 6px' }}>
            <input
              className="fig-zoom-field"
              aria-label="Zoom"
              value={typed ?? `${Math.round(zoom * 100)}%`}
              autoFocus
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key !== 'Enter') return;
                const next = Number((typed ?? '').replace(/[^0-9.]/g, ''));
                if (Number.isFinite(next) && next > 0) useUI.getState().zoomTo(next / 100);
                setTyped(null);
                setAnchor(null);
                anchor?.blur();
              }}
            />
          </div>
          {items.map((item) => (
            <FigMenuItem
              key={item.label}
              label={item.label}
              tag={item.tag}
              divider={item.divider}
              onSelect={() => {
                item.run();
                setAnchor(null);
                // hand focus back, as the tool rail does: a still-focused
                // button would swallow Space, which belongs to panning
                anchor?.blur();
              }}
            />
          ))}
          {/* Figma hangs the three densities off a submenu; the states are the
              point, so they are rows here — picking the live one turns it off */}
          <FigMenuItem
            label="Pixel preview 1×"
            tag="⌃⇧P"
            divider
            selected={preview === '1x'}
            onSelect={() =>
              useUI.getState().setPixelPreview(preview === '1x' ? 'off' : '1x')
            }
          />
          <FigMenuItem
            label="Pixel preview 2×"
            tag=""
            selected={preview === '2x'}
            onSelect={() =>
              useUI.getState().setPixelPreview(preview === '2x' ? 'off' : '2x')
            }
          />
          {views.map((entry) => (
            <FigMenuItem
              key={entry.key}
              label={entry.label}
              tag={entry.tag}
              divider={entry.divider}
              selected={entry.key === 'rulers' ? rulers : view[entry.key]}
              onSelect={() =>
                entry.key === 'rulers'
                  ? useUI.getState().toggleRulers()
                  : useUI.getState().toggleView(entry.key)
              }
            />
          ))}
        </FigPopover>
      )}
    </>
  );
}

function Avatar({
  name,
  color,
  title,
  active,
  away,
  onClick,
}: {
  name: string;
  color: string;
  title: string;
  /** ringed while you are following them, as Figma rings the person you follow */
  active?: boolean;
  /** they are in the file but on another page — Figma dims them */
  away?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      title={title}
      onClick={onClick}
      style={{
        border: 0,
        padding: 0,
        cursor: onClick ? 'default' : undefined,
        width: 20,
        height: 20,
        borderRadius: 999,
        background: color,
        color: readableOn(color),
        fontWeight: 500,
        display: 'grid',
        placeItems: 'center',
        boxShadow: active ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : '0 0 0 2px #fff',
        opacity: away ? 0.4 : undefined,
        marginLeft: -4,
        fontSize: 11,
        flex: 'none',
      }}
    >
      {initials(name)}
    </Tag>
  );
}

export function Presence() {
  const { identity } = useSession();
  const readOnly = useReadOnly();
  const others = usePresence();
  const doc = useDoc();
  const viewport = useUI((s) => s.viewport);
  const page = useUI((s) => s.page);
  const [copied, setCopied] = useState(false);
  const following = useUI((s) => s.following);
  const setFollowing = useUI((s) => s.setFollowing);
  const spotlight = useUI((s) => s.spotlight);
  const setSpotlight = useUI((s) => s.setSpotlight);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      style={{
        height: 40,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
        borderBottom: '1px solid var(--fig-border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, flex: 1 }}>
        <div style={{ display: 'flex', marginLeft: 4 }}>
          <Avatar
            name={identity.name}
            color={identity.color}
            active={spotlight}
            title={
              spotlight
                ? 'Everyone is watching you — click to stop'
                : `${identity.name} (you) — click to spotlight yourself`
            }
            onClick={() => setSpotlight(!spotlight)}
          />
          {others.map((p) => {
            const elsewhere = !!p.page && p.page !== page;
            return (
              <Avatar
                key={p.clientId}
                name={p.identity.name}
                color={p.identity.color}
                active={following === p.clientId}
                away={elsewhere}
                title={
                  following === p.clientId
                    ? `Following ${p.identity.name} — click to stop`
                    : elsewhere
                      ? `Follow ${p.identity.name} — on ${doc[p.page]?.name ?? 'another page'}`
                      : `Follow ${p.identity.name}`
                }
                onClick={() => setFollowing(following === p.clientId ? null : p.clientId)}
              />
            );
          })}
        </div>

        {readOnly && (
          <span
            title="You were shared this file to view. Ask the owner for edit access to change it."
            style={{
              marginLeft: 10,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--fig-hover)',
              color: 'var(--fig-icon-3)',
              flex: 'none',
            }}
          >
            View only
          </span>
        )}
      </div>

      <button
        type="button"
        className="fig-btn"
        title="Present  ⇧⌘⏎"
        aria-label="Present"
        onClick={() => {
          const ui = useUI.getState();
          ui.present(openingFrame(doc, ui.page, ui.selection));
        }}
      >
        <Icon.Play />
      </button>

      <button
        type="button"
        className="fig-btn"
        onClick={copyLink}
        title="Copy link  ⌘L"
        style={{ background: 'var(--fig-blue)', color: '#fff', padding: '0 10px' }}
      >
        {copied ? 'Copied' : 'Share'}
      </button>

      <ZoomMenu zoom={viewport.zoom} />
    </div>
  );
}
