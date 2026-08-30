import { expect, test } from '@playwright/test';
import { doc, makeNode, nodeNamed, openEditor, removeNodes, select } from './helpers';

/**
 * The pen surface: what a path can be made of and what a stroke turns into.
 *
 * The geometry project already checks the maths of a swept pen directly. These
 * are the other half of the same question — that the editor hands the pen the
 * border the canvas was drawing with, and that a drag makes a path at all.
 */

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('outlining a dashed stroke leaves one shape per dash, not one long bar', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Divider',
    x: 60,
    y: 600,
    w: 100,
    h: 1,
    anchors: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    closed: false,
    border: { width: 10, color: '#111111', style: 'dashed', position: 'center', dash: 10, gap: 10 },
  });
  await select(page, [id]);
  await page.evaluate(() => {
    window.paperlike!.store.outlineStroke(window.paperlike!.ui.getState().selection);
    window.paperlike!.store.commit();
  });

  const outlined = await nodeNamed(page, 'Divider stroke');
  expect(outlined).toBeTruthy();
  // 10 on, 10 off along 100
  expect(outlined!.paths).toHaveLength(5);
  await removeNodes(page, [outlined!.id]);
});

test('a path wears a head on one end and nothing on the other', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Callout',
    x: 60,
    y: 680,
    w: 120,
    h: 1,
    anchors: [{ x: 0, y: 0 }, { x: 120, y: 0 }],
    closed: false,
    border: {
      width: 4,
      color: '#111111',
      style: 'solid',
      position: 'center',
      capEnd: 'arrowTriangle',
    },
  });

  const path = page.locator(`[data-node-id="${id}"] svg path[marker-end]`).first();
  await expect(path).toHaveCount(1);
  // the head sits on the end alone; the tail is left bare
  expect(await path.getAttribute('marker-start')).toBeNull();

  await select(page, [id]);
  await page.evaluate(() => {
    window.paperlike!.store.outlineStroke(window.paperlike!.ui.getState().selection);
    window.paperlike!.store.commit();
  });
  const outlined = await nodeNamed(page, 'Callout stroke');
  // a 4px pen sweeps a band 4 tall; the head is three widths across, so an
  // outline that dropped it would come out 4 rather than 12
  expect(outlined!.h).toBe(12);
  await removeNodes(page, [outlined!.id]);
});

test('an arrow keeps its head when it is opened for point editing', async ({ page }) => {
  const id = await makeNode(page, 'arrow', {
    name: 'Pointer',
    x: 300,
    y: 680,
    w: 160,
    h: 0,
    border: { width: 4, color: '#111111', style: 'solid', position: 'center' },
  });
  await select(page, [id]);
  await page.evaluate(() => {
    window.paperlike!.store.outlineShape(window.paperlike!.ui.getState().selection);
    window.paperlike!.store.commit();
  });

  const nodes = await doc(page);
  expect(nodes[id].type).toBe('vector');
  // the two-point outline has no head in it, so the head has to live on the end
  expect(nodes[id].border?.capEnd).toBe('arrowLine');
  await removeNodes(page, [id]);
});

test('outlining a square cap keeps the overhang, and a butt cap does not grow one', async ({ page }) => {
  const line = {
    name: 'Rule',
    x: 60,
    y: 640,
    w: 100,
    h: 1,
    anchors: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    closed: false,
  };

  const butt = await makeNode(page, 'vector', {
    ...line,
    border: { width: 20, color: '#111111', style: 'solid', position: 'center', cap: 'butt' },
  });
  await select(page, [butt]);
  await page.evaluate(() => {
    window.paperlike!.store.outlineStroke(window.paperlike!.ui.getState().selection);
    window.paperlike!.store.commit();
  });
  const stopped = await nodeNamed(page, 'Rule stroke');
  expect(stopped!.w).toBe(100);
  await removeNodes(page, [stopped!.id]);

  const square = await makeNode(page, 'vector', {
    ...line,
    name: 'Overhang',
    border: { width: 20, color: '#111111', style: 'solid', position: 'center', cap: 'square' },
  });
  await select(page, [square]);
  await page.evaluate(() => {
    window.paperlike!.store.outlineStroke(window.paperlike!.ui.getState().selection);
    window.paperlike!.store.commit();
  });
  const grown = await nodeNamed(page, 'Overhang stroke');
  // half a width past each end, which is what the canvas was already drawing
  expect(grown!.w).toBe(120);
  await removeNodes(page, [grown!.id]);
});
