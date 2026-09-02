import { expect, test } from '@playwright/test';
import { doc, makeNode, nodeNamed, openEditor, removeNodes, select, selection } from './helpers';

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

/**
 * A mitred corner keeps its point when it is outlined. This row was carried as
 * "outline stroke re-draws every path with a round pen", and the caps and the
 * dashes had tests while the join had none — so the claim about the join was
 * the one nobody could check. `clipper.ts` `joinPiece` does build a real mitre;
 * this is the test that says so.
 */
test('outlining a mitred corner keeps its point, and a round join does not grow one', async ({ page }) => {
  // a narrow V, where a mitre reaches well past the radius a round join leaves
  const vee = {
    x: 60,
    y: 900,
    w: 100,
    h: 100,
    anchors: [{ x: 0, y: 100 }, { x: 50, y: 0 }, { x: 100, y: 100 }],
    closed: false,
  };
  const outlined = async (name: string, join: 'miter' | 'round') => {
    const id = await makeNode(page, 'vector', {
      ...vee,
      name,
      border: { width: 20, color: '#111111', style: 'solid', position: 'center', cap: 'butt', join },
    });
    await select(page, [id]);
    await page.evaluate(() => {
      window.paperlike!.store.outlineStroke(window.paperlike!.ui.getState().selection);
      window.paperlike!.store.commit();
    });
    const made = await nodeNamed(page, `${name} stroke`);
    await removeNodes(page, [made!.id]);
    return made!;
  };

  const mitred = await outlined('Vee', 'miter');
  const rounded = await outlined('Arc', 'round');

  // The apex is the whole difference: a round join stops half a width above it,
  // a mitre carries on to where the two outer edges actually meet.
  expect(mitred.h).toBeGreaterThan(rounded.h + 8);
  // and the mitre reaches half / sin(half the angle) from the corner, which for
  // this V is ~22px against the round join's 10
  expect(mitred.h - rounded.h).toBeLessThan(18);
  // neither join changes how wide the V is
  expect(Math.abs(mitred.w - rounded.w)).toBeLessThanOrEqual(1);
});

// ── The pen and its keys ────────────────────────────────────────────────
const armPen = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.paperlike!.ui.getState().setTool('pen'));

const drawn = async (page: import('@playwright/test').Page) => {
  const id = (await selection(page))[0];
  return (await doc(page))[id];
};

test('leaving the pen finishes the path instead of throwing it away', async ({ page }) => {
  await armPen(page);
  await page.mouse.click(500, 600);
  await page.mouse.click(620, 600);
  await page.mouse.click(620, 700);

  // picking up another tool is not a way of undrawing: in Figma the layer has
  // been on the document since the first segment
  await page.evaluate(() => window.paperlike!.ui.getState().setTool('move'));
  const path = await drawn(page);
  expect(path.type).toBe('vector');
  expect(path.anchors).toHaveLength(3);
  await removeNodes(page, [path.id]);

  // and Escape ends the path rather than undrawing it
  await armPen(page);
  await page.mouse.click(500, 600);
  await page.mouse.click(640, 640);
  await page.keyboard.press('Escape');
  const stopped = await drawn(page);
  expect(stopped.type).toBe('vector');
  expect(stopped.anchors).toHaveLength(2);
  await removeNodes(page, [stopped.id]);

  // one point is not a path, and leaves nothing behind
  const before = Object.keys(await doc(page)).length;
  await armPen(page);
  await page.mouse.click(500, 600);
  await page.keyboard.press('Escape');
  expect(Object.keys(await doc(page)).length).toBe(before);
});

test('⇧ holds the pen to 45° from the point before it', async ({ page }) => {
  await armPen(page);
  await page.mouse.click(500, 600);
  await page.keyboard.down('Shift');
  // 120 across and 20 down is nowhere near a 45° step; held, it is flat
  await page.mouse.click(620, 620);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Enter');

  const path = await drawn(page);
  const [first, second] = path.anchors!;
  expect(second.y).toBe(first.y);
  // the same `constrain45` the line tool uses: the point swings onto the ray
  // and keeps the length of the pull, so 120 across and 20 down comes out flat
  // at the length of that diagonal
  expect(second.x - first.x).toBe(Math.round(Math.hypot(120, 20)));
  await removeNodes(page, [path.id]);
});

test('⌫ in point editing takes a point, and never the layer', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Pointy', x: 400, y: 500, w: 200, h: 100,
    anchors: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }],
  } as never);
  await select(page, [id]);
  await page.evaluate((node) => window.paperlike!.ui.getState().setVectorEdit(node), id);

  // edit mode opens with nothing selected, and ⌫ used to fall straight through
  // to the editor's own delete and take the whole layer
  await page.keyboard.press('Backspace');
  expect((await doc(page))[id]).toBeTruthy();

  // ⌘⌫ is Figma's delete-and-heal; it too belongs to the points
  await page.keyboard.press('Meta+Backspace');
  expect((await doc(page))[id]).toBeTruthy();
  expect((await doc(page))[id].anchors).toHaveLength(3);

  // with a point selected it does what it says, and the gap closes
  await page.evaluate(() => window.paperlike!.ui.getState().setAnchorSelection([1]));
  await page.keyboard.press('Backspace');
  expect((await doc(page))[id].anchors).toHaveLength(2);

  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});
