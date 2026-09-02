'use client';

import { useState } from 'react';
import { Icon } from './ui/Icons';
import { Select } from './ui/Controls';
import { useStore } from './Session';
import { useUI } from '../state/ui';
import { ASPECTS, generateImageFill, generateSvg } from '../lib/generate';
import { ROOT_ID } from '../document/types';

const STYLES = [
  { value: 'variety', label: 'Variety pack' },
  { value: 'photo', label: 'Photographic' },
  { value: 'illustration', label: 'Illustration' },
  { value: 'abstract', label: 'Abstract' },
];

export function PromptBar() {
  const kind = useUI((s) => s.prompt);
  const setPrompt = useUI((s) => s.setPrompt);
  const setTool = useUI((s) => s.setTool);
  const select = useUI((s) => s.select);
  const viewport = useUI((s) => s.viewport);
  const store = useStore();

  const [text, setText] = useState('');
  const [style, setStyle] = useState('variety');
  const [aspect, setAspect] = useState('1:1');
  /**
   * Whether the style and aspect pickers are showing.
   *
   * The sliders button beside the field promised these and did nothing — it had
   * no handler at all — so it now does the one thing its icon claims: it puts
   * the options away when the prompt is all you want, and brings them back.
   */
  const [options, setOptions] = useState(true);

  if (!kind) return null;

  const create = () => {
    const [w, h] = kind === 'svg' ? [240, 240] : ASPECTS[aspect];
    // drop it near the middle of what the user is currently looking at
    const x = Math.round((window.innerWidth / 2 - 240 - viewport.x) / viewport.zoom);
    const y = Math.round((window.innerHeight / 2 - viewport.y) / viewport.zoom);

    const id = store.create('image', ROOT_ID, {
      name: text.slice(0, 24) || (kind === 'svg' ? 'Generated SVG' : 'Generated image'),
      x,
      y,
      w,
      h,
      radius: kind === 'svg' ? 0 : 8,
      fill: kind === 'svg' ? generateSvg(text) : generateImageFill(`${style}:${text}`),
    });
    select([id]);
    setText('');
    setPrompt(null);
    setTool('move');
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        // above the floating toolbar
        bottom: 80,
        transform: 'translateX(-50%)',
        width: 470,
        maxWidth: 'calc(100vw - 640px)',
        background: 'var(--color-panel)',
        borderRadius: 10,
        padding: 10,
        boxShadow: 'var(--shadow-pop)',
        zIndex: 60,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') create();
            if (e.key === 'Escape') {
              setPrompt(null);
              setTool('move');
            }
          }}
          placeholder={kind === 'svg' ? 'A minimal geometric logo mark' : 'A beautiful sunset over a calm ocean'}
          style={{
            flex: 1,
            height: 26,
            border: 0,
            background: 'transparent',
            outline: 'none',
            color: 'var(--color-ink)',
          }}
        />
        <button
          type="button"
          className="btn"
          style={{ width: 24, padding: 0 }}
          title={options ? 'Hide options' : 'Show options'}
          aria-label={options ? 'Hide options' : 'Show options'}
          aria-pressed={options}
          data-on={options ? 'true' : undefined}
          onClick={() => setOptions((on) => !on)}
        >
          <Icon.Sliders />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {options && (
          <div style={{ width: 128 }}>
            <Select value={style} options={STYLES} onChange={setStyle} glyph={<Icon.Shader />} />
          </div>
        )}
        {options && kind === 'image' && (
          <div style={{ width: 82 }}>
            <Select
              value={aspect}
              options={Object.keys(ASPECTS).map((value) => ({ value, label: value }))}
              onChange={setAspect}
            />
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-raised" onClick={create}>
          {kind === 'svg' ? <Icon.SvgAi /> : <Icon.ImageAi />}
          {kind === 'svg' ? 'Create SVG' : 'Create image'}
        </button>
      </div>
    </div>
  );
}
