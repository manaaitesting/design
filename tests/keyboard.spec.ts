/**
 * The keys Figma's shortcut panel lists that this editor had not bound, and the
 * ones it bound to the wrong thing.
 *
 * They live in a file of their own rather than in `editor.spec.ts` because the
 * thing under test is the key handler itself — one place, one file — and because
 * a keyboard bug reads as a list of chords, which is easier to keep honest when
 * the list is not buried in four thousand lines about the canvas.
 */
import { test, expect } from '@playwright/test';
import { doc, makeNode, openEditor, removeNodes, select, selection } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const tool = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.paperlike!.ui.getState().tool);

test('A arms the Frame tool, the legacy Artboard key Figma still ships', async ({ page }) => {
  await page.keyboard.press('r');
  expect(await tool(page)).toBe('rect');
  await page.keyboard.press('a');
  expect(await tool(page)).toBe('frame');

  // and the modified As still mean what they meant: ⌘A selects, ⇧A lays out
  await page.keyboard.press('v');
  const id = await makeNode(page, 'rect', { name: 'KB A', x: 700, y: 500, w: 60, h: 60, fill: '#4CC3F0' });
  await select(page, [id]);
  await page.keyboard.press('Alt+a');
  expect(await tool(page)).toBe('move');
  await removeNodes(page, [id]);
});
