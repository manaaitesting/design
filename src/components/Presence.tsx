'use client';

import { useState } from 'react';
import { initials } from '../collab/identity';
import { readableOn } from '../lib/color';
import { Icon } from './ui/Icons';
import { useConnected, useDoc, usePresence, useReadOnly, useSession } from './Session';
import { openingFrame } from '../document/prototype';
import { ZOOM, useUI } from '../state/ui';
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
  const doc = useDoc();

  const frame = (bounds: Bounds | null) => {
    const ui = useUI.getState();
    const fitted = bounds && fitBounds(bounds, ui.leftPanel, ui.leftWidth, ui.rightWidth);
    if (fitted) ui.setViewport(fitted);
  };

  const items: { label: string; tag: string; divider?: boolean; run: () => void }[] = [
    { label: 'Zoom in', tag: '+', run: () => useUI.getState().zoomBy(ZOOM.step) },
    { label: 'Zoom out', tag: '−', run: () => useUI.getState().zoomBy(1 / ZOOM.step) },
    { label: 'Zoom to fit', tag: '⇧1', divider: true, run: () => frame(contentBounds(doc)) },
    {
      label: 'Zoom to selection',
      tag: '⇧2',
      run: () => frame(selectionBounds(useUI.getState().selection, doc)),
    },
    { label: 'Zoom to 100%', tag: '⇧0', divider: true, run: () => useUI.getState().zoomTo(1) },
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
          width={200}
          onClose={() => {
            setAnchor(null);
            anchor.blur();
          }}
        >
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
  onClick,
}: {
  name: string;
  color: string;
  title: string;
  /** ringed while you are following them, as Figma rings the person you follow */
  active?: boolean;
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
  const connected = useConnected();
  const doc = useDoc();
  const viewport = useUI((s) => s.viewport);
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
          {others.map((p) => (
            <Avatar
              key={p.clientId}
              name={p.identity.name}
              color={p.identity.color}
              active={following === p.clientId}
              title={
                following === p.clientId
                  ? `Following ${p.identity.name} — click to stop`
                  : `Follow ${p.identity.name}`
              }
              onClick={() => setFollowing(following === p.clientId ? null : p.clientId)}
            />
          ))}
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

        <span
          title={connected ? 'Synced' : 'Offline — edits will sync on reconnect'}
          style={{
            marginLeft: 8,
            width: 6,
            height: 6,
            borderRadius: 999,
            background: connected ? '#34C759' : '#D0D0D0',
            flex: 'none',
          }}
        />
      </div>

      <button
        type="button"
        className="fig-btn"
        title="Version history  ⌥⌘H"
        aria-label="Version history"
        onClick={() => useUI.getState().setHistoryOpen(true)}
      >
        <Icon.Reset />
      </button>

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
