'use client';

import { useEffect } from 'react';
import { Icon } from './ui/Icons';
import { ShaderSurface } from './ShaderSurface';
import { useStore } from './Session';
import { toWorld, useUI } from '../state/ui';
import { defaultParams, SHADER_CATEGORIES, SHADERS, type ShaderDef } from '../webgl/shaders';
import { ROOT_ID } from '../document/types';

export function ShadersModal() {
  const open = useUI((s) => s.shadersOpen);
  const setOpen = useUI((s) => s.setShadersOpen);
  const select = useUI((s) => s.select);
  const selection = useUI((s) => s.selection);
  const store = useStore();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const apply = (def: ShaderDef) => {
    const params = defaultParams(def);
    const existing = selection.find((id) => store.getSnapshot()[id]?.type === 'shader');

    if (existing) {
      // retarget the shader already selected rather than stacking a new node
      store.update(existing, { shader: { id: def.id, params }, name: def.name });
    } else {
      const vp = useUI.getState().viewport;
      const centre = toWorld(vp, (window.innerWidth - 240 - 42 - 281) / 2, window.innerHeight / 2);
      const id = store.create('shader', ROOT_ID, {
        name: def.name,
        x: Math.round(centre.x - 160),
        y: Math.round(centre.y - 160),
        shader: { id: def.id, params },
      });
      select([id]);
    }
    setOpen(false);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 400 }}
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        style={{
          width: 620,
          maxWidth: '90vw',
          maxHeight: '78vh',
          background: 'var(--color-panel)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-pop)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head" style={{ height: 38 }}>
          <span style={{ flex: 1, fontWeight: 500 }}>Shaders</span>
          <span style={{ color: 'var(--color-ink-dim)' }}>WebGL2 · live preview</span>
          <button type="button" className="btn" style={{ width: 24, padding: 0 }} onClick={() => setOpen(false)}>
            <Icon.Close />
          </button>
        </div>

        <div className="scroll" style={{ flex: 1, padding: '4px 16px 16px' }}>
          {SHADER_CATEGORIES.map((category) => (
            <section key={category}>
              <h3 style={{ fontSize: 12, fontWeight: 500, margin: '16px 0 10px' }}>{category}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {SHADERS.filter((s) => s.category === category).map((def) => (
                  <button
                    key={def.id}
                    type="button"
                    onClick={() => apply(def)}
                    style={{ border: 0, background: 'transparent', padding: 0, cursor: 'default', textAlign: 'left' }}
                  >
                    <div
                      style={{
                        height: 78,
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: '1px solid rgba(0,0,0,0.08)',
                      }}
                    >
                      <ShaderSurface shaderId={def.id} params={defaultParams(def)} />
                    </div>
                    <div style={{ marginTop: 6, color: 'var(--color-ink-muted)' }}>{def.name}</div>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <p style={{ marginTop: 20, color: 'var(--color-ink-dim)', lineHeight: 1.5 }}>
            Every tile above is a real fragment shader running on the GPU. Parameters are editable in the
            inspector, and Export emits the GLSL with a self-contained runtime.
          </p>
        </div>
      </div>
    </div>
  );
}
