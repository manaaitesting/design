'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from './ui/Icons';

type Tab = 'recently-viewed' | 'shared-with-you' | 'shared-projects';

export function FileViewBar({
  activeTab,
  viewMode,
  orgValue,
  scopeValue,
}: {
  activeTab: Tab;
  viewMode: 'grid' | 'list';
  orgValue: string;
  scopeValue: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== '' && v !== 'recently-viewed' && v !== 'grid') {
        // keep clean URLs for defaults: recently-viewed and grid don't need param
        // but for explicit values keep them
        if (k === 'tab' && v === 'recently-viewed') next.delete(k);
        else if (k === 'view' && v === 'grid') next.delete(k);
        else next.set(k, v);
      } else if (v === '' || v === undefined) {
        next.delete(k);
      } else {
        // handle defaults removal
        if (k === 'tab' && v === 'recently-viewed') next.delete(k);
        else if (k === 'view' && v === 'grid') next.delete(k);
        else if (v) next.set(k, v);
      }
    }
    const qs = next.toString();
    router.push(qs ? `/files?${qs}` : '/files');
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'recently-viewed', label: 'Recently viewed' },
    { id: 'shared-with-you', label: 'Shared files' },
    { id: 'shared-projects', label: 'Shared folders' },
  ];

  return (
    <div
      className="file_browser_page_view--viewBarWrapper--NE--p cx_sticky---5t1x"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 6,
        background: 'transparent',
        borderBottom: 'none',
        margin: '0 -24px 16px -24px',
        padding: '0 24px',
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}
    >
      {/* Left: All files + tabs as grey buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
        <button
          onClick={() => router.push('/files')}
          aria-label="All files"
          title="All files"
          style={{
            height: 28,
            border: '1px solid #e6e6e6',
            borderRadius: 8,
            background: '#f0f0f0',
            color: 'rgba(0,0,0,0.82)',
            fontSize: 13,
            fontWeight: 600,
            padding: '0 12px',
            cursor: 'default',
            whiteSpace: 'nowrap',
          }}
        >
          All files
        </button>
        <div role="tablist" aria-orientation="horizontal" style={{ display: 'flex', gap: 8, height: 28 }}>
          {tabs.map((t) => {
            const selected = activeTab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={selected}
                onClick={() => navigate({ tab: t.id })}
                style={{
                  height: 28,
                  border: selected ? '1px solid #d9d9d9' : '1px solid #e6e6e6',
                  borderRadius: 8,
                  background: selected ? '#e5e5e5' : '#f0f0f0',
                  color: selected ? '#000' : 'rgba(0,0,0,0.68)',
                  fontSize: 13,
                  fontWeight: selected ? 600 : 500,
                  cursor: 'default',
                  padding: '0 12px',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Center/Right: filters + view mode */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
        {/* All organizations */}
        <div style={{ position: 'relative', display: 'flex' }}>
          <label htmlFor="org-select" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Organization
          </label>
          <select
            id="org-select"
            value={orgValue}
            onChange={(e) => navigate({ org: e.target.value })}
            aria-label="Organization"
            style={{
              height: 28,
              minWidth: 156,
              padding: '0 28px 0 10px',
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              background: '#fff',
              fontSize: 13,
              fontWeight: 500,
              color: '#000',
              appearance: 'none',
              WebkitAppearance: 'none',
              outline: 'none',
              cursor: 'default',
            }}
          >
            <option value="">All organizations</option>
            <option value="personal">Personal</option>
            <option value="team">Team workspace</option>
          </select>
          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'rgba(0,0,0,0.55)', display: 'grid' }}>
            <Icon.Caret />
          </span>
        </div>

        {/* All files */}
        <div style={{ position: 'relative', display: 'flex' }}>
          <label htmlFor="scope-select" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Scope
          </label>
          <select
            id="scope-select"
            value={scopeValue}
            onChange={(e) => navigate({ scope: e.target.value })}
            aria-label="File scope"
            style={{
              height: 28,
              minWidth: 128,
              padding: '0 28px 0 10px',
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              background: '#fff',
              fontSize: 13,
              fontWeight: 500,
              color: '#000',
              appearance: 'none',
              WebkitAppearance: 'none',
              outline: 'none',
              cursor: 'default',
            }}
          >
            <option value="">All files</option>
            <option value="owned">Owned by me</option>
            <option value="shared">Shared with me</option>
            <option value="starred">Starred</option>
          </select>
          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'rgba(0,0,0,0.55)', display: 'grid' }}>
            <Icon.Caret />
          </span>
        </div>

        {/* View mode */}
        <fieldset
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            border: '1px solid #e5e5e5',
            borderRadius: 8,
            padding: 2,
            height: 28,
            margin: 0,
          }}
          aria-label="View mode"
        >
          <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>View mode</legend>
          <button
            type="button"
            aria-label="Show as grid"
            aria-pressed={viewMode === 'grid'}
            onClick={() => navigate({ view: 'grid' })}
            title="Show as grid"
            style={{
              width: 28,
              height: 22,
              display: 'grid',
              placeItems: 'center',
              border: 0,
              borderRadius: 6,
              background: viewMode === 'grid' ? '#f0f0f0' : 'transparent',
              color: viewMode === 'grid' ? '#000' : 'rgba(0,0,0,0.55)',
              cursor: 'default',
            }}
          >
            <Icon.Grid />
          </button>
          <button
            type="button"
            aria-label="Show as list"
            aria-pressed={viewMode === 'list'}
            onClick={() => navigate({ view: 'list' })}
            title="Show as list"
            style={{
              width: 28,
              height: 22,
              display: 'grid',
              placeItems: 'center',
              border: 0,
              borderRadius: 6,
              background: viewMode === 'list' ? '#f0f0f0' : 'transparent',
              color: viewMode === 'list' ? '#000' : 'rgba(0,0,0,0.55)',
              cursor: 'default',
            }}
          >
            <Icon.List />
          </button>
        </fieldset>
      </div>
    </div>
  );
}
