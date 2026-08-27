import type { DocStore } from './store';
import { ROOT_ID } from './types';

/**
 * A starter artboard, created once per room. It exists to demonstrate the thing
 * that makes this canvas different: the card below is a real flex container, so
 * changing the gap or padding reflows it exactly as the browser would.
 */
export function seedDocument(store: DocStore): void {
  const doc = store.getSnapshot();
  const page = doc[ROOT_ID];
  if (!page || page.children.length > 0) return;

  const artboard = store.create('frame', ROOT_ID, {
    name: 'Vinyl Sundays',
    x: 0,
    y: 0,
    w: 420,
    h: 560,
    fill: '#FFFFFF',
    radius: 12,
    clip: true,
    flex: { direction: 'column', gap: 20, padding: [28, 24, 28, 24], align: 'stretch', justify: 'start', wrap: false },
    shadow: { x: 0, y: 12, blur: 32, spread: -8, color: 'rgba(0,0,0,0.14)' },
  });

  store.create('text', artboard, {
    name: 'Eyebrow',
    text: 'THIS WEEK',
    wMode: 'fill',
    hMode: 'fit',
    font: { family: 'Inter, system-ui, sans-serif', size: 11, weight: 600, lineHeight: 1.2, letterSpacing: 0.12, align: 'left', color: '#8A8A8A' },
  });

  store.create('text', artboard, {
    name: 'Title',
    text: 'Vinyl Sundays',
    wMode: 'fill',
    hMode: 'fit',
    font: { family: 'Inter, system-ui, sans-serif', size: 34, weight: 600, lineHeight: 1.1, letterSpacing: -0.02, align: 'left', color: '#111111' },
  });

  store.create('rect', artboard, {
    name: 'Cover',
    wMode: 'fill',
    hMode: 'fixed',
    h: 220,
    radius: 10,
    fill: 'linear-gradient(135deg, #BDEE63 0%, #4CC3F0 55%, #9B7BF0 100%)',
  });

  const row = store.create('frame', artboard, {
    name: 'Meta',
    wMode: 'fill',
    hMode: 'fit',
    fill: null,
    clip: false,
    flex: { direction: 'row', gap: 12, padding: [0, 0, 0, 0], align: 'center', justify: 'between', wrap: false },
  });

  store.create('text', row, {
    name: 'Tracks',
    text: '12 tracks · 48 min',
    wMode: 'fit',
    hMode: 'fit',
    font: { family: 'Inter, system-ui, sans-serif', size: 13, weight: 400, lineHeight: 1.4, letterSpacing: 0, align: 'left', color: '#6B6B6B' },
  });

  const pill = store.create('frame', row, {
    name: 'Play',
    wMode: 'fit',
    hMode: 'fit',
    fill: '#111111',
    radius: 999,
    clip: false,
    flex: { direction: 'row', gap: 6, padding: [8, 16, 8, 16], align: 'center', justify: 'center', wrap: false },
  });

  store.create('text', pill, {
    name: 'Play label',
    text: 'Play',
    wMode: 'fit',
    hMode: 'fit',
    font: { family: 'Inter, system-ui, sans-serif', size: 13, weight: 500, lineHeight: 1.2, letterSpacing: 0, align: 'center', color: '#FFFFFF' },
  });
}
