import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from './ui/Icons';

/**
 * What the app shows when there is nothing to show.
 *
 * Built from the same pieces as the sign-in card, because a dead end is the
 * one screen where looking like the product is most of the work: the whole
 * difference between "you were removed from this file" and "the internet is
 * broken" is whether the page has the logo on it and a way onward.
 */
export function ErrorCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  /** the one thing worth trying from here, if there is one */
  action?: ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div
        style={{
          width: 320,
          background: 'var(--color-panel)',
          borderRadius: 12,
          padding: 24,
          boxShadow: 'var(--shadow-pop)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <Icon.Logo />
          <span style={{ fontWeight: 500 }}>Paperlike</span>
        </div>

        <h1 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 4px' }}>{title}</h1>
        <p style={{ margin: 0, color: 'var(--color-ink-muted)', lineHeight: 1.45 }}>{children}</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
          {action}
          <Link href="/files">Back to your files</Link>
        </div>
      </div>
    </div>
  );
}
