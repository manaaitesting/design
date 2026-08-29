'use client';

import { useMemo, useState } from 'react';
import { Icon } from './ui/Icons';
import { Segmented, Select } from './ui/Controls';
import {
  useCollections,
  useCustomFonts,
  useDoc,
  useTokens,
  useTokenVars,
} from './Session';
import { useUI, type ExportFormat } from '../state/ui';
import { toHtml, toJson, toReact } from '../export/toCode';
import { toTailwind } from '../export/tailwind';
import { download, nodeToPng, nodeToSvg, safeFilename } from '../export/raster';
import { ROOT_ID } from '../document/types';

const CODE_FORMATS: ExportFormat[] = ['react', 'html', 'tailwind', 'json'];

/** The suffix goes into a filename, so it is filtered like one. */
function safeSuffix(suffix: string): string {
  return suffix.trim().replace(/[^a-zA-Z0-9._@-]+/g, '-').replace(/-$/, '');
}

export function ExportDialog() {
  const open = useUI((s) => s.exportOpen);
  const setOpen = useUI((s) => s.setExportOpen);
  const selection = useUI((s) => s.selection);
  const format = useUI((s) => s.exportFormat);
  const setFormat = useUI((s) => s.setExportFormat);
  const scale = useUI((s) => s.exportScale);
  const setScale = useUI((s) => s.setExportScale);
  const suffix = useUI((s) => s.exportSuffix);
  const contentsOnly = useUI((s) => s.exportContentsOnly);
  const zoom = useUI((s) => s.viewport.zoom);

  const doc = useDoc();
  const tokens = useTokens();
  const collections = useCollections();
  const fonts = useCustomFonts();
  const tokenVars = useTokenVars();
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const targetId = selection[0] ?? doc[ROOT_ID]?.children[0] ?? ROOT_ID;
  const target = doc[targetId];
  const isCode = CODE_FORMATS.includes(format);

  const output = useMemo(() => {
    if (!target || !isCode) return { code: '', css: '' };
    if (format === 'react') {
      const { markup, css } = toReact(targetId, doc, tokens, collections, fonts);
      return { code: markup, css };
    }
    if (format === 'tailwind') {
      const { markup, css } = toTailwind(targetId, doc, tokens, collections, fonts);
      return { code: markup, css };
    }
    if (format === 'html') return { code: toHtml(targetId, doc, tokens, collections, fonts), css: '' };
    return { code: toJson(targetId, doc), css: '' };
  }, [doc, tokens, targetId, format, isCode, target]);

  if (!open) return null;

  const copy = async () => {
    const text = output.css ? `${output.code}\n${output.css}` : output.code;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const saveFile = async () => {
    if (!target) return;
    setBusy(true);
    setStatus(null);
    try {
      const name = safeFilename(target.name) + safeSuffix(suffix);
      if (format === 'png') {
        const blob = await nodeToPng(targetId, zoom, scale, tokenVars, contentsOnly);
        download(blob, `${name}@${scale}x.png`);
      } else {
        const serialised = nodeToSvg(targetId, zoom, tokenVars, contentsOnly);
        if (!serialised) throw new Error('That layer is not on screen.');
        download(new Blob([serialised.svg], { type: 'image/svg+xml' }), `${name}.svg`);
      }
      setStatus('Saved to your downloads.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 400 }}
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        style={{
          width: 720,
          maxWidth: '92vw',
          height: '74vh',
          background: 'var(--color-panel)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-pop)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head" style={{ height: 42, gap: 10 }}>
          <span style={{ fontWeight: 500 }}>Export</span>
          <span style={{ color: 'var(--color-ink-dim)' }}>{target?.name ?? '—'}</span>
          <div style={{ flex: 1 }} />

          <div style={{ width: 264 }}>
            <Segmented
              value={format}
              onChange={setFormat}
              options={[
                { value: 'react', label: 'React' },
                { value: 'html', label: 'HTML' },
                { value: 'tailwind', label: 'Tailwind' },
                { value: 'json', label: 'JSON' },
                { value: 'png', label: 'PNG' },
                { value: 'svg', label: 'SVG' },
              ]}
            />
          </div>

          {format === 'png' && (
            <div style={{ width: 72 }}>
              <Select
                value={String(scale)}
                options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}x` }))}
                onChange={(value) => setScale(Number(value))}
              />
            </div>
          )}

          {isCode ? (
            <button type="button" className="btn btn-raised" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          ) : (
            <button type="button" className="btn btn-raised" onClick={saveFile} disabled={busy}>
              {busy ? 'Rendering…' : 'Save'}
            </button>
          )}

          <button type="button" className="btn" style={{ width: 24, padding: 0 }} onClick={() => setOpen(false)}>
            <Icon.Close />
          </button>
        </div>

        {isCode ? (
          <div className="scroll" style={{ flex: 1, background: '#fff' }}>
            <pre
              style={{
                margin: 0,
                padding: 16,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                fontSize: 11.5,
                lineHeight: 1.6,
                whiteSpace: 'pre',
              }}
            >
              {output.code}
              {output.css && `\n/* ${'─'.repeat(28)} */\n\n${output.css}`}
            </pre>
          </div>
        ) : (
          <ImagePreview targetId={targetId} zoom={zoom} vars={tokenVars} status={status} />
        )}
      </div>
    </div>
  );
}

function ImagePreview({
  targetId,
  zoom,
  vars,
  status,
}: {
  targetId: string;
  zoom: number;
  vars: Record<string, string>;
  status: string | null;
}) {
  const serialised = useMemo(() => nodeToSvg(targetId, zoom, vars), [targetId, zoom, vars]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        background: '#fff',
        overflow: 'auto',
      }}
    >
      {serialised ? (
        <>
          <img
            alt="Export preview"
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialised.svg)}`}
            style={{
              maxWidth: '100%',
              maxHeight: '70%',
              objectFit: 'contain',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.08)',
            }}
          />
          <span style={{ color: 'var(--color-ink-dim)' }}>
            {serialised.width} × {serialised.height}
          </span>
        </>
      ) : (
        <span style={{ color: 'var(--color-ink-dim)' }}>
          Scroll the layer into view to render a preview.
        </span>
      )}
      {status && <span style={{ color: 'var(--color-ink-muted)' }}>{status}</span>}
    </div>
  );
}
