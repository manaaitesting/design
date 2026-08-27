'use client';

import { useState } from 'react';
import { initials } from '../collab/identity';
import { readableOn } from '../lib/color';
import { Icon } from './ui/Icons';
import { useConnected, useDoc, usePresence, useSession } from './Session';
import { openingFrame } from '../document/prototype';
import { useUI } from '../state/ui';

function Avatar({ name, color, title }: { name: string; color: string; title: string }) {
  return (
    <div
      title={title}
      style={{
        width: 20,
        height: 20,
        borderRadius: 999,
        background: color,
        color: readableOn(color),
        fontWeight: 500,
        display: 'grid',
        placeItems: 'center',
        boxShadow: '0 0 0 2px #fff',
        marginLeft: -4,
        fontSize: 11,
        flex: 'none',
      }}
    >
      {initials(name)}
    </div>
  );
}

export function Presence() {
  const { identity } = useSession();
  const others = usePresence();
  const connected = useConnected();
  const doc = useDoc();
  const viewport = useUI((s) => s.viewport);
  const setViewport = useUI((s) => s.setViewport);
  const [copied, setCopied] = useState(false);

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
          <Avatar name={identity.name} color={identity.color} title={`${identity.name} (you)`} />
          {others.map((p) => (
            <Avatar key={p.clientId} name={p.identity.name} color={p.identity.color} title={p.identity.name} />
          ))}
        </div>

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

      <button
        type="button"
        className="fig-btn"
        data-text="true"
        onClick={() => setViewport((vp) => ({ ...vp, zoom: 1 }))}
        title="Reset zoom to 100%"
      >
        {Math.round(viewport.zoom * 100)}%
      </button>
    </div>
  );
}
