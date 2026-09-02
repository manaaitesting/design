import { Icon } from '../../src/components/ui/Icons';

/**
 * What a folder, a search or a sort looks like while it is being fetched.
 *
 * Every one of those is a navigation to this same route, and without a
 * fallback the browser sat on the previous view with nothing moving. The
 * skeleton keeps the header, because the header does not change between views
 * and redrawing it would be a flash rather than progress.
 */
export default function Loading() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-canvas)' }} data-files-loading>
      <header
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 24px',
          background: 'var(--color-panel)',
          borderBottom: '1px solid var(--color-line)',
        }}
      >
        <Icon.Logo />
        <span style={{ fontWeight: 500 }}>Paperlike</span>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 64px' }}>
        <div style={{ ...BLOCK, width: 140, height: 20, marginBottom: 20 }} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          <div style={{ ...BLOCK, width: 72, height: 24 }} />
          <div style={{ ...BLOCK, width: 96, height: 24 }} />
          <div style={{ ...BLOCK, width: 84, height: 24 }} />
        </div>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}
        >
          {[0, 1, 2, 3, 4, 5].map((slot) => (
            <div
              key={slot}
              style={{
                background: 'var(--color-panel)',
                border: '1px solid var(--color-line)',
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              <div style={{ height: 120, background: 'var(--color-control)' }} />
              <div style={{ padding: 10 }}>
                <div style={{ ...BLOCK, width: '60%', height: 14 }} />
                <div style={{ ...BLOCK, width: '35%', height: 12, marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

const BLOCK: React.CSSProperties = {
  background: 'var(--color-control)',
  borderRadius: 5,
};
