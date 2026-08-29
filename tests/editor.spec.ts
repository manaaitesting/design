import { expect, test } from '@playwright/test';
import { dragBy, doc, makeNode, nodeNamed, openEditor, removeNodes, select, selection } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('renders the document and its layers', async ({ page }) => {
  await expect(page.locator('.fig-layer', { hasText: 'Fixture Board' }).first()).toBeVisible();
  const nodes = await doc(page);
  expect(Object.keys(nodes).length).toBeGreaterThan(1);
});

test('a single click selects the artboard, not the layer under the cursor', async ({ page }) => {
  const cover = await nodeNamed(page, 'Cover');
  await page.locator(`[data-node-id="${cover!.id}"]`).click();

  const artboard = await nodeNamed(page, 'Fixture Board');
  expect(await selection(page)).toEqual([artboard!.id]);
});

test('double-click drills exactly one level', async ({ page }) => {
  const cover = await nodeNamed(page, 'Cover');
  const target = page.locator(`[data-node-id="${cover!.id}"]`);
  await target.click();
  await target.dblclick();

  const selected = await page.evaluate(() => window.paperlike!.ui.getState().selection as string[]);
  const nodes = await doc(page);
  // one level in from the artboard is the artboard's own child
  expect(nodes[selected[0]].parent).toBe((await nodeNamed(page, 'Fixture Board'))!.id);
});

test('dragging moves a layer', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'DragMe', x: 40, y: 500, w: 120, h: 80, fill: '#F2637F' });
  await select(page, [id]);

  const box = await page.locator(`[data-node-id="${id}"]`).boundingBox();
  await dragBy(page, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }, { x: 80, y: 40 });

  const after = (await doc(page))[id];
  expect(after.x).toBeGreaterThan(40);
  expect(after.y).toBeGreaterThan(500);
  await removeNodes(page, [id]);
});

/**
 * Figma decides a layer's parent by where you drop it. Moving a layer onto a
 * frame makes it a child of that frame, and moving it off every frame gives it
 * back to the page — in both directions without the layer appearing to move,
 * which is the whole point: the drop changes the tree, not the picture.
 */
test('dropping a layer on a frame makes it a child of that frame', async ({ page }) => {
  // a frame away from the origin, so a parent-local coordinate is not the same
  // number as the world one and a wrong conversion cannot pass by accident
  const frame = await makeNode(page, 'frame', {
    name: 'Adopter', x: 700, y: 0, w: 300, h: 300, fill: '#FFFFFF', flex: null,
  });
  const id = await makeNode(page, 'rect', {
    name: 'Adoptee', x: 700, y: 400, w: 100, h: 60, fill: '#F2637F',
  });
  await select(page, [id]);

  const before = await page.locator(`[data-node-id="${id}"]`).boundingBox();
  await dragBy(page, { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 }, { x: 80, y: -270 });

  const after = (await doc(page))[id];
  expect(after.parent).toBe(frame);
  // world (780, 130) inside a frame at (700, 0)
  expect([after.x, after.y]).toEqual([80, 130]);

  // and it did not jump on screen: the box is where the drag left it
  const moved = await page.locator(`[data-node-id="${id}"]`).boundingBox();
  expect(moved!.x).toBeCloseTo(before!.x + 80, 0);
  expect(moved!.y).toBeCloseTo(before!.y - 270, 0);

  await removeNodes(page, [frame, id]);
});

test('dragging a layer clear of every frame returns it to the page', async ({ page }) => {
  const frame = await makeNode(page, 'frame', {
    name: 'Releaser', x: 700, y: 0, w: 300, h: 300, fill: '#FFFFFF', flex: null,
  });
  const id = await page.evaluate((parent) => {
    const made = window.paperlike!.store.create('rect', parent, {
      name: 'Escapee', x: 20, y: 20, w: 80, h: 60, fill: '#7B61FF',
    });
    window.paperlike!.store.commit();
    return made;
  }, frame);
  await select(page, [id]);

  const before = await page.locator(`[data-node-id="${id}"]`).boundingBox();
  // ⌘ takes the layer under the pointer rather than the frame around it, which
  // is the only way to get hold of a child without drilling in first
  await dragBy(
    page,
    { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 },
    { x: 0, y: 580 },
    ['Meta'],
  );

  const nodes = await doc(page);
  expect(nodes[id].parent).toBe(nodes[frame].parent);
  // local (20, 20) in a frame at (700, 0), dragged 580 down, is world (720, 600)
  expect([nodes[id].x, nodes[id].y]).toEqual([720, 600]);

  await removeNodes(page, [frame, id]);
});

/**
 * A child of an auto layout has no position of its own, so dragging it can only
 * mean one thing: put it somewhere else in the order. Dragging the frame away
 * from under the pointer — which is what happens if the gesture walks up to the
 * nearest absolutely-placed ancestor — is the opposite of what was asked for.
 */
test('dragging a child inside an auto layout reorders it, and leaves the frame alone', async ({ page }) => {
  const built = await page.evaluate(() => {
    const store = window.paperlike!.store;
    const frame = store.create('frame', 'root', {
      name: 'Flow', x: 700, y: 0, w: 300, h: 100, fill: '#FFFFFF',
      flex: {
        mode: 'flex', direction: 'row', gap: 10, padding: [0, 0, 0, 0],
        align: 'start', justify: 'start', wrap: false,
      },
    } as never);
    const kid = (name: string, fill: string) =>
      store.create('rect', frame, { name, w: 60, h: 60, fill } as never);
    const ids = [kid('Alpha', '#F2637F'), kid('Beta', '#4CC3F0'), kid('Gamma', '#9B7BF0')];
    store.commit();
    return { frame, ids };
  });

  const first = page.locator(`[data-node-id="${built.ids[0]}"]`);
  const box = await first.boundingBox();
  // ⌘ gets hold of the child itself; a plain press would select the frame
  await dragBy(page, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }, { x: 100, y: 0 }, ['Meta']);

  const nodes = await doc(page);
  expect(nodes[built.frame].children.map((id: string) => nodes[id].name)).toEqual([
    'Beta', 'Alpha', 'Gamma',
  ]);
  // the frame stayed put — the drag was about the child, not its container
  expect([nodes[built.frame].x, nodes[built.frame].y]).toEqual([700, 0]);

  await removeNodes(page, [built.frame]);
});

test('a ⇧ marquee adds to the selection instead of replacing it', async ({ page }) => {
  const kept = await makeNode(page, 'rect', { name: 'Kept', x: 700, y: 500, w: 60, h: 60, fill: '#4CC3F0' });
  const swept = await makeNode(page, 'rect', { name: 'Swept', x: 700, y: 620, w: 60, h: 60, fill: '#F2637F' });
  await select(page, [kept]);

  // a marquee from empty canvas that covers Swept and nothing else. Kept sits
  // 120 world units above Swept, so a box that starts 20 above it cannot reach.
  const box = await page.locator(`[data-node-id="${swept}"]`).boundingBox();
  await dragBy(page, { x: box!.x + 20, y: box!.y + 120 }, { x: 60, y: -140 }, ['Shift']);

  const nodes = await doc(page);
  expect((await selection(page)).map((id) => nodes[id].name).sort()).toEqual(['Kept', 'Swept']);
  await removeNodes(page, [kept, swept]);
});

test('⏎ opens a selected text layer for editing', async ({ page }) => {
  const caption = await nodeNamed(page, 'Caption');
  await select(page, [caption!.id]);

  await page.keyboard.press('Enter');

  expect(await page.evaluate(() => window.paperlike!.ui.getState().editing)).toBe(caption!.id);
  // and the editor took the caret, as Figma does when you step into the words
  await expect(page.locator(`[data-node-id="${caption!.id}"][contenteditable]`)).toBeFocused();
  await page.keyboard.press('Escape');
});

/**
 * The digits set opacity. The editor's own comment named them as Figma's
 * opacity shortcut — as the reason the zoom keys need a modifier — and then
 * never handled them, so pressing 5 did nothing at all.
 */
test('the digit keys set opacity, and two in a row read as one number', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'Fader', x: 700, y: 500, w: 60, h: 60, fill: '#4CC3F0' });
  await select(page, [id]);
  const opacity = async () => (await doc(page))[id].opacity;

  await page.keyboard.press('5');
  expect(await opacity()).toBeCloseTo(0.5, 5);

  // 0 is 100%, not nothing
  await page.waitForTimeout(800);
  await page.keyboard.press('0');
  expect(await opacity()).toBeCloseTo(1, 5);

  // 4 then 5, straight after, is 45% — not 40% and then 50%
  await page.waitForTimeout(800);
  await page.keyboard.press('4');
  await page.keyboard.press('5');
  expect(await opacity()).toBeCloseTo(0.45, 5);

  // …and once the run has lapsed, a digit starts again
  await page.waitForTimeout(800);
  await page.keyboard.press('2');
  expect(await opacity()).toBeCloseTo(0.2, 5);

  await removeNodes(page, [id]);
});

/**
 * Figma splits the bracket keys: bare goes all the way, ⌘ steps one place. Only
 * the first pair existed, so a layer could be sent to the front or the back and
 * nowhere in between.
 */
test('⌘] and ⌘[ move a layer one place, not all the way', async ({ page }) => {
  const ids = await page.evaluate(() => {
    const store = window.paperlike!.store;
    const made = ['A', 'B', 'C', 'D'].map((name, i) =>
      store.create('rect', 'root', { name, x: 700 + i * 70, y: 500, w: 60, h: 60, fill: '#4CC3F0' } as never),
    );
    store.commit();
    return made;
  });
  const order = async () => {
    const nodes = await doc(page);
    return nodes.root.children.filter((id: string) => ids.includes(id)).map((id: string) => nodes[id].name);
  };
  expect(await order()).toEqual(['A', 'B', 'C', 'D']);

  await select(page, [ids[1]]);
  await page.keyboard.press('Meta+BracketRight');
  expect(await order()).toEqual(['A', 'C', 'B', 'D']);

  await page.keyboard.press('Meta+BracketLeft');
  expect(await order()).toEqual(['A', 'B', 'C', 'D']);

  // and the bare key still goes the whole way
  await page.keyboard.press('BracketRight');
  expect(await order()).toEqual(['A', 'C', 'D', 'B']);

  await removeNodes(page, ids);
});

/**
 * A marquee is measured against what is on screen, not against the numbers in
 * the document. Once you have drilled into a frame those numbers are local to
 * that frame while the marquee is in world coordinates, and comparing the two
 * selects whatever happens to overlap by coincidence.
 */
test('a marquee inside a frame you have drilled into catches the right layers', async ({ page }) => {
  const built = await page.evaluate(() => {
    const store = window.paperlike!.store;
    const outer = store.create('frame', 'root', {
      name: 'Outer', x: 700, y: 0, w: 400, h: 300, fill: '#FFFFFF', flex: null,
    } as never);
    const near = store.create('frame', outer, {
      name: 'Near', x: 20, y: 20, w: 60, h: 60, fill: '#4CC3F0', flex: null,
    } as never);
    const far = store.create('frame', outer, {
      name: 'Far', x: 20, y: 120, w: 60, h: 60, fill: '#F2637F', flex: null,
    } as never);
    store.commit();
    return { outer, near, far };
  });

  // double-click drills in: Near is selected and Outer is the level we are at
  await page.locator(`[data-node-id="${built.near}"]`).click();
  await page.locator(`[data-node-id="${built.near}"]`).dblclick();
  expect(await page.evaluate(() => window.paperlike!.ui.getState().entered)).toBe(built.outer);

  // ⇧ keeps that level while a marquee sweeps Far, whose stored x/y (20, 120)
  // are nothing like its world position
  const box = await page.locator(`[data-node-id="${built.far}"]`).boundingBox();
  await dragBy(page, { x: box!.x - 70, y: box!.y + 130 }, { x: 150, y: -140 }, ['Shift']);

  const nodes = await doc(page);
  expect((await selection(page)).map((id) => nodes[id].name).sort()).toEqual(['Far', 'Near']);
  await removeNodes(page, [built.outer]);
});

/**
 * The resize modifiers. Both are muscle memory rather than features: ⌥ holds the
 * centre, ⇧ holds the proportion, and between them they are most of what sizing
 * a layer by hand actually is.
 */
test.describe('resize modifiers', () => {
  /** Presses the handle sitting on one corner or edge of the selected layer. */
  const handleAt = async (page: import('@playwright/test').Page, id: string, cx: number, cy: number) => {
    const box = await page.locator(`[data-node-id="${id}"]`).boundingBox();
    return { x: box!.x + box!.width * cx, y: box!.y + box!.height * cy };
  };

  test('⌥ resizes about the centre, so the far edge moves too', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'AltSize', x: 700, y: 500, w: 100, h: 100, fill: '#4CC3F0' });
    await select(page, [id]);

    await dragBy(page, await handleAt(page, id, 1, 1), { x: 50, y: 0 }, ['Alt']);

    const after = (await doc(page))[id];
    // 50 to the right of the east edge, and 50 to the left of the west one
    expect([after.w, after.x]).toEqual([200, 650]);
    // the axis that was not dragged is untouched
    expect([after.h, after.y]).toEqual([100, 500]);
    await removeNodes(page, [id]);
  });

  test('⇧ keeps the proportion on an edge handle, not only a corner', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'EdgeRatio', x: 700, y: 500, w: 100, h: 50, fill: '#F2637F' });
    await select(page, [id]);

    await dragBy(page, await handleAt(page, id, 1, 0.5), { x: 50, y: 0 }, ['Shift']);

    const after = (await doc(page))[id];
    // 2:1 held: the height follows the width the edge handle never touches
    expect([after.w, after.h]).toEqual([150, 75]);
    expect([after.x, after.y]).toEqual([700, 500]);
    await removeNodes(page, [id]);
  });

  /**
   * The one that was actually broken: the anchor used to be worked out from the
   * un-ratioed size, so a ⇧-drag on a north or west handle scaled the box *and*
   * slid it. The corner you are not holding has to stay where it is.
   */
  test('⇧ on a corner keeps the opposite corner pinned', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'CornerRatio', x: 700, y: 500, w: 100, h: 50, fill: '#9B7BF0' });
    await select(page, [id]);

    await dragBy(page, await handleAt(page, id, 0, 0), { x: -40, y: 0 }, ['Shift']);

    const after = (await doc(page))[id];
    expect([after.w, after.h]).toEqual([140, 70]);
    // the south-east corner was at (800, 550) and is still there
    expect([after.x + after.w, after.y + after.h]).toEqual([800, 550]);
    await removeNodes(page, [id]);
  });
});

/**
 * The size readout is the only feedback during a draw, so it has to track the
 * pointer — a number that only appears on release is a number you cannot draw
 * to.
 */
test('the size readout counts up while a shape is being drawn', async ({ page }) => {
  await page.evaluate(() => window.paperlike!.ui.getState().setTool('rect'));
  const badge = page.locator('text=/^\\d+ × \\d+$/').first();

  await page.mouse.move(500, 600);
  await page.mouse.down();
  await page.mouse.move(560, 640);
  await expect(badge).toHaveText('60 × 40');
  await page.mouse.move(650, 700);
  await expect(badge).toHaveText('150 × 100');
  await page.mouse.up();

  const drawn = (await doc(page))[(await selection(page))[0]];
  expect([drawn.w, drawn.h]).toEqual([150, 100]);
  await removeNodes(page, [drawn.id]);
});

test('dragging snaps to a sibling edge', async ({ page }) => {
  const anchor = await makeNode(page, 'rect', { name: 'SnapAnchor', x: 40, y: 500, w: 120, h: 80, fill: '#4CC3F0' });
  const mover = await makeNode(page, 'rect', { name: 'SnapMover', x: 40, y: 620, w: 120, h: 80, fill: '#F2637F' });
  await select(page, [mover]);

  const box = await page.locator(`[data-node-id="${mover}"]`).boundingBox();
  const zoom = await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom);
  // 4 world px sideways is inside the snap threshold, so x should stick to the
  // anchor's edge; the 60px downward leg proves the drag actually happened.
  await dragBy(
    page,
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    { x: 4 * zoom, y: 60 * zoom },
  );

  const after = (await doc(page))[mover];
  expect(after.x).toBe(40);
  expect(after.y).toBeGreaterThan(660);
  await removeNodes(page, [anchor, mover]);
});

test('holding the snap-bypass modifier lets a drag land off the guide', async ({ page }) => {
  const anchor = await makeNode(page, 'rect', { name: 'FreeAnchor', x: 40, y: 500, w: 120, h: 80, fill: '#4CC3F0' });
  const mover = await makeNode(page, 'rect', { name: 'FreeMover', x: 40, y: 620, w: 120, h: 80, fill: '#F2637F' });
  await select(page, [mover]);

  const box = await page.locator(`[data-node-id="${mover}"]`).boundingBox();
  const zoom = await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom);
  await dragBy(
    page,
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    { x: 4 * zoom, y: 60 * zoom },
    ['Meta'],
  );

  expect((await doc(page))[mover].x).not.toBe(40);
  await removeNodes(page, [anchor, mover]);
});

test('undo restores a drag, and redo replays it', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'UndoProbe', x: 300, y: 500, w: 120, h: 80, fill: '#9B7BF0' });
  await select(page, [id]);

  const box = await page.locator(`[data-node-id="${id}"]`).boundingBox();
  await dragBy(page, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }, { x: 90, y: 0 });
  const moved = (await doc(page))[id].x;
  expect(moved).toBeGreaterThan(300);

  await page.evaluate(() => window.paperlike!.store.undo());
  await expect.poll(async () => (await doc(page))[id].x).toBe(300);

  await page.evaluate(() => window.paperlike!.store.redo());
  await expect.poll(async () => (await doc(page))[id].x).toBe(moved);
  await removeNodes(page, [id]);
});

test('a held structural shortcut fires once, not once per key repeat', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'RepeatProbe', x: 300, y: 620, w: 120, h: 80, fill: '#9B7BF0' });
  await select(page, [id]);
  const before = Object.keys(await doc(page)).length;

  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await select(page, [id]);
  await page.keyboard.down('Meta');
  for (let i = 0; i < 5; i++) await page.keyboard.down('d'); // auto-repeat, one press
  await page.keyboard.up('d');
  await page.keyboard.up('Meta');

  // exactly one duplicate — a held ⌘D used to make five
  await expect.poll(async () => Object.keys(await doc(page)).length).toBe(before + 1);
  const copies = Object.values(await doc(page)).filter((n) => n.name.startsWith('RepeatProbe'));
  await removeNodes(page, copies.map((n) => n.id));
});

test('a leaf set to hug keeps its size instead of collapsing', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'HugProbe', x: 40, y: 500, w: 140, h: 90, fill: '#BDEE63' });
  await page.evaluate((nodeId) => window.paperlike!.store.update(nodeId, { wMode: 'fit', hMode: 'fit' }), id);

  const box = await page.locator(`[data-node-id="${id}"]`).boundingBox();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
  await removeNodes(page, [id]);
});

test('copy and paste deep-copies with fresh ids', async ({ page }) => {
  const artboard = await nodeNamed(page, 'Fixture Board');
  const pasted = await page.evaluate((id) => {
    const store = window.paperlike!.store;
    return store.paste(store.serialize([id]), 'root', { x: 40, y: 40 });
  }, artboard!.id);

  expect(pasted).toHaveLength(1);
  const nodes = await doc(page);
  expect(pasted[0]).not.toBe(artboard!.id);
  expect(nodes[pasted[0]].children.length).toBe(artboard!.children.length);
  await removeNodes(page, pasted);
});

test('fill opacity does not dim the whole layer', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'AlphaProbe', x: 40, y: 500, w: 80, h: 80, fill: '#FF0000' });
  await page.evaluate((nodeId) => window.paperlike!.store.update(nodeId, { fillOpacity: 0.4 }), id);

  const element = page.locator(`[data-node-id="${id}"]`);
  await expect(element).toHaveCSS('background-color', 'rgba(255, 0, 0, 0.4)');
  await expect(element).toHaveCSS('opacity', '1');
  await removeNodes(page, [id]);
});

test('an instance follows its main until a property is overridden', async ({ page }) => {
  const main = await makeNode(page, 'frame', {
    name: 'TestButton', x: 40, y: 500, w: 140, h: 44, fill: '#111111', radius: 999,
  });
  await page.evaluate((id) => window.paperlike!.store.createComponent(id), main);
  const instance = await page.evaluate(
    (id) => window.paperlike!.store.createInstance(id, 'root', { x: 40, y: 600 }),
    main,
  );

  await page.evaluate((id) => window.paperlike!.store.update(id, { fill: '#0D99FF' }), main);
  await expect
    .poll(async () => (await doc(page))[instance!].fill)
    .toBe('#0D99FF');

  // pin the instance's fill, then change the main again
  await page.evaluate((id) => window.paperlike!.store.update(id, { fill: '#00CC44' }), instance!);
  await page.evaluate((id) => window.paperlike!.store.update(id, { fill: '#FF00FF' }), main);
  await page.waitForTimeout(400);
  expect((await doc(page))[instance!].fill).toBe('#00CC44');

  await removeNodes(page, [main, instance!]);
});

test('constraints reposition children when their frame resizes', async ({ page }) => {
  const frame = await makeNode(page, 'frame', {
    name: 'ConstraintFrame', x: 40, y: 500, w: 400, h: 200, fill: '#FFFFFF', flex: null,
  });
  const pinnedRight = await page.evaluate(
    (parent) =>
      window.paperlike!.store.create('rect', parent, {
        name: 'PinnedRight', x: 330, y: 10, w: 60, h: 40, fill: '#DDDDDD',
        constraints: { h: 'end', v: 'start' },
      }),
    frame,
  );

  await page.evaluate((id) => window.paperlike!.store.update(id, { w: 600 }), frame);
  await page.waitForTimeout(200);

  // 10px from the right edge before and after
  expect((await doc(page))[pinnedRight].x).toBe(530);
  await removeNodes(page, [frame]);
});

test('export produces React, HTML and JSON', async ({ page }) => {
  const artboard = await nodeNamed(page, 'Fixture Board');
  await select(page, [artboard!.id]);

  for (const [format, needle] of [
    ['react', 'export function'],
    ['html', '<!doctype html>'],
    ['json', '"type"'],
  ] as const) {
    await page.evaluate((f) => {
      window.paperlike!.ui.getState().setExportFormat(f);
      window.paperlike!.ui.getState().setExportOpen(true);
    }, format);
    await expect(page.locator('pre')).toContainText(needle);
    await page.evaluate(() => window.paperlike!.ui.getState().setExportOpen(false));
  }
});

test('a shader surface exports as real pixels, not a blank rectangle', async ({ page }) => {
  const id = await makeNode(page, 'shader', {
    name: 'ShaderProbe', x: 40, y: 500, w: 200, h: 200,
    shader: { id: 'dither', params: {} },
  });
  await select(page, [id]);
  await page.evaluate(() => {
    window.paperlike!.ui.getState().setExportFormat('svg');
    window.paperlike!.ui.getState().setExportOpen(true);
  });

  const preview = page.locator('img[alt="Export preview"]');
  await expect(preview).toBeVisible();

  // The GL contexts no longer preserve their drawing buffer, so export has to
  // redraw and read them in one synchronous pass. If that ever breaks, the
  // embedded snapshot goes blank — which is exactly one flat colour.
  const colours = await page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>('img[alt="Export preview"]')!;
    const svg = decodeURIComponent(img.src.slice(img.src.indexOf(',') + 1));
    const match = svg.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/);
    if (!match) return -1;

    const bitmap = new Image();
    bitmap.src = match[0];
    await bitmap.decode();
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.naturalWidth;
    canvas.height = bitmap.naturalHeight;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);

    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return seen.size;
  });

  expect(colours).toBeGreaterThan(1);
  await page.evaluate(() => window.paperlike!.ui.getState().setExportOpen(false));
  await removeNodes(page, [id]);
});

/**
 * A shader is a paint, not a node type.
 *
 * The fill picker has always offered Shader, but the surface only ever rendered
 * on a layer whose *type* was `shader` — so choosing it on a rectangle wrote the
 * property and painted nothing. These two hold the line: any layer may carry a
 * shader, and on a shape it fills the shape rather than the box around it.
 */
test('a shader chosen as a fill paints the layer that chose it', async ({ page }) => {
  const id = await makeNode(page, 'rect', {
    name: 'ShadedRect', x: 40, y: 500, w: 200, h: 200, fill: '#D9D9D9',
  });
  await select(page, [id]);
  await page.locator('.fig-paint .fig-swatch').first().click();
  await expect(page.getByTestId('paint-picker')).toBeVisible();
  await page.locator('.fig-picker-type[title="Shader"] input').click({ force: true });

  const surface = page.locator(`[data-node-id="${id}"] canvas`);
  await expect(surface).toBeVisible();
  expect((await surface.boundingBox())!.width).toBeGreaterThan(0);

  // and the parameters are editable on this layer, not only on a shader node
  await page.keyboard.press('Escape');
  await expect(page.getByTitle('Browse shaders').first()).toBeVisible();
  await removeNodes(page, [id]);
});

test('a shader fills the shape, not the box the shape sits in', async ({ page }) => {
  const id = await makeNode(page, 'star', {
    name: 'ShadedStar', x: 40, y: 500, w: 200, h: 200, sides: 5,
    shader: { id: 'mesh', params: {} },
  });
  await select(page, [id]);
  const surface = page.locator(`[data-node-id="${id}"] canvas`);
  await expect(surface).toBeVisible();

  // the surface sits inside the clipped layer — that clip is what makes the
  // shader a star instead of a square with a star drawn near it
  const clip = await page.evaluate((nodeId) => {
    const canvas = document.querySelector(`[data-node-id="${nodeId}"] canvas`)!;
    return getComputedStyle(canvas.parentElement!).clipPath;
  }, id);
  expect(clip).toContain('path(');
  await removeNodes(page, [id]);
});

/**
 * Panel resizing.
 *
 * The handle carries no layout width of its own — the grab area is a
 * pseudo-element over the panel's border — so these drive it by coordinate
 * rather than by element box, which is also how a user reaches it.
 */
async function grabHandle(page: import('@playwright/test').Page, side: 'left' | 'right') {
  const box = await page.locator(`.fig-resizer[data-side="${side}"]`).boundingBox();
  // the grab area straddles the border, biased towards the canvas
  return { x: box!.x + (side === 'left' ? 2 : -2), y: box!.y + box!.height / 2 };
}

const panelWidth = (page: import('@playwright/test').Page, selector: string) =>
  page.locator(selector).evaluate((el) => el.getBoundingClientRect().width);

test('dragging the handle widens the right panel', async ({ page }) => {
  const before = await panelWidth(page, '.fig');
  await dragBy(page, await grabHandle(page, 'right'), { x: -120, y: 0 });

  expect(await panelWidth(page, '.fig')).toBeCloseTo(before + 120, 0);
});

test('dragging the handle widens the left panel', async ({ page }) => {
  const before = await panelWidth(page, '.fig-left');
  await dragBy(page, await grabHandle(page, 'left'), { x: 60, y: 0 });

  expect(await panelWidth(page, '.fig-left')).toBeCloseTo(before + 60, 0);
});

test('a panel stops at its maximum however far you drag', async ({ page }) => {
  await dragBy(page, await grabHandle(page, 'right'), { x: -900, y: 0 });

  const width = await panelWidth(page, '.fig');
  expect(width).toBe(640);
  // and the canvas is still there to draw on
  const canvas = await panelWidth(page, '.fig-shell > div:nth-of-type(1)');
  expect(canvas).toBeGreaterThanOrEqual(240);
});

test('double-clicking the handle restores the default width', async ({ page }) => {
  await dragBy(page, await grabHandle(page, 'right'), { x: -120, y: 0 });
  expect(await panelWidth(page, '.fig')).toBeGreaterThan(400);

  const handle = await grabHandle(page, 'right');
  await page.mouse.dblclick(handle.x, handle.y);
  expect(await panelWidth(page, '.fig')).toBe(355);
});

test('a resized panel survives a reload', async ({ page }) => {
  await dragBy(page, await grabHandle(page, 'right'), { x: -140, y: 0 });
  const resized = await panelWidth(page, '.fig');

  await page.reload();
  await page.waitForFunction(() => !!window.paperlike);

  expect(await panelWidth(page, '.fig')).toBe(resized);
  // leave the next run a clean slate
  await page.evaluate(() => window.paperlike!.ui.getState().resetRightWidth());
});

test('the arrow keys resize a focused handle', async ({ page }) => {
  const before = await panelWidth(page, '.fig');
  await page.locator('.fig-resizer[data-side="right"]').focus();
  await page.keyboard.press('ArrowLeft');

  expect(await panelWidth(page, '.fig')).toBe(before + 16);
  await page.evaluate(() => window.paperlike!.ui.getState().resetRightWidth());
});

test('the fill row matches Figma: one field holding swatch, hex and opacity', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'FillProbe', x: 40, y: 500, w: 200, h: 120, fill: '#d9d9d9' });
  await select(page, [id]);

  const field = page.locator('.fig-paint').first();
  await expect(field).toBeVisible();

  // hex is uppercase and unprefixed, opacity is a bare number with a % handle
  await expect(field.locator('input[aria-label="Color"]')).toHaveValue('D9D9D9');
  await expect(field.locator('input[aria-label="Opacity"]')).toHaveValue('100');
  await expect(field.locator('.fig-paint-percent')).toHaveText('%');
  // swatch, hex and opacity share one bordered field rather than sitting in two
  await expect(field.locator('.fig-swatch')).toHaveCount(1);

  // the row's own controls: a real checkbox for visibility, and a minus
  const row = page.locator('.fig-paint').first().locator('..');
  await expect(row.locator('input[type="checkbox"][aria-label="Toggle visibility"]')).toHaveCount(1);
  await expect(row.locator('button[title="Remove"]')).toHaveCount(1);

  await removeNodes(page, [id]);
});

test('the styles-and-variables dialog opens outside the inspector', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'TokenProbe', x: 40, y: 500, w: 200, h: 120, fill: '#d9d9d9' });
  await select(page, [id]);
  await page.evaluate(() =>
    window.paperlike!.store.addToken({ name: 'brand', type: 'color', value: '#BDEE63' }),
  );

  await page.locator('button[title="Fill, apply styles and variables"]').first().click({ force: true });

  // The inspector scrolls, so a menu positioned inside it gets clipped. Figma
  // opens this one beside the panel; anything overlapping the panel is a bug.
  const placement = await page.evaluate(() => {
    const menu = [...document.body.querySelectorAll('div')].find(
      (d) => getComputedStyle(d).position === 'fixed' && getComputedStyle(d).zIndex === '90',
    );
    if (!menu) return null;
    const panel = document.querySelector('.fig')!.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    return { insideBody: menu.parentElement === document.body, right: box.right, panelLeft: panel.left };
  });

  expect(placement).not.toBeNull();
  expect(placement!.insideBody).toBe(true);
  expect(placement!.right).toBeLessThanOrEqual(placement!.panelLeft);

  await removeNodes(page, [id]);
});

test('one malformed token does not take the panel down', async ({ page }) => {
  // tokens arrive from other clients and from MCP, so listTokens must survive
  // a record that never went through addToken
  const count = await page.evaluate(() => {
    const store = window.paperlike!.store;
    store.ydoc.getMap('tokens').set('broken', { id: 'broken', type: 'color', value: '#000' });
    const listed = store.listTokens().length;
    store.removeToken('broken');
    return listed;
  });
  expect(count).toBeGreaterThanOrEqual(0);
  await expect(page.locator('.fig-layer').first()).toBeVisible();
});

test.describe('paint picker', () => {
  const openPicker = async (page: import('@playwright/test').Page) => {
    await page.locator('.fig-paint .fig-swatch').first().click();
    await expect(page.getByTestId('paint-picker')).toBeVisible();
  };

  test('opens beside the panel with Figma\'s controls', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'PickMe', x: 40, y: 500, w: 200, h: 120, fill: '#D9D9D9' });
    await select(page, [id]);
    await openPicker(page);

    const dialog = page.getByTestId('paint-picker');
    await expect(dialog.getByRole('tab')).toHaveText(['Custom', 'Libraries']);
    await expect(dialog.locator('.fig-picker-type')).toHaveCount(6);
    await expect(dialog.getByRole('slider', { name: 'Hue' })).toBeVisible();
    await expect(dialog.getByRole('slider', { name: 'Opacity' })).toBeVisible();
    await expect(dialog.locator('input[aria-label="Color"]')).toHaveValue('D9D9D9');

    // beside the inspector, and fully on screen
    const geometry = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="paint-picker"]')!.getBoundingClientRect();
      const panel = document.querySelector('.fig-shell .fig')!.getBoundingClientRect();
      return { right: box.right, bottom: box.bottom, panelLeft: panel.left, viewport: window.innerHeight };
    });
    expect(geometry.right).toBeLessThanOrEqual(geometry.panelLeft);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport);

    await removeNodes(page, [id]);
  });

  test('dragging the spectrum writes the colour through to the layer', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'PickMe', x: 40, y: 500, w: 200, h: 120, fill: '#D9D9D9' });
    await select(page, [id]);
    await openPicker(page);

    const surface = await page.locator('.fig-picker-surface').boundingBox();
    await dragBy(page, { x: surface!.x + 20, y: surface!.y + 20 }, { x: 150, y: 40 });

    const fill = (await doc(page))[id].fill!;
    expect(fill).toMatch(/^#[0-9A-F]{6}$/);
    expect(fill).not.toBe('#D9D9D9');
    await removeNodes(page, [id]);
  });

  test('the six paint types are exclusive', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'PickMe', x: 40, y: 500, w: 200, h: 120, fill: '#D9D9D9' });
    await select(page, [id]);
    await openPicker(page);

    const pick = async (label: string) => {
      await page.locator(`.fig-picker-type[title="${label}"] input`).click({ force: true });
      await expect(page.locator('.fig-picker-type[data-on="true"]')).toHaveAttribute('title', label);
      return (await doc(page))[id];
    };

    expect((await pick('Gradient')).fill).toContain('linear-gradient');
    expect((await pick('Pattern')).fill).toContain('repeating-linear-gradient');
    expect((await pick('Image')).fill).toMatch(/^url\(/);

    // shader and video are layer properties, and setting one clears the other
    const shaded = await pick('Shader');
    expect(shaded.shader).toBeTruthy();
    const filmed = await pick('Video');
    expect(filmed.video).toBeTruthy();
    expect(filmed.shader).toBeFalsy();
    const solid = await pick('Solid');
    expect(solid.fill).toBe('#D9D9D9');
    expect(solid.video).toBeFalsy();

    await removeNodes(page, [id]);
  });

  test('each type swaps the body below the tabs for its own controls', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'PickMe', x: 40, y: 500, w: 200, h: 120, fill: '#D9D9D9' });
    await select(page, [id]);
    await openPicker(page);
    const picker = page.getByTestId('paint-picker');

    const pick = (label: string) =>
      page.locator(`.fig-picker-type[title="${label}"] input`).click({ force: true });

    // Solid: the spectrum, and nothing that belongs to another type
    await expect(picker.locator('.fig-picker-spectrum')).toBeVisible();
    await expect(picker.locator('.fig-picker-ramp')).toBeHidden();

    await pick('Gradient');
    await expect(picker.locator('.fig-picker-ramp')).toBeVisible();
    await expect(picker.getByRole('combobox', { name: 'Gradient type' })).toBeVisible();
    // the stops keep the spectrum, because a stop is still a colour
    await expect(picker.locator('.fig-picker-spectrum')).toBeVisible();

    await pick('Pattern');
    await expect(picker.getByLabel('Stripe width')).toBeVisible();
    await expect(picker.locator('.fig-picker-ramp')).toBeHidden();

    await pick('Image');
    await expect(picker.locator('.fig-picker-image-preview')).toBeVisible();
    await expect(picker.getByLabel('Image URL')).toBeVisible();
    // an image has no colour to spectrum
    await expect(picker.locator('.fig-picker-spectrum')).toBeHidden();

    await pick('Video');
    await expect(picker.getByPlaceholder('https://…/clip.mp4')).toBeVisible();

    await pick('Shader');
    await expect(picker.locator('.fig-picker-body').getByTitle('Shader')).toBeVisible();

    await pick('Solid');
    await expect(picker.locator('.fig-picker-spectrum')).toBeVisible();
    await removeNodes(page, [id]);
  });

  test('the gradient ramp adds, moves and removes a stop', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'PickMe', x: 40, y: 500, w: 200, h: 120, fill: '#D9D9D9' });
    await select(page, [id]);
    await openPicker(page);
    await page.locator('.fig-picker-type[title="Gradient"] input').click({ force: true });
    const picker = page.getByTestId('paint-picker');

    await expect(picker.locator('.fig-picker-ramp-stop')).toHaveCount(2);
    await picker.getByTitle('Add a stop').click();
    await expect(picker.locator('.fig-picker-ramp-stop')).toHaveCount(3);

    // the new stop sits between the two it was added from
    const stops = (await doc(page))[id].fill!.match(/(\d+)%/g)!;
    expect(stops).toEqual(['0%', '50%', '100%']);

    await picker.getByTitle('Remove this stop').click();
    await expect(picker.locator('.fig-picker-ramp-stop')).toHaveCount(2);
    await removeNodes(page, [id]);
  });

  test('the gradient type dropdown rewrites the paint, keeping its stops', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'PickMe', x: 40, y: 500, w: 200, h: 120, fill: '#D9D9D9' });
    await select(page, [id]);
    await openPicker(page);
    await page.locator('.fig-picker-type[title="Gradient"] input').click({ force: true });

    await page.getByRole('combobox', { name: 'Gradient type' }).click();
    await page.getByRole('option', { name: 'Angular' }).click();

    const fill = (await doc(page))[id].fill!;
    expect(fill).toContain('conic-gradient');
    expect(fill).toContain('#DDDDDD');
    expect(fill).toContain('#A4A4A4');
    await removeNodes(page, [id]);
  });

  test('the contrast button reports a ratio against what the layer sits on', async ({ page }) => {
    const board = await nodeNamed(page, 'Fixture Board');
    const id = await page.evaluate((parent) => {
      const store = window.paperlike!.store;
      const made = store.create('rect', parent, {
        name: 'Contrasty', x: 40, y: 40, w: 200, h: 120, fill: '#767676',
      });
      store.commit();
      return made;
    }, board!.id);
    await select(page, [id]);
    await openPicker(page);
    const picker = page.getByTestId('paint-picker');

    await picker.getByLabel('Check color contrast').click();
    // #767676 on the board's white is 4.54:1 — the AA threshold, and no more
    await expect(picker.getByLabel(/^Contrast ratio 4\.5/)).toBeVisible();
    await expect(picker.locator('.fig-picker-grade[data-pass]', { hasText: 'AA' }).first()).toBeVisible();
    await expect(picker.locator('.fig-picker-grade', { hasText: 'AAA' }).first()).not.toHaveAttribute('data-pass', '');

    // it used to toggle the colour format instead of checking anything
    await expect(picker.getByRole('combobox', { name: 'Color format' })).toHaveText(/Hex/);
    await removeNodes(page, [id]);
  });

  test('both blend menus offer the same modes, and the panel one is not clipped', async ({ page }) => {
    const cover = await nodeNamed(page, 'Cover');
    await select(page, [cover!.id]);

    await page.getByRole('button', { name: /Apply blend mode/ }).click();
    const list = page.getByRole('listbox', { name: 'Blend mode' });
    await expect(list.getByRole('option')).toHaveCount(18);

    // the inspector scrolls, so a menu positioned inside it would be cut off
    const panel = (await page.locator('.fig').first().boundingBox())!;
    const menu = (await list.boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(panel.x + panel.width + 1);

    await page.getByRole('option', { name: 'Plus lighter' }).click();
    expect((await doc(page))[cover!.id].blend).toBe('plus-lighter');
  });

  test('the format dropdown round-trips a typed value', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'PickMe', x: 40, y: 500, w: 200, h: 120, fill: '#D9D9D9' });
    await select(page, [id]);
    await openPicker(page);

    await page.getByRole('combobox', { name: 'Color format' }).click();
    await page.getByRole('option', { name: 'RGB' }).click();
    await expect(page.getByTestId('paint-picker').locator('input[aria-label="Color"]')).toHaveValue('217, 217, 217');

    const input = page.getByTestId('paint-picker').locator('input[aria-label="Color"]');
    await input.fill('0, 128, 255');
    await input.press('Enter');

    await expect.poll(async () => (await doc(page))[id].fill).toBe('#0080FF');
    await removeNodes(page, [id]);
  });

  test('the Libraries tab applies a variable', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'PickMe', x: 40, y: 500, w: 200, h: 120, fill: '#D9D9D9' });
    await select(page, [id]);
    await page.evaluate(() =>
      window.paperlike!.store.addToken({ name: 'picked', type: 'color', value: '#BDEE63' }),
    );
    await openPicker(page);

    await page.getByRole('tab', { name: 'Libraries' }).click();
    await page.getByTestId('paint-picker').getByRole('button', { name: 'picked' }).click();

    await expect.poll(async () => (await doc(page))[id].fill).toBe('var(--picked)');
    // picking a variable closes the dialog, as choosing a style does in Figma
    await expect(page.getByTestId('paint-picker')).toHaveCount(0);
    await removeNodes(page, [id]);
  });

  test('"On this page" offers the colours already used', async ({ page }) => {
    const other = await makeNode(page, 'rect', { name: 'Neighbour', x: 300, y: 500, w: 80, h: 80, fill: '#4CC3F0' });
    const id = await makeNode(page, 'rect', { name: 'PickMe', x: 40, y: 500, w: 200, h: 120, fill: '#D9D9D9' });
    await select(page, [id]);
    await openPicker(page);

    const chits = page.locator('.fig-picker-chit');
    await expect(chits).toHaveCount(await chits.count());
    await page.locator('.fig-picker-chit[title="#4CC3F0"]').click();

    await expect.poll(async () => (await doc(page))[id].fill).toBe('#4CC3F0');
    await removeNodes(page, [id, other]);
  });

  test('opens on the colour a layer actually has, not a fallback', async ({ page }) => {
    await page.evaluate(() =>
      window.paperlike!.store.addToken({ name: 'ink', type: 'color', value: '#111111' }),
    );

    // a fill is not always a hex — it can be a variable, an rgb() or a name,
    // and starting the spectrum from grey silently replaced the real colour
    for (const [fill, expected] of [
      ['var(--ink)', '111111'],
      ['rgb(0, 128, 255)', '0080FF'],
      ['rebeccapurple', '663399'],
      ['#BDEE63', 'BDEE63'],
    ] as const) {
      const id = await makeNode(page, 'rect', { name: 'Resolve', x: 40, y: 500, w: 200, h: 120, fill });
      await select(page, [id]);
      await openPicker(page);

      await expect(page.getByTestId('paint-picker').locator('input[aria-label="Color"]')).toHaveValue(expected);

      await page.keyboard.press('Escape');
      await removeNodes(page, [id]);
    }
  });

  test('editing a gradient changes one stop, not the whole paint', async ({ page }) => {
    const gradient = 'linear-gradient(180deg, #DDDDDD 0%, #A4A4A4 100%)';
    const id = await makeNode(page, 'rect', { name: 'Grad', x: 40, y: 500, w: 200, h: 120, fill: gradient });
    await select(page, [id]);
    await openPicker(page);

    const stops = page.locator('.fig-picker-stop');
    await expect(stops).toHaveCount(2);
    await expect(page.getByTestId('paint-picker').locator('input[aria-label="Color"]')).toHaveValue('DDDDDD');

    // dragging the spectrum used to replace the entire gradient with a flat colour
    const surface = await page.locator('.fig-picker-surface').boundingBox();
    await dragBy(page, { x: surface!.x + 40, y: surface!.y + 40 }, { x: 110, y: 50 });

    const afterFirst = (await doc(page))[id].fill!;
    expect(afterFirst).toMatch(/^linear-gradient\(180deg, #[0-9A-F]{6} 0%, #A4A4A4 100%\)$/);

    // the second stop edits independently
    await stops.nth(1).click();
    await expect(page.getByTestId('paint-picker').locator('input[aria-label="Color"]')).toHaveValue('A4A4A4');
    await dragBy(page, { x: surface!.x + 180, y: surface!.y + 20 }, { x: 10, y: 5 });

    const afterSecond = (await doc(page))[id].fill!;
    expect(afterSecond).toMatch(/^linear-gradient\(180deg, #[0-9A-F]{6} 0%, #[0-9A-F]{6} 100%\)$/);
    expect(afterSecond).not.toBe(afterFirst);

    await page.keyboard.press('Escape');
    await removeNodes(page, [id]);
  });

  test('Escape closes the picker', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'PickMe', x: 40, y: 500, w: 200, h: 120, fill: '#D9D9D9' });
    await select(page, [id]);
    await openPicker(page);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('paint-picker')).toHaveCount(0);
    // and the layer is still selected: Escape closed the dialog, not the selection
    expect(await selection(page)).toEqual([id]);
    await removeNodes(page, [id]);
  });
});

/**
 * The layers panel, measured against Figma: front-most first, containers
 * collapsed until you open them or the selection reaches inside, list-style
 * range selection, and a drag that reorders, reparents and carries a whole
 * multi-selection.
 */
test.describe('layers panel', () => {
  const ROW = '.fig-layer[data-layer-id]';

  /** Row names, top to bottom — what the panel actually shows. */
  async function rows(page: import('@playwright/test').Page): Promise<string[]> {
    const ids = await page
      .locator(ROW)
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.layerId!));
    const nodes = await doc(page);
    return ids.map((id) => nodes[id]?.name ?? id);
  }

  const row = (page: import('@playwright/test').Page, id: string) =>
    page.locator(`${ROW}[data-layer-id="${id}"]`);

  /** Opens a container the way a user does, rather than reaching into the store. */
  async function expand(page: import('@playwright/test').Page, id: string): Promise<void> {
    await row(page, id).locator('button').first().click();
  }

  test('lists the front-most layer first', async ({ page }) => {
    const back = await makeNode(page, 'rect', { name: 'Back', x: 700, y: 0, w: 60, h: 60 });
    const front = await makeNode(page, 'rect', { name: 'Front', x: 780, y: 0, w: 60, h: 60 });

    expect(await rows(page)).toEqual(['Front', 'Back', 'Fixture Board']);
    // document order is the opposite of the panel: the last child paints on top
    expect((await doc(page)).root.children).toEqual([
      (await nodeNamed(page, 'Fixture Board'))!.id,
      back,
      front,
    ]);
  });

  test('containers ship collapsed and the chevron opens them', async ({ page }) => {
    const board = (await nodeNamed(page, 'Fixture Board'))!.id;
    expect(await rows(page)).toEqual(['Fixture Board']);

    await expand(page, board);
    expect(await rows(page)).toEqual(['Fixture Board', 'Caption', 'Cover']);
  });

  test('selecting on the canvas opens the layer it is buried in', async ({ page }) => {
    const cover = (await nodeNamed(page, 'Cover'))!.id;
    await expect(row(page, cover)).toHaveCount(0);

    await select(page, [cover]);
    await expect(row(page, cover)).toBeVisible();
  });

  test('shift-click takes the range, ⌘-click toggles one row', async ({ page }) => {
    const board = (await nodeNamed(page, 'Fixture Board'))!.id;
    await expand(page, board);
    const caption = (await nodeNamed(page, 'Caption'))!.id;
    const cover = (await nodeNamed(page, 'Cover'))!.id;

    await row(page, board).click();
    await row(page, cover).click({ modifiers: ['Shift'] });
    expect((await selection(page)).sort()).toEqual([board, caption, cover].sort());

    await row(page, caption).click({ modifiers: ['ControlOrMeta'] });
    expect((await selection(page)).sort()).toEqual([board, cover].sort());
  });

  test('dragging a row above another restacks it', async ({ page }) => {
    const back = await makeNode(page, 'rect', { name: 'Back', x: 700, y: 0, w: 60, h: 60 });
    await makeNode(page, 'rect', { name: 'Front', x: 780, y: 0, w: 60, h: 60 });

    const box = (await row(page, back).boundingBox())!;
    // up one row and a little further, so the pointer lands in the top quarter
    // of the row above — the band that means "drop above this"
    await dragBy(
      page,
      { x: box.x + 90, y: box.y + box.height / 2 },
      { x: 0, y: -box.height - box.height / 4 },
    );

    expect(await rows(page)).toEqual(['Back', 'Front', 'Fixture Board']);
    expect((await doc(page)).root.children.at(-1)).toBe(back);
  });

  test('dropping a row onto a frame moves it inside', async ({ page }) => {
    const board = (await nodeNamed(page, 'Fixture Board'))!.id;
    const loose = await makeNode(page, 'rect', { name: 'Loose', x: 700, y: 0, w: 60, h: 60 });

    const from = (await row(page, loose).boundingBox())!;
    const onto = (await row(page, board).boundingBox())!;
    await dragBy(
      page,
      { x: from.x + 90, y: from.y + from.height / 2 },
      { x: 0, y: onto.y + onto.height / 2 - (from.y + from.height / 2) },
    );

    expect((await doc(page))[loose].parent).toBe(board);
    // and the frame it landed in is open, so the layer is where you dropped it
    await expect(row(page, loose)).toBeVisible();
  });

  test('a drag carries the whole selection', async ({ page }) => {
    const board = (await nodeNamed(page, 'Fixture Board'))!.id;
    const a = await makeNode(page, 'rect', { name: 'A', x: 700, y: 0, w: 60, h: 60 });
    const b = await makeNode(page, 'rect', { name: 'B', x: 780, y: 0, w: 60, h: 60 });
    await select(page, [a, b]);

    const from = (await row(page, b).boundingBox())!;
    const onto = (await row(page, board).boundingBox())!;
    await dragBy(
      page,
      { x: from.x + 90, y: from.y + from.height / 2 },
      { x: 0, y: onto.y + onto.height / 2 - (from.y + from.height / 2) },
    );

    const nodes = await doc(page);
    expect([nodes[a].parent, nodes[b].parent]).toEqual([board, board]);
    // B was in front of A and still is
    expect(nodes[board].children.indexOf(a)).toBeLessThan(nodes[board].children.indexOf(b));
  });

  test('pressing a row inside a multi-selection keeps it until you release', async ({ page }) => {
    const a = await makeNode(page, 'rect', { name: 'A', x: 700, y: 0, w: 60, h: 60 });
    const b = await makeNode(page, 'rect', { name: 'B', x: 780, y: 0, w: 60, h: 60 });
    await select(page, [a, b]);

    const box = (await row(page, b).boundingBox())!;
    await page.mouse.move(box.x + 90, box.y + box.height / 2);
    await page.mouse.down();
    expect((await selection(page)).sort()).toEqual([a, b].sort());

    // released without moving, it narrows to the row pressed
    await page.mouse.up();
    expect(await selection(page)).toEqual([b]);
  });
});

/**
 * Prototyping: interactions on a layer, the connections drawn for them, and the
 * player that acts on them. The tests drive the panel and the canvas rather
 * than the store wherever a user would, because the wiring between the three is
 * the part that breaks.
 */
test.describe('prototype', () => {
  const openTab = (page: import('@playwright/test').Page) =>
    page.locator('.fig-tab', { hasText: 'Prototype' }).click();

  /** A second artboard to navigate to, plus the hotspot that goes there. */
  async function scene(page: import('@playwright/test').Page) {
    const board = (await nodeNamed(page, 'Fixture Board'))!.id;
    const second = await makeNode(page, 'frame', {
      name: 'Second', x: 700, y: 0, w: 600, h: 400, fill: '#FFF7E6', flex: null,
    });
    const button = (await nodeNamed(page, 'Cover'))!.id;
    return { board, second, button };
  }

  test('the panel gives a layer an interaction, and the canvas draws it', async ({ page }) => {
    const { second, button } = await scene(page);
    await select(page, [button]);
    await openTab(page);

    await page.locator('button[title="Add interactions"]').click();
    await page.locator('.fig-interaction-summary').click();
    let node = (await doc(page))[button];
    expect(node.interactions).toHaveLength(1);
    expect(node.interactions![0].trigger).toBe('click');

    // point it at the second frame through the panel's own control
    await page.locator('.fig-interaction button', { hasText: 'Pick a frame' }).click();
    await page.getByRole('listbox').getByRole('option', { name: 'Second' }).click();

    node = (await doc(page))[button];
    expect(node.interactions![0].destination).toBe(second);
    // and the connection is on the canvas
    await expect(page.locator('svg path[marker-end]')).toHaveCount(1);
  });

  test('dragging the handle onto a frame connects them', async ({ page }) => {
    const { second, button } = await scene(page);
    await select(page, [button]);
    await openTab(page);

    const handle = page.locator('.fig-proto-handle');
    await expect(handle).toBeVisible();
    const from = (await handle.boundingBox())!;
    const onto = (await page.locator(`[data-node-id="${second}"]`).boundingBox())!;
    // near the frame's corner, not its centre: the centre of a wide artboard
    // sits under the right panel at this viewport
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    await dragBy(page, start, { x: onto.x + 40 - start.x, y: onto.y + 40 - start.y });

    const node = (await doc(page))[button];
    expect(node.interactions).toHaveLength(1);
    expect(node.interactions![0].destination).toBe(second);
    expect(node.interactions![0].action).toBe('navigate');
  });

  test('a flow starting point badges the frame and plays it', async ({ page }) => {
    const { board } = await scene(page);
    await select(page, [board]);
    await openTab(page);

    await page.locator('.fig-flow-badge', { hasText: 'Flow' }).click();
    expect((await doc(page))[board].flowStart).toBe('Flow 1');

    await page.locator('.fig-flow-badge', { hasText: 'Flow 1' }).click();
    await expect(page.locator('.fig-present')).toBeVisible();
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', board);
  });

  test('clicking a hotspot navigates, and back returns', async ({ page }) => {
    const { board, second, button } = await scene(page);
    await page.evaluate(
      ([id, dest]) => {
        window.paperlike!.store.addInteraction(id, { action: 'navigate', destination: dest });
        window.paperlike!.store.commit();
      },
      [button, second] as const,
    );

    await page.evaluate((id) => window.paperlike!.ui.getState().present(id), board);
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', board);

    await page.locator(`.fig-present [data-node-id="${button}"]`).click();
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', second);

    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', board);
  });

  test('an after-delay interaction advances on its own', async ({ page }) => {
    const { board, second, button } = await scene(page);
    await page.evaluate(
      ([id, dest]) => {
        window.paperlike!.store.addInteraction(id, {
          trigger: 'delay',
          delay: 150,
          action: 'navigate',
          destination: dest,
        });
        window.paperlike!.store.commit();
      },
      [button, second] as const,
    );

    await page.evaluate((id) => window.paperlike!.ui.getState().present(id), board);
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', second);
  });

  test('clicking dead space flashes the hotspots', async ({ page }) => {
    const { board, second, button } = await scene(page);
    await page.evaluate(
      ([id, dest]) => {
        window.paperlike!.store.addInteraction(id, { action: 'navigate', destination: dest });
        window.paperlike!.store.commit();
      },
      [button, second] as const,
    );
    await page.evaluate((id) => window.paperlike!.ui.getState().present(id), board);

    // the frame's own background is not a hotspot, so a press there hints
    await page.locator('.fig-present-stage').click({ position: { x: 8, y: 8 } });
    await expect(page.locator('.fig-hotspot')).toHaveCount(1);
  });

  test('a frame away from the origin plays back in place', async ({ page }) => {
    const { second } = await scene(page);
    const heading = await page.evaluate((frame) => {
      const store = window.paperlike!.store;
      const id = store.create('text', frame, {
        name: 'Heading', x: 40, y: 40, w: 200, h: 30, text: 'Second screen',
      });
      store.commit();
      return id;
    }, second);

    await page.evaluate((id) => window.paperlike!.ui.getState().present(id), second);
    const screen = (await page.locator('.fig-present-screen').boundingBox())!;
    const child = (await page.locator(`.fig-present [data-node-id="${heading}"]`).boundingBox())!;

    // the artboard's world position must not leak into playback: the heading
    // sits 40px inside the screen, not 740px off the side of it
    expect(child.x - screen.x).toBeGreaterThan(20);
    expect(child.x - screen.x).toBeLessThan(80);
    expect(child.y - screen.y).toBeGreaterThan(20);
  });

  test('Escape closes the player and leaves the document alone', async ({ page }) => {
    const { board } = await scene(page);
    await page.evaluate((id) => window.paperlike!.ui.getState().present(id), board);
    await expect(page.locator('.fig-present')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.fig-present')).toHaveCount(0);
    expect(await nodeNamed(page, 'Fixture Board')).toBeTruthy();
  });
});

/* ── right-click menu ───────────────────────────────────────────────────
   Every row is driven through the real menu, and asserted against the
   document rather than the DOM — a row that opens but does nothing is the
   failure worth catching. */
type PW = import('@playwright/test').Page;

const row = (page: PW, label: string) => page.locator(`.ctx-row:has(.ctx-label:text-is("${label}"))`);

/** Canvas point with nothing under it, in world terms well past the fixture. */
const EMPTY = { x: 1200, y: 800 };

/**
 * Run a command against the current selection without needing the layer to be
 * clickable — a hidden or locked layer has no element to right-click, but the
 * menu still acts on whatever is selected.
 */
async function runOnSelection(page: PW, label: string) {
  await page.mouse.click(EMPTY.x, EMPTY.y, { button: 'right' });
  await expect(page.locator('.ctx').first()).toBeVisible();
  await row(page, label).click();
  await expect(page.locator('.ctx')).toHaveCount(0);
}

async function openMenu(page: PW, id: string) {
  await page.locator(`[data-node-id="${id}"]`).click({ button: 'right' });
  await expect(page.locator('.ctx').first()).toBeVisible();
}

/** Right-click, then run one command by name. */
async function runCommand(page: PW, id: string, label: string) {
  await openMenu(page, id);
  await row(page, label).click();
  await expect(page.locator('.ctx')).toHaveCount(0);
}

async function twoRects(page: PW) {
  const a = await makeNode(page, 'rect', { name: 'CtxA', x: 40, y: 560, w: 120, h: 80, fill: '#123456' });
  const b = await makeNode(page, 'rect', { name: 'CtxB', x: 220, y: 560, w: 120, h: 80, fill: '#ABCDEF' });
  return { a, b };
}

test('right-click opens the menu with the reference sections', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'CtxMenu', x: 40, y: 560, w: 120, h: 80, fill: '#4CC3F0' });
  await openMenu(page, id);

  for (const label of ['Copy', 'Paste here', 'Copy/Paste as', 'Bring to front', 'Send to back',
                       'Group selection', 'Frame selection', 'Add auto layout', 'Create component',
                       'Show/Hide', 'Lock/Unlock', 'Flip horizontal', 'Flip vertical', 'Delete']) {
    await expect(row(page, label)).toBeVisible();
  }
  // right-click also selects, the way Figma does
  expect(await selection(page)).toEqual([id]);
  await removeNodes(page, [id]);
});

/**
 * The panel is where you reach for a layer you cannot easily click on the
 * canvas — a buried one, a hidden one — so the commands have to be there too.
 */
test('right-clicking a layer row opens the same menu and acts on that row', async ({ page }) => {
  const { a, b } = await twoRects(page);
  await select(page, [a]);

  // right-clicking a row outside the selection moves the selection to it
  await page.locator('.fig-layer', { hasText: 'CtxB' }).first().click({ button: 'right' });
  await expect(page.locator('.ctx').first()).toBeVisible();
  expect(await selection(page)).toEqual([b]);

  await row(page, 'Send to back').click();
  await expect(page.locator('.ctx')).toHaveCount(0);
  const order = (await doc(page)).root.children.filter((c: string) => c === a || c === b);
  expect(order[0]).toBe(b);
  await removeNodes(page, [a, b]);
});

test('submenus open two levels deep and stay open on the way in', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'CtxSub', x: 40, y: 560, w: 120, h: 80, fill: '#4CC3F0' });
  await openMenu(page, id);

  await row(page, 'Copy/Paste as').hover();
  await expect(row(page, 'Copy as SVG')).toBeVisible();

  await row(page, 'Copy as code').hover();
  await expect(row(page, 'CSS (all layers)')).toBeVisible();
  expect(await page.locator('.ctx').count()).toBe(3);

  // the deepest panel survives the pointer travelling into it
  await row(page, 'CSS').hover();
  await expect(row(page, 'CSS')).toBeVisible();
  await removeNodes(page, [id]);
});

test('copy as code puts the layer CSS on the clipboard', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const id = await makeNode(page, 'rect', { name: 'Swatch', x: 40, y: 560, w: 120, h: 80, fill: '#123456' });

  await openMenu(page, id);
  await row(page, 'Copy/Paste as').hover();
  await row(page, 'Copy as code').hover();
  await row(page, 'CSS').click();

  const css = await page.evaluate(() => navigator.clipboard.readText());
  expect(css).toContain('.swatch {');
  expect(css.toLowerCase()).toContain('#123456');
  await removeNodes(page, [id]);
});

test('copy properties carries paint across, not position', async ({ page }) => {
  const { a, b } = await twoRects(page);

  await openMenu(page, a);
  await row(page, 'Copy/Paste as').hover();
  await row(page, 'Copy properties').click();

  await select(page, [b]);
  await openMenu(page, b);
  await row(page, 'Copy/Paste as').hover();
  await row(page, 'Paste properties').click();

  const nodes = await doc(page);
  expect(nodes[b].fill).toBe('#123456');
  expect(nodes[b].x).toBe(220); // geometry is deliberately left alone
  await removeNodes(page, [a, b]);
});

test('bring to front and send to back reorder the layer', async ({ page }) => {
  const { a, b } = await twoRects(page);
  const order = async () => (await doc(page)).root.children.filter((c: string) => c === a || c === b);

  await select(page, [a]);
  await runCommand(page, a, 'Bring to front');
  expect((await order()).at(-1)).toBe(a);

  await select(page, [a]);
  await runCommand(page, a, 'Send to back');
  expect((await order())[0]).toBe(a);
  await removeNodes(page, [a, b]);
});

test('group, frame and auto layout each wrap the selection', async ({ page }) => {
  const { a, b } = await twoRects(page);

  await select(page, [a, b]);
  await runCommand(page, a, 'Group selection');
  const grouped = (await selection(page))[0];
  expect((await doc(page))[grouped].children).toHaveLength(2);

  await runCommand(page, grouped, 'Ungroup');
  expect(await selection(page)).toHaveLength(2);

  await select(page, [a, b]);
  await runCommand(page, a, 'Frame selection');
  const framed = (await selection(page))[0];
  expect((await doc(page))[framed].flex).toBeNull();

  await select(page, [framed]);
  await runCommand(page, framed, 'Add auto layout');
  const laid = (await selection(page))[0];
  expect((await doc(page))[laid].flex).not.toBeNull();

  await removeNodes(page, [laid]);
});

test('show/hide, lock/unlock and both flips toggle their flag', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'CtxFlags', x: 40, y: 560, w: 120, h: 80, fill: '#4CC3F0' });

  await runCommand(page, id, 'Flip horizontal');
  expect((await doc(page))[id].flipH).toBe(true);

  await select(page, [id]);
  await runCommand(page, id, 'Flip vertical');
  expect((await doc(page))[id].flipV).toBe(true);

  // Hiding and locking both take the layer out of reach of a right-click —
  // it stops rendering, and a locked layer no longer resolves as a target —
  // so drive the rest through the selection.
  await select(page, [id]);
  await runOnSelection(page, 'Lock/Unlock');
  expect((await doc(page))[id].locked).toBe(true);

  await runOnSelection(page, 'Show/Hide');
  expect((await doc(page))[id].visible).toBe(false);
  await removeNodes(page, [id]);
});

test('create component marks the layer as a main', async ({ page }) => {
  const id = await makeNode(page, 'frame', { name: 'CtxMain', x: 40, y: 560, w: 160, h: 100, fill: '#EEEEEE' });
  await runCommand(page, id, 'Create component');
  expect((await doc(page))[id].isComponent).toBe(true);
  await removeNodes(page, [id]);
});

test('paste here drops the copy under the pointer', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'CtxSrc', x: 40, y: 560, w: 120, h: 80, fill: '#4CC3F0' });
  await select(page, [id]);
  await runCommand(page, id, 'Copy');

  const at = EMPTY;
  const world = await page.evaluate(({ x, y }) => {
    const rect = document.querySelector('[data-canvas-root]')!.getBoundingClientRect();
    const vp = window.paperlike!.ui.getState().viewport;
    return { x: (x - rect.left - vp.x) / vp.zoom, y: (y - rect.top - vp.y) / vp.zoom };
  }, at);

  await page.mouse.click(at.x, at.y, { button: 'right' });
  await row(page, 'Paste here').click();

  // the paste reads the clipboard, so it lands a tick after the click
  await page.waitForFunction((src) => window.paperlike!.ui.getState().selection[0] !== src, id);
  const pasted = (await selection(page))[0];
  const node = (await doc(page))[pasted];
  expect(node.x).toBeCloseTo(world.x, 0);
  expect(node.y).toBeCloseTo(world.y, 0);
  await removeNodes(page, [id, pasted]);
});

test('paste to replace swaps the layer, keeping its place', async ({ page }) => {
  const { a, b } = await twoRects(page);
  await select(page, [a]);
  await runCommand(page, a, 'Copy');

  await select(page, [b]);
  await runCommand(page, b, 'Paste to replace');

  await page.waitForFunction((gone) => !window.paperlike!.doc()[gone], b);
  const nodes = await doc(page);
  expect(nodes[b]).toBeUndefined();          // the target is gone
  const replacement = (await selection(page))[0];
  expect(nodes[replacement].x).toBe(220);    // and the replacement took its spot
  expect(nodes[replacement].fill).toBe('#123456');
  await removeNodes(page, [a, replacement]);
});

test('delete removes the layer and clears the selection', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'CtxGone', x: 40, y: 560, w: 120, h: 80, fill: '#4CC3F0' });
  await runCommand(page, id, 'Delete');
  expect((await doc(page))[id]).toBeUndefined();
  expect(await selection(page)).toEqual([]);
});

test('rows that need a selection are disabled without one', async ({ page }) => {
  await page.evaluate(() => window.paperlike!.ui.getState().clearSelection());
  await page.mouse.click(EMPTY.x, EMPTY.y, { button: 'right' });

  await expect(row(page, 'Copy')).toBeDisabled();
  await expect(row(page, 'Group selection')).toBeDisabled();
  await expect(row(page, 'Flip horizontal')).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(page.locator('.ctx')).toHaveCount(0);
});

test('the menu shortcuts run the same commands from the keyboard', async ({ page }) => {
  const { a, b } = await twoRects(page);

  await select(page, [a]);
  await page.keyboard.press('Shift+H');
  expect((await doc(page))[a].flipH).toBe(true);

  // ⌥⌘C / ⌥⌘V must not be swallowed by plain copy/paste
  await page.keyboard.press('Alt+Meta+KeyC');
  await select(page, [b]);
  await page.keyboard.press('Alt+Meta+KeyV');
  expect((await doc(page))[b].fill).toBe('#123456');

  await select(page, [b]);
  await page.keyboard.press('Alt+Meta+KeyK');
  expect((await doc(page))[b].isComponent).toBe(true);

  await removeNodes(page, [a, b]);
});

/**
 * Control metrics. Figma insets every field's content by 8px; ours used to rely
 * on a leading glyph to hold that space, so any select or text field without
 * one had its label welded to the rounded edge.
 */
test.describe('control padding', () => {
  const padding = (page: import('@playwright/test').Page, selector: string) =>
    page.locator(selector).first().evaluate((el) => {
      const style = getComputedStyle(el as HTMLElement);
      return { left: style.paddingLeft, right: style.paddingRight };
    });

  test('a select without a glyph insets its label and its caret', async ({ page }) => {
    const cover = await nodeNamed(page, 'Cover');
    await select(page, [cover!.id]);
    await page.locator('.fig-tab', { hasText: 'Prototype' }).click();
    await page.locator('button[title="Add interactions"]').click();
    await page.locator('.fig-interaction-summary').click();

    expect(await padding(page, '.fig-interaction .fig-value')).toEqual({
      left: '8px',
      right: '0px',
    });
    expect(await padding(page, '.fig-interaction .fig-caret')).toEqual({
      left: '0px',
      right: '8px',
    });
  });

  test('a glyph holds the inset itself, so the value is not pushed twice', async ({ page }) => {
    const cover = await nodeNamed(page, 'Cover');
    await select(page, [cover!.id]);
    // X/Y are glyph-led number fields
    expect(await padding(page, '.fig-input > .glyph + input')).toEqual({
      left: '0px',
      right: '8px',
    });
  });

  test('a button carrying a label is wider than an icon square', async ({ page }) => {
    const cover = await nodeNamed(page, 'Cover');
    await select(page, [cover!.id]);
    await page.locator('.fig-tab', { hasText: 'Prototype' }).click();
    await page.locator('button[title="Add interactions"]').click();
    await page.locator('.fig-interaction-summary').click();
    await page.locator('.fig-interaction .fig-input').first().click();

    const option = page.getByRole('listbox').getByRole('option', { name: 'While hovering' });
    expect(await option.evaluate((el) => getComputedStyle(el as HTMLElement).paddingLeft)).toBe('8px');
    // the icon buttons beside it stay square
    const icon = page.locator('.fig-interaction .fig-btn:not([data-text])').first();
    const box = (await icon.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(28);
  });
});

test.describe('export section', () => {
  test('the button names the kind of layer, not its name', async ({ page }) => {
    const board = await nodeNamed(page, 'Fixture Board');
    await select(page, [board!.id]);
    await expect(page.locator('.fig-export')).toHaveText('Export Frame');

    const cover = await nodeNamed(page, 'Cover');
    await select(page, [cover!.id]);
    await expect(page.locator('.fig-export')).toHaveText('Export Rectangle');

    const caption = await nodeNamed(page, 'Caption');
    await select(page, [caption!.id]);
    await expect(page.locator('.fig-export')).toHaveText('Export Text');

    // several at once says how many instead
    await select(page, [cover!.id, caption!.id]);
    await expect(page.locator('.fig-export')).toHaveText('Export 2 layers');
  });

  test('the preview renders the layer and follows the selection', async ({ page }) => {
    const cover = await nodeNamed(page, 'Cover');
    await select(page, [cover!.id]);
    await page.getByRole('button', { name: 'Preview' }).click();

    const preview = page.locator('.fig-export-preview img');
    await expect(preview).toBeVisible();
    await expect(page.locator('.fig-export-size')).toHaveText('240 × 240');

    // switching layers re-renders it rather than showing the old one
    const caption = await nodeNamed(page, 'Caption');
    await select(page, [caption!.id]);
    await expect(page.locator('.fig-export-size')).not.toHaveText('240 × 240');
  });
});

test.describe('sections', () => {
  test('⇧S puts the selection on a board without moving it', async ({ page }) => {
    const board = await nodeNamed(page, 'Fixture Board');
    const before = await page.locator(`[data-node-id="${board!.id}"]`).boundingBox();

    await select(page, [board!.id]);
    await page.locator('.canvas-root, body').first().click({ position: { x: 5, y: 5 } });
    await select(page, [board!.id]);
    await page.keyboard.press('Shift+S');

    const section = (await selection(page))[0];
    const nodes = await doc(page);
    expect(nodes[section].type).toBe('section');
    expect(nodes[section].children).toContain(board!.id);

    // the artboard keeps its place on screen
    const after = await page.locator(`[data-node-id="${board!.id}"]`).boundingBox();
    expect(after!.x).toBeCloseTo(before!.x, 0);
    expect(after!.y).toBeCloseTo(before!.y, 0);
  });

  test('a section names itself on the canvas, and the label selects it', async ({ page }) => {
    const board = await nodeNamed(page, 'Fixture Board');
    await select(page, [board!.id]);
    await page.keyboard.press('Shift+S');
    const section = (await selection(page))[0];

    await select(page, []);
    const label = page.locator('.section-label');
    await expect(label).toHaveText('Section');
    // and it steps aside once selected, so it does not double up with the
    // selection's own name label

    await label.click();
    expect(await selection(page)).toEqual([section]);
    await expect(page.locator('.section-label')).toHaveCount(0);
  });

  test('a frame inside a section is still what a click selects', async ({ page }) => {
    const board = await nodeNamed(page, 'Fixture Board');
    await select(page, [board!.id]);
    await page.keyboard.press('Shift+S');
    await select(page, []);

    // clicking a layer inside the artboard selects the artboard, not the section
    const cover = await nodeNamed(page, 'Cover');
    await page.locator(`[data-node-id="${cover!.id}"]`).click();
    expect(await selection(page)).toEqual([board!.id]);
  });

  test('the export button says Section for one', async ({ page }) => {
    const board = await nodeNamed(page, 'Fixture Board');
    await select(page, [board!.id]);
    await page.keyboard.press('Shift+S');
    await expect(page.locator('.fig-export')).toHaveText('Export Section');
  });
});

test.describe('panel controls that used to do nothing', () => {
  test('corner smoothing writes a superellipse the browser can draw', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Squircle', x: 40, y: 500, w: 160, h: 160, fill: '#4CC3F0', radius: 32 });
    await select(page, [id]);

    await page.getByRole('button', { name: 'Corner settings' }).first().click();
    await page.getByRole('button', { name: "Apple's squircle — 60%" }).click();

    expect((await doc(page))[id].cornerSmoothing).toBeCloseTo(0.6, 2);
    await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCSS('corner-shape', 'superellipse(4.4)');
    await removeNodes(page, [id]);
  });

  test('individual strokes give each side its own weight', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Edged', x: 40, y: 500, w: 160, h: 120, fill: '#FFFFFF' });
    await select(page, [id]);
    await page.evaluate((nodeId) => {
      window.paperlike!.store.update(nodeId, {
        border: { width: 2, color: '#111111', style: 'solid', position: 'inside' },
      });
    }, id);

    await page.getByRole('button', { name: 'Advanced stroke' }).click();
    await page.getByRole('button', { name: 'Set a weight for each side' }).click();
    await page.getByTitle('Bottom').locator('input').fill('8');
    await page.keyboard.press('Enter');

    const element = page.locator(`[data-node-id="${id}"]`);
    await expect(element).toHaveCSS('border-bottom-width', '8px');
    await expect(element).toHaveCSS('border-top-width', '2px');
    await removeNodes(page, [id]);
  });

  /**
   * Export settings live on the layer, so a layer starts with none and the
   * button saves what the rows say rather than opening anything — which is both
   * what Figma does and the only way the settings can sync.
   */
  test('the export suffix reaches the filename', async ({ page }) => {
    const cover = await nodeNamed(page, 'Cover');
    await select(page, [cover!.id]);

    await page.getByRole('button', { name: 'Add export settings' }).click();
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByPlaceholder('@2x, -dark…').fill('-dark');
    await page.keyboard.press('Enter');
    // Escape closes the popover, and then steps the selection out to the frame
    await page.keyboard.press('Escape');
    await select(page, [cover!.id]);

    const download = page.waitForEvent('download');
    await page.locator('.fig-export').click();
    expect((await download).suggestedFilename()).toContain('-dark');

    // and the settings are on the layer, not on the app
    const settings = (await doc(page))[cover!.id].exports;
    expect(settings).toHaveLength(1);
    expect(settings![0].suffix).toBe('-dark');
  });

  test('text case and truncation reach the rendered text', async ({ page }) => {
    const caption = await nodeNamed(page, 'Caption');
    await select(page, [caption!.id]);

    // case and truncation live in the Type settings dialog, where Figma keeps them
    await page.locator('button[title="Type settings"]').click();

    await page.getByRole('button', { name: 'Uppercase' }).click();
    await expect(page.locator(`[data-node-id="${caption!.id}"]`)).toHaveCSS('text-transform', 'uppercase');

    await page.getByRole('button', { name: 'Truncate with an ellipsis' }).click();
    await page.getByTitle('Lines to keep').locator('input').fill('2');
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-node-id="${caption!.id}"]`)).toHaveCSS('-webkit-line-clamp', '2');
  });
});

test('a child id with no node behind it can be cleared', async ({ page }) => {
  // A document can lose a node and keep the id in its parent's list — a merge
  // that dropped one side, say. Delete used to skip those, so the stray stayed
  // for good and every later delete skipped it too.
  const stray = await page.evaluate(() => {
    const store = window.paperlike!.store;
    const id = store.create('rect', 'root', { name: 'Doomed', x: 0, y: 0, w: 10, h: 10 });
    // drop the node without touching root's children, as a bad merge would
    store.ydoc.getMap('nodes').delete(id);
    store.commit();
    return id;
  });

  expect((await doc(page)).root.children).toContain(stray);
  await removeNodes(page, [stray]);
  expect((await doc(page)).root.children).not.toContain(stray);
});

test.describe('effects', () => {
  /** Adds one effect through the + menu and leaves its dialog open. */
  const addEffect = async (page: import('@playwright/test').Page, name: string) => {
    const section = page.locator('.fig-section').filter({
      has: page.locator('.fig-title', { hasText: /^Effects$/ }),
    });
    await section.getByRole('button', { name: 'Add effect' }).click();
    await page.getByRole('option', { name, exact: true }).first().click();
  };

  test('the + menu offers the eight effect types, and adding one writes it to the layer', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Effected', x: 40, y: 500, w: 200, h: 140, fill: '#FFFFFF' });
    await select(page, [id]);

    const section = page.locator('.fig-section').filter({
      has: page.locator('.fig-title', { hasText: /^Effects$/ }),
    });
    await section.getByRole('button', { name: 'Add effect' }).click();
    const menu = page.getByRole('listbox', { name: 'Add effect' });
    await expect(menu.getByRole('option')).toHaveText([
      'Inner shadow',
      'Drop shadow',
      'Layer blur',
      'Background blur',
      'Noise',
      'Texture',
      'Glass',
      'ShaderBeta',
    ]);

    await menu.getByRole('option', { name: 'Drop shadow', exact: true }).click();
    // Figma's defaults, and the settings dialog opens on the effect just added
    expect((await doc(page))[id].effects?.map((effect) => effect.type)).toEqual(['drop-shadow']);
    await expect(page.locator('.fig-card')).toBeVisible();
    await removeNodes(page, [id]);
  });

  test("a shadow's fields reach the rendered box-shadow", async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Shadowed', x: 40, y: 500, w: 200, h: 140, fill: '#FFFFFF' });
    await select(page, [id]);
    await addEffect(page, 'Drop shadow');

    const card = page.locator('.fig-card');
    await card.getByTitle('Y offset').locator('input').fill('10');
    await page.keyboard.press('Enter');
    await card.getByTitle('Blur', { exact: true }).locator('input').fill('16');
    await page.keyboard.press('Enter');

    await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCSS(
      'box-shadow',
      'rgba(0, 0, 0, 0.25) 0px 10px 16px 0px',
    );
    await removeNodes(page, [id]);
  });

  test('the eye keeps an effect but takes it off the layer', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Hidden', x: 40, y: 500, w: 200, h: 140, fill: '#FFFFFF' });
    await select(page, [id]);
    await addEffect(page, 'Drop shadow');
    await page.locator('.fig-effect').first().click();

    await page.getByRole('button', { name: 'Hide effect' }).click();
    expect((await doc(page))[id].effects?.[0].visible).toBe(false);
    await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCSS('box-shadow', 'none');

    await page.getByRole('button', { name: 'Show effect' }).click();
    await expect(page.locator(`[data-node-id="${id}"]`)).not.toHaveCSS('box-shadow', 'none');
    await removeNodes(page, [id]);
  });

  test('a progressive blur paints a masked layer rather than blurring the whole node', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Faded', x: 40, y: 500, w: 200, h: 140, fill: '#FFFFFF' });
    await select(page, [id]);
    await addEffect(page, 'Layer blur');

    // uniform blur is a filter on the node itself
    await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCSS('filter', 'blur(4px)');

    await page.getByRole('tab', { name: 'Progressive' }).click();
    await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCSS('filter', 'none');
    const layer = page.locator(`[data-node-id="${id}"] > div[aria-hidden]`);
    await expect(layer).toHaveCount(1);
    await expect(layer).toHaveCSS('backdrop-filter', 'blur(4px)');
    await removeNodes(page, [id]);
  });

  test('noise and texture paint their grain on a layer of their own', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Grainy', x: 40, y: 500, w: 200, h: 140, fill: '#FFFFFF' });
    await select(page, [id]);
    await addEffect(page, 'Noise');

    // Duo asks for a second colour, Multi swaps both for an opacity
    await page.getByRole('tab', { name: 'Duo' }).click();
    await expect(page.locator('.fig-card').locator('input[aria-label="Color"]')).toHaveCount(2);
    await page.getByRole('tab', { name: 'Multi' }).click();
    await expect(page.locator('.fig-card').locator('input[aria-label="Color"]')).toHaveCount(0);
    await expect(page.locator('.fig-card').getByTitle('Opacity').locator('input')).toHaveValue('15%');

    const layer = page.locator(`[data-node-id="${id}"] > div[aria-hidden]`);
    await expect(layer).toHaveCount(1);
    expect(await layer.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('feTurbulence');
    await removeNodes(page, [id]);
  });

  test("an effect's blend mode moves it onto its own layer, where CSS can blend it", async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Blended', x: 40, y: 500, w: 200, h: 140, fill: '#FFFFFF' });
    await select(page, [id]);
    await addEffect(page, 'Inner shadow');

    await page.locator('.fig-card').getByRole('button', { name: /Effect blend mode/ }).click();
    await page.getByRole('option', { name: 'Multiply' }).click();

    expect((await doc(page))[id].effects?.[0].blend).toBe('multiply');
    // box-shadow cannot blend, so the shadow moves to a layer that can
    await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCSS('box-shadow', 'none');
    const layer = page.locator(`[data-node-id="${id}"] > div[aria-hidden]`);
    await expect(layer).toHaveCSS('mix-blend-mode', 'multiply');
    await expect(layer).toHaveCSS('box-shadow', 'rgba(0, 0, 0, 0.25) 0px 4px 4px 0px inset');
    await removeNodes(page, [id]);
  });

  test('background blur frosts what is behind, and goes progressive on its own layer', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Panel', x: 40, y: 500, w: 200, h: 140, fill: 'rgba(255,255,255,0.4)' });
    await select(page, [id]);
    await addEffect(page, 'Background blur');

    await page.locator('.fig-card').getByTitle('Blur', { exact: true }).locator('input').fill('10');
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCSS('backdrop-filter', 'blur(10px)');

    await page.getByRole('tab', { name: 'Progressive' }).click();
    await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCSS('backdrop-filter', 'none');
    await expect(page.locator(`[data-node-id="${id}"] > div[aria-hidden]`)).toHaveCSS('backdrop-filter', 'blur(4px)');
    await removeNodes(page, [id]);
  });

  test("texture's clip to shape follows the layer's corners", async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Grain', x: 40, y: 500, w: 200, h: 140, fill: '#FFFFFF', radius: 16 });
    await select(page, [id]);
    await addEffect(page, 'Texture');

    const layer = page.locator(`[data-node-id="${id}"] > div[aria-hidden]`);
    // unclipped, the grain runs square across a rounded card
    await expect(layer).toHaveCSS('border-radius', '0px');
    await page.getByRole('checkbox', { name: 'Clip to shape' }).check();
    expect((await doc(page))[id].effects?.[0].clip).toBe(true);
    await expect(layer).toHaveCSS('border-radius', '16px');
    await removeNodes(page, [id]);
  });

  test('a style from the header applies a whole stack at once', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Styled', x: 40, y: 500, w: 200, h: 140, fill: '#FFFFFF' });
    await select(page, [id]);

    const section = page.locator('.fig-section').filter({
      has: page.locator('.fig-title', { hasText: /^Effects$/ }),
    });
    await section.getByRole('button', { name: 'Effects, apply styles' }).click();
    await page.getByRole('option', { name: 'Card elevation' }).click();

    expect((await doc(page))[id].effects?.map((effect) => effect.type)).toEqual([
      'drop-shadow',
      'drop-shadow',
    ]);
    await expect(page.locator('.fig-effect')).toHaveCount(2);
    await removeNodes(page, [id]);
  });
});

test.describe('position more-actions', () => {
  test('tidy up regularises a ragged grid without resizing it', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      // two ragged rows: overlapping vertically within a row, uneven gaps
      const boxes = [
        { x: 700, y: 40, w: 60, h: 60 },
        { x: 790, y: 46, w: 60, h: 60 },
        { x: 910, y: 38, w: 60, h: 60 },
        { x: 700, y: 170, w: 60, h: 60 },
        { x: 805, y: 174, w: 60, h: 60 },
      ];
      const made = boxes.map((b, i) =>
        store.create('rect', 'root', { name: `Tidy ${i}`, ...b, fill: '#4CC3F0' }),
      );
      store.commit();
      return made;
    });

    await select(page, ids);
    await page.getByRole('group', { name: 'Alignment' }).getByLabel('More actions').click();
    await page.getByRole('button', { name: 'Tidy up' }).click();

    const nodes = await doc(page);
    const row = ids.slice(0, 3).map((id) => nodes[id]);
    // the row now starts at the bounding box's left edge and steps evenly
    expect(row[0].x).toBe(700);
    expect(row[1].x - (row[0].x + row[0].w)).toBe(row[2].x - (row[1].x + row[1].w));
    // and shares one baseline
    expect(new Set(row.map((n) => n.y)).size).toBe(1);
    // the second row still is a second row, and nothing was resized
    expect(nodes[ids[3]].y).toBeGreaterThan(row[0].y + row[0].h);
    expect(nodes[ids[3]].w).toBe(60);

    await removeNodes(page, ids);
  });

  test('the menu opens inside the window, not clipped by the panel', async ({ page }) => {
    const cover = await nodeNamed(page, 'Cover');
    await select(page, [cover!.id]);
    await page.getByRole('group', { name: 'Alignment' }).getByLabel('More actions').click();

    const menu = page.getByRole('button', { name: 'Tidy up' });
    await expect(menu).toBeVisible();
    const panel = (await page.locator('.fig-shell .fig').first().boundingBox())!;
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
  });
});

test('swapping an instance rebuilds it from the other component, in place', async ({ page }) => {
  const { blue, green } = await page.evaluate(() => {
    const store = window.paperlike!.store;
    const a = store.create('frame', 'root', { name: 'Blue', x: 700, y: 40, w: 120, h: 80, fill: '#4CC3F0' });
    store.create('text', a, { name: 'BlueLabel', x: 8, y: 8, text: 'blue' });
    const b = store.create('frame', 'root', { name: 'Green', x: 900, y: 40, w: 120, h: 80, fill: '#5FD08A' });
    store.create('text', b, { name: 'GreenLabel', x: 8, y: 8, text: 'green' });
    store.createComponent(a);
    store.createComponent(b);
    store.commit();
    return { blue: a, green: b };
  });

  const instance = await page.evaluate(
    (id) => window.paperlike!.store.createInstance(id, 'root', { x: 700, y: 200 }),
    blue,
  );
  await select(page, [instance!]);

  await page.getByTitle('Swap instance').click();
  await page.getByRole('option', { name: 'Green' }).click();

  const next = (await selection(page))[0];
  const nodes = await doc(page);
  expect(nodes[next].instanceOf).toBe(green);
  // it kept its place on the canvas
  expect(nodes[next].x).toBe(700);
  expect(nodes[next].y).toBe(200);
  // and the subtree is the new component's, not the old one's relabelled
  expect(nodes[nodes[next].children[0]].text).toBe('green');
  expect(nodes[instance!]).toBeUndefined();

  await removeNodes(page, [blue, green, next]);
});

test.describe('multi-selection', () => {
  async function twoUnalike(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const store = window.paperlike!.store;
      const a = store.create('rect', 'root', { name: 'A', x: 700, y: 40, w: 60, h: 60, opacity: 1 });
      const b = store.create('rect', 'root', { name: 'B', x: 900, y: 40, w: 120, h: 60, opacity: 0.5 });
      store.commit();
      return [a, b];
    });
  }

  test('a field the layers disagree on reads Mixed, not the first one', async ({ page }) => {
    const ids = await twoUnalike(page);
    await select(page, ids);

    // they share a height and a Y, so those still show a number
    await expect(page.getByTitle('Height').locator('input')).toHaveValue('60');
    await expect(page.getByTitle('Y-position').locator('input')).toHaveValue('40');
    // and disagree on X, width and opacity
    await expect(page.getByTitle('X-position').locator('input')).toHaveValue('Mixed');
    await expect(page.getByTitle('Width').locator('input')).toHaveValue('Mixed');
    await expect(page.getByTitle('Opacity').locator('input')).toHaveValue('Mixed');

    // the header carries actions only — the name is edited in the layers
    // panel, as it is in Figma — so there is no field here to disagree
    await expect(page.locator('.fig-section input[title]')).toHaveCount(0);

    await removeNodes(page, ids);
  });

  test('layers with different fills show one Mixed paint, not the first hex', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const a = store.create('rect', 'root', { name: 'Red', x: 700, y: 40, w: 60, h: 60, fill: '#FF0000' });
      const b = store.create('rect', 'root', { name: 'Blue', x: 800, y: 40, w: 60, h: 60, fill: '#0000FF' });
      store.commit();
      return [a, b];
    });

    await select(page, [ids[0]]);
    await expect(page.getByLabel('Solid color hex: FF0000')).toBeVisible();

    await select(page, ids);
    await expect(page.getByLabel('Mixed paint')).toBeVisible();

    // and settling it applies to both, rather than to whichever came first
    const field = page.locator('.fig-section', { hasText: 'Fill' }).locator('input[aria-label="Color"]').first();
    await field.fill('00FF00');
    await field.blur();
    const nodes = await doc(page);
    expect(nodes[ids[0]].fill).toBe('#00FF00');
    expect(nodes[ids[1]].fill).toBe('#00FF00');

    await removeNodes(page, ids);
  });

  test('a dropdown the layers disagree on reads Mixed and ticks nothing', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const frame = store.create('frame', 'root', { name: 'Hugger', x: 700, y: 40, w: 100, h: 100 });
      store.create('rect', frame, { name: 'Inner', x: 0, y: 0, w: 40, h: 40 });
      store.update(frame, { wMode: 'fit' });
      const fixed = store.create('frame', 'root', { name: 'Fixed', x: 900, y: 40, w: 100, h: 100 });
      store.create('rect', fixed, { name: 'Inner2', x: 0, y: 0, w: 40, h: 40 });
      store.commit();
      return [frame, fixed];
    });

    await select(page, [ids[0]]);
    await expect(page.getByTitle('Horizontal resizing')).toHaveText(/Hug contents/);

    await select(page, ids);
    await expect(page.getByTitle('Horizontal resizing')).toHaveText(/Mixed/);
    // they agree vertically, so that one still names its value
    await expect(page.getByTitle('Vertical resizing')).not.toHaveText(/Mixed/);

    // nothing is ticked, because no option is true of the whole selection
    await page.getByTitle('Horizontal resizing').click();
    await expect(page.getByRole('listbox').getByText('✓')).toHaveCount(0);

    await removeNodes(page, ids);
  });

  test('a stroke the layers disagree on reads Mixed too', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const a = store.create('rect', 'root', { name: 'Thin', x: 700, y: 40, w: 60, h: 60, fill: '#FFFFFF' });
      const b = store.create('rect', 'root', { name: 'Thick', x: 800, y: 40, w: 60, h: 60, fill: '#FFFFFF' });
      store.update(a, { border: { width: 1, color: '#111111', style: 'solid', position: 'inside' } });
      store.update(b, { border: { width: 6, color: '#FF0000', style: 'solid', position: 'inside' } });
      store.commit();
      return [a, b];
    });

    await select(page, [ids[0]]);
    await expect(page.getByTitle('Stroke weight').locator('input')).toHaveValue('1');

    await select(page, ids);
    // the paint and the weight disagree independently, and both say so
    await expect(page.getByTitle('Stroke weight').locator('input')).toHaveValue('Mixed');
    await expect(page.locator('.fig-section', { hasText: 'Stroke' }).getByLabel('Mixed paint')).toBeVisible();

    await removeNodes(page, ids);
  });

  test('typing into a Mixed field settles every layer on that value', async ({ page }) => {
    const ids = await twoUnalike(page);
    await select(page, ids);

    await page.getByTitle('Width').locator('input').fill('200');
    await page.keyboard.press('Enter');

    const nodes = await doc(page);
    expect(nodes[ids[0]].w).toBe(200);
    expect(nodes[ids[1]].w).toBe(200);
    await expect(page.getByTitle('Width').locator('input')).toHaveValue('200');

    await removeNodes(page, ids);
  });
});

test.describe('component properties', () => {
  /** A card component with a toggleable badge and an editable label. */
  async function card(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const store = window.paperlike!.store;
      const main = store.create('frame', 'root', {
        name: 'Card', x: 700, y: 40, w: 200, h: 100, fill: '#FFFFFF',
      });
      const label = store.create('text', main, { name: 'Label', x: 12, y: 12, text: 'Hello' });
      const badge = store.create('rect', main, { name: 'Badge', x: 160, y: 12, w: 24, h: 24, fill: '#FF5555' });
      store.createComponent(main);

      const showBadge = store.addComponentProp(main, { name: 'Show badge', type: 'boolean', value: 'true' })!;
      const text = store.addComponentProp(main, { name: 'Label', type: 'text', value: 'Hello' })!;
      store.bindProp(badge, { prop: showBadge, field: 'visible' });
      store.bindProp(label, { prop: text, field: 'text' });
      store.commit();
      return { main, label, badge, showBadge, text };
    });
  }

  test('an instance starts from the component defaults', async ({ page }) => {
    const c = await card(page);
    const instance = await page.evaluate(
      (id) => window.paperlike!.store.createInstance(id, 'root', { x: 700, y: 200 }),
      c.main,
    );

    const nodes = await doc(page);
    expect(nodes[instance!].propValues![c.showBadge]).toBe('true');
    expect(nodes[instance!].propValues![c.text]).toBe('Hello');
    await removeNodes(page, [c.main, instance!]);
  });

  test('a boolean property hides the layer bound to it, on that instance alone', async ({ page }) => {
    const c = await card(page);
    const [one, two] = await page.evaluate((id) => {
      const store = window.paperlike!.store;
      return [
        store.createInstance(id, 'root', { x: 700, y: 200 })!,
        store.createInstance(id, 'root', { x: 950, y: 200 })!,
      ];
    }, c.main);

    await page.evaluate(
      ([id, prop]) => window.paperlike!.store.setPropValue(id as string, prop as string, 'false'),
      [one, c.showBadge],
    );
    await page.waitForFunction(
      ([id]) => {
        const d = window.paperlike!.doc();
        return d[d[id as string].children[1]]?.visible === false;
      },
      [one],
    );

    const nodes = await doc(page);
    // the badge is the second child in both; only the one told to went away
    expect(nodes[nodes[one].children[1]].visible).toBe(false);
    expect(nodes[nodes[two].children[1]].visible).toBe(true);
    await removeNodes(page, [c.main, one, two]);
  });

  test('a text property writes through to the bound layer', async ({ page }) => {
    const c = await card(page);
    const instance = await page.evaluate(
      (id) => window.paperlike!.store.createInstance(id, 'root', { x: 700, y: 200 })!,
      c.main,
    );
    await page.evaluate(
      ([id, prop]) => window.paperlike!.store.setPropValue(id as string, prop as string, 'Goodbye'),
      [instance, c.text],
    );
    await page.waitForFunction(
      ([id]) => {
        const d = window.paperlike!.doc();
        return d[d[id as string].children[0]]?.text === 'Goodbye';
      },
      [instance],
    );
    // the main is untouched — a property is an instance's business
    const nodes = await doc(page);
    expect(nodes[nodes[c.main].children[0]].text).toBe('Hello');
    await removeNodes(page, [c.main, instance]);
  });

  test('the panel publishes a property, binds a layer and sets it on an instance', async ({ page }) => {
    // build the component through the panel, the way a person would
    const { main, badge } = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const frame = store.create('frame', 'root', { name: 'Chip', x: 700, y: 40, w: 160, h: 60, fill: '#FFFFFF' });
      const dot = store.create('rect', frame, { name: 'Dot', x: 12, y: 12, w: 20, h: 20, fill: '#FF5555' });
      store.createComponent(frame);
      store.commit();
      return { main: frame, badge: dot };
    });

    await select(page, [main]);
    await page.getByRole('button', { name: 'Add property' }).click();
    await page.getByRole('option', { name: 'Boolean' }).click();
    await expect(page.getByRole('button', { name: /^Remove Boolean$/ })).toBeVisible();

    // point the dot at it
    await select(page, [badge]);
    await page.getByTitle('Applied property').click();
    await page.getByRole('option', { name: /Boolean · Boolean/ }).click();
    expect((await doc(page))[badge].bindings![0].field).toBe('visible');

    // and switch it off on an instance
    const instance = await page.evaluate(
      (id) => window.paperlike!.store.createInstance(id, 'root', { x: 700, y: 200 })!,
      main,
    );
    await select(page, [instance]);
    await page.getByLabel('Boolean', { exact: true }).uncheck();

    await page.waitForFunction(
      ([id]) => {
        const d = window.paperlike!.doc();
        return d[d[id as string].children[0]]?.visible === false;
      },
      [instance],
    );
    await removeNodes(page, [main, instance]);
  });

  test('retiring a property releases whatever followed it', async ({ page }) => {
    const c = await card(page);
    await page.evaluate(
      ([main, prop]) => window.paperlike!.store.removeComponentProp(main as string, prop as string),
      [c.main, c.showBadge],
    );

    const nodes = await doc(page);
    expect(nodes[c.main].props!.map((p) => p.name)).toEqual(['Label']);
    expect(nodes[c.badge].bindings ?? []).toEqual([]);
    await removeNodes(page, [c.main]);
  });
});

test.describe('variants', () => {
  async function pair(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const store = window.paperlike!.store;
      const a = store.create('frame', 'root', { name: 'Default', x: 700, y: 40, w: 120, h: 60, fill: '#DDDDDD' });
      const b = store.create('frame', 'root', { name: 'Hover', x: 860, y: 40, w: 120, h: 60, fill: '#4CC3F0' });
      store.createComponent(a);
      store.createComponent(b);
      const set = store.combineAsVariants([a, b])!;
      store.commit();
      return { a, b, set };
    });
  }

  test('combining mains makes a set with a property that tells them apart', async ({ page }) => {
    const { a, b, set } = await pair(page);
    const nodes = await doc(page);

    expect(nodes[set].isComponentSet).toBe(true);
    expect(nodes[set].children).toEqual([a, b]);
    const prop = nodes[set].props![0];
    expect(prop.type).toBe('variant');
    expect(prop.options).toEqual(['Default', 'Hover']);
    expect(nodes[a].variantValues![prop.id]).toBe('Default');
    expect(nodes[b].variantValues![prop.id]).toBe('Hover');
    await removeNodes(page, [set]);
  });

  test('choosing a variant value swaps the instance to that variant', async ({ page }) => {
    const { a, b, set } = await pair(page);
    const prop = (await doc(page))[set].props![0];
    const instance = await page.evaluate(
      (id) => window.paperlike!.store.createInstance(id, 'root', { x: 700, y: 220 })!,
      a,
    );

    const next = await page.evaluate(
      ([id, propId]) => window.paperlike!.store.setPropValue(id as string, propId as string, 'Hover'),
      [instance, prop.id],
    );

    const nodes = await doc(page);
    expect(nodes[next!].instanceOf).toBe(b);
    // it stayed where it was put
    expect(nodes[next!].x).toBe(700);
    expect(nodes[next!].y).toBe(220);
    await removeNodes(page, [set, next!]);
  });
});

test.describe('styles', () => {
  test('a style moves every layer wearing it', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const a = store.create('rect', 'root', { name: 'A', x: 700, y: 40, w: 60, h: 60, fill: '#FF0000' });
      const b = store.create('rect', 'root', { name: 'B', x: 800, y: 40, w: 60, h: 60, fill: '#00FF00' });
      store.commit();
      return [a, b];
    });

    const styleId = await page.evaluate(
      (id) => window.paperlike!.store.createStyleFrom(id, 'fill', 'Brand'),
      ids[0],
    );
    await page.evaluate(
      ([list, style]) => window.paperlike!.store.applyStyle(list as string[], style as string, 'fill'),
      [ids, styleId],
    );
    await page.waitForFunction(([id]) => window.paperlike!.doc()[id as string].fill === '#FF0000', [ids[1]]);

    // editing the style moves both, because they follow rather than copy
    await page.evaluate(
      (style) =>
        window.paperlike!.store.updateStyle(style as string, {
          value: [{ id: 'base', value: '#0000FF', opacity: 1, visible: true }],
        }),
      styleId,
    );
    await page.waitForFunction(([id]) => window.paperlike!.doc()[id as string].fill === '#0000FF', [ids[0]]);
    expect((await doc(page))[ids[1]].fill).toBe('#0000FF');

    await page.evaluate((id) => window.paperlike!.store.removeStyle(id as string), styleId);
    await removeNodes(page, ids);
  });

  test('detaching keeps the paint and drops the subscription', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Worn', x: 700, y: 40, w: 60, h: 60, fill: '#FF0000' });
    const styleId = await page.evaluate(
      (node) => window.paperlike!.store.createStyleFrom(node, 'fill', 'Detachable'),
      id,
    );

    await page.evaluate(([node]) => window.paperlike!.store.detachStyle([node as string], 'fill'), [id]);
    expect((await doc(page))[id].styles?.fill).toBeUndefined();

    // the style moves on; the layer does not follow it any more
    await page.evaluate(
      (style) =>
        window.paperlike!.store.updateStyle(style as string, {
          value: [{ id: 'base', value: '#00FF00', opacity: 1, visible: true }],
        }),
      styleId,
    );
    await page.waitForTimeout(300);
    expect((await doc(page))[id].fill).toBe('#FF0000');

    await page.evaluate((s) => window.paperlike!.store.removeStyle(s as string), styleId);
    await removeNodes(page, [id]);
  });

  test('deleting a style releases its layers without repainting them', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Orphan', x: 700, y: 40, w: 60, h: 60, fill: '#AB12CD' });
    const styleId = await page.evaluate(
      (node) => window.paperlike!.store.createStyleFrom(node, 'fill', 'Doomed'),
      id,
    );
    await page.evaluate((s) => window.paperlike!.store.removeStyle(s as string), styleId);

    const node = (await doc(page))[id];
    expect(node.styles?.fill).toBeUndefined();
    expect(node.fill).toBe('#AB12CD');
    await removeNodes(page, [id]);
  });

  test('a text style carries the whole type spec', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const a = store.create('text', 'root', { name: 'H1', x: 700, y: 40, text: 'One' });
      const b = store.create('text', 'root', { name: 'H2', x: 700, y: 100, text: 'Two' });
      store.update(a, { font: { family: 'Inter, system-ui, sans-serif', size: 32, weight: 700, lineHeight: 1.2, letterSpacing: 0, align: 'left', color: '#111111' } });
      store.commit();
      return [a, b];
    });

    const styleId = await page.evaluate(
      (id) => window.paperlike!.store.createStyleFrom(id as string, 'text', 'Heading'),
      ids[0],
    );
    await page.evaluate(
      ([list, style]) => window.paperlike!.store.applyStyle([(list as string[])[1]], style as string),
      [ids, styleId],
    );
    await page.waitForFunction(([id]) => window.paperlike!.doc()[id as string].font?.size === 32, [ids[1]]);

    const nodes = await doc(page);
    expect(nodes[ids[1]].font!.weight).toBe(700);
    await expect(page.locator(`[data-node-id="${ids[1]}"]`)).toHaveCSS('font-size', '32px');

    await page.evaluate((s) => window.paperlike!.store.removeStyle(s as string), styleId);
    await removeNodes(page, ids);
  });

  test('the panel creates a style from a layer and puts it on another', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const a = store.create('rect', 'root', { name: 'Source', x: 700, y: 40, w: 60, h: 60, fill: '#123456' });
      const b = store.create('rect', 'root', { name: 'Target', x: 800, y: 40, w: 60, h: 60, fill: '#FFFFFF' });
      store.commit();
      return [a, b];
    });

    await select(page, [ids[0]]);
    await page.getByRole('button', { name: 'Fill, apply styles and variables' }).click();
    await page.getByRole('button', { name: 'Create style from this layer' }).click();
    await page.getByPlaceholder('Style name').fill('Ink');
    await page.keyboard.press('Enter');
    await expect(page.locator('.fig-style-badge', { hasText: 'Ink' })).toBeVisible();

    await select(page, [ids[1]]);
    await page.getByRole('button', { name: 'Fill, apply styles and variables' }).click();

    // the dialog opens beside the panel and stays inside the window
    const list = page.getByRole('listbox', { name: 'Styles' });
    await expect(list).toBeVisible();
    const dialog = (await list.evaluate((el) => {
      const box = el.closest('div[style]')!.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, right: box.right };
    })) as { top: number; bottom: number; right: number };
    const viewport = await page.evaluate(() => window.innerHeight);
    const panelLeft = (await page.locator('.fig-shell .fig').first().boundingBox())!.x;
    expect(dialog.top).toBeGreaterThanOrEqual(0);
    expect(dialog.bottom).toBeLessThanOrEqual(viewport);
    expect(dialog.right).toBeLessThanOrEqual(panelLeft + 1);

    await page.getByRole('option', { name: 'Ink' }).click();
    await page.waitForFunction(([id]) => window.paperlike!.doc()[id as string].fill === '#123456', [ids[1]]);

    await removeNodes(page, ids);
  });
});

test.describe('number variables', () => {
  test('a bound width renders as the variable and follows it', async ({ page }) => {
    const { id, token } = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const t = store.addToken({ name: 'card-w', type: 'number', value: '160' });
      const node = store.create('rect', 'root', { name: 'Bound', x: 700, y: 40, w: 60, h: 60, fill: '#4CC3F0' });
      store.bindVariable([node], 'w', t);
      store.commit();
      return { id: node, token: t };
    });

    // the number is resolved for the geometry, and the CSS carries the var
    expect((await doc(page))[id].w).toBe(160);
    const width = await page.locator(`[data-node-id="${id}"]`).evaluate(
      (el) => (el as HTMLElement).style.width,
    );
    expect(width).toBe('calc(var(--card-w) * 1px)');
    await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCSS('width', '160px');

    // moving the variable moves the layer
    await page.evaluate((t) => window.paperlike!.store.updateToken(t as string, { value: '240' }), token);
    await page.waitForFunction(([node]) => window.paperlike!.doc()[node as string].w === 240, [id]);
    await expect(page.locator(`[data-node-id="${id}"]`)).toHaveCSS('width', '240px');

    await removeNodes(page, [id]);
  });

  test('the field names the variable, and detaching gives the number back', async ({ page }) => {
    const { id } = await page.evaluate(() => {
      const store = window.paperlike!.store;
      store.addToken({ name: 'gap-lg', type: 'number', value: '48' });
      const node = store.create('rect', 'root', { name: 'Pick', x: 700, y: 40, w: 60, h: 60, fill: '#4CC3F0' });
      store.commit();
      return { id: node };
    });
    await select(page, [id]);

    await page.getByTitle('Width').getByRole('button', { name: 'Apply variable' }).click();
    await page.getByRole('option', { name: /gap-lg/ }).click();

    // the field shows the variable's name rather than a number you could type
    const field = page.getByTitle('Width').locator('input');
    await expect(field).toHaveAttribute('placeholder', 'gap-lg');
    await expect(field).toBeDisabled();
    expect((await doc(page))[id].w).toBe(48);

    await page.getByTitle('Width').getByRole('button', { name: 'Apply variable' }).click();
    await page.getByRole('button', { name: 'Detach variable' }).click();
    await expect(page.getByTitle('Width').locator('input')).toBeEnabled();
    expect((await doc(page))[id].vars?.w).toBeUndefined();
    // the value it resolved to stays — detaching is not undoing
    expect((await doc(page))[id].w).toBe(48);

    await removeNodes(page, [id]);
  });
});

test.describe('layout grid and text blocks', () => {
  test('a non-stretch grid pins fixed-width columns to an edge', async ({ page }) => {
    const board = await nodeNamed(page, 'Fixture Board');
    await select(page, [board!.id]);
    await page.evaluate(
      (id) =>
        window.paperlike!.store.update(id, {
          guides: { type: 'columns', count: 3, gutter: 8, margin: 24, size: 8, color: 'rgba(255,0,80,0.18)', visible: true },
        }),
      board!.id,
    );

    await page.getByTitle('Type').click();
    await page.getByRole('listbox').getByRole('option', { name: 'Right', exact: true }).click();
    await page.getByTitle('Column width').locator('input').fill('40');
    await page.keyboard.press('Enter');

    const guides = (await doc(page))[board!.id].guides!;
    expect(guides.align).toBe('end');
    expect(guides.width).toBe(40);

    const track = page.locator(`[data-node-id="${board!.id}"] > div`).last().locator('> div').first();
    await expect(track).toHaveCSS('width', '40px');
  });

  test('paragraph spacing and lists turn the lines into real blocks', async ({ page }) => {
    const id = await makeNode(page, 'text', {
      name: 'Prose', x: 700, y: 40, w: 240, h: 120, text: 'One\nTwo\nThree',
    });
    await select(page, [id]);
    await page.locator('button[title="Type settings"]').click();

    await page.getByTitle('Space between paragraphs').locator('input').fill('12');
    await page.keyboard.press('Enter');
    const blocks = page.locator(`[data-node-id="${id}"] > div`);
    await expect(blocks).toHaveCount(3);
    await expect(blocks.nth(1)).toHaveCSS('margin-top', '12px');

    await page.getByRole('button', { name: 'Numbered' }).click();
    await expect(page.locator(`[data-node-id="${id}"] ol li`)).toHaveCount(3);

    await removeNodes(page, [id]);
  });
});

test('the stroke-style menu opens inside the panel, with its own glyph', async ({ page }) => {
  const cover = await nodeNamed(page, 'Cover');
  await select(page, [cover!.id]);
  await page.evaluate((id) => {
    window.paperlike!.store.update(id, {
      border: { width: 2, color: '#111111', style: 'solid', position: 'inside' },
    });
  }, cover!.id);

  const style = page.getByRole('button', { name: 'Stroke style' });
  const advanced = page.getByRole('button', { name: 'Advanced stroke' });
  // adjacent buttons must not draw the same icon
  const glyph = (l: typeof style) => l.locator('svg').first().evaluate((el) => el.outerHTML);
  expect(await glyph(style)).not.toBe(await glyph(advanced));

  await style.click();
  const item = page.getByRole('button', { name: 'Dash', exact: true });
  await expect(item).toBeVisible();
  const panel = (await page.locator('.fig-shell .fig').first().boundingBox())!;
  const box = (await item.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);

  await item.click();
  expect((await doc(page))[cover!.id].border!.style).toBe('dashed');
});

// ── Auto layout ──────────────────────────────────────────────────────────

test.describe('auto layout', () => {
  /** A frame with three boxes laid out as a row: 24px padding, 20px gaps. */
  async function rowFrame(page: import('@playwright/test').Page): Promise<string> {
    const frame = await makeNode(page, 'frame', {
      name: 'AutoProbe', x: 700, y: 40, w: 328, h: 128, fill: '#FFFFFF', flex: null,
    });
    await page.evaluate((id) => {
      const store = window.paperlike!.store;
      for (let i = 0; i < 3; i++) {
        store.create('rect', id, {
          name: `Item ${i + 1}`, x: 24 + i * 100, y: 24, w: 80, h: 80, fill: '#4CC3F0',
        });
      }
      store.commit();
    }, frame);
    return frame;
  }

  test('the panel button reads the flow back out of where the children sit', async ({ page }) => {
    const frame = await rowFrame(page);
    await select(page, [frame]);
    await page.locator('button[title="Add auto layout"]').click();

    const flex = (await doc(page))[frame].flex!;
    expect(flex.direction).toBe('row');
    expect(flex.gap).toBe(20);
    // top/right/bottom/left, measured off the children's bounding box
    expect(flex.padding).toEqual([24, 24, 24, 24]);
    await removeNodes(page, [frame]);
  });

  test('dropping the layout leaves the children where they looked', async ({ page }) => {
    const frame = await rowFrame(page);
    await select(page, [frame]);
    await page.locator('button[title="Add auto layout"]').click();
    // shift the gap so the laid-out positions differ from the original x/y
    await page.evaluate((id) => {
      const node = window.paperlike!.doc()[id];
      window.paperlike!.store.update(id, { flex: { ...node.flex!, gap: 40 } });
    }, frame);

    const before = await page
      .locator(`[data-node-id="${frame}"] > [data-node-id]`)
      .nth(2)
      .boundingBox();

    await page.locator('button[title="Remove auto layout"]').click();

    const after = await page
      .locator(`[data-node-id="${frame}"] > [data-node-id]`)
      .nth(2)
      .boundingBox();
    expect(after!.x).toBeCloseTo(before!.x, 0);
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect((await doc(page))[frame].flex).toBeNull();
    await removeNodes(page, [frame]);
  });

  test('resize to fit shrink-wraps a freeform frame without moving its content', async ({ page }) => {
    const frame = await rowFrame(page);
    await select(page, [frame]);
    const before = await page.locator(`[data-node-id="${frame}"] > [data-node-id]`).first().boundingBox();

    await page.locator('button[title="Resize to fit"]').click();

    const node = (await doc(page))[frame];
    expect(node.w).toBe(280);
    expect(node.h).toBe(80);
    const after = await page.locator(`[data-node-id="${frame}"] > [data-node-id]`).first().boundingBox();
    expect(after!.x).toBeCloseTo(before!.x, 0);
    expect(after!.y).toBeCloseTo(before!.y, 0);
    await removeNodes(page, [frame]);
  });

  test('resize to fit hugs an auto-layout frame instead of pinning a size', async ({ page }) => {
    const frame = await rowFrame(page);
    await select(page, [frame]);
    await page.locator('button[title="Add auto layout"]').click();
    await page.locator('button[title="Resize to fit"]').click();

    const node = (await doc(page))[frame];
    expect(node.wMode).toBe('fit');
    expect(node.hMode).toBe('fit');
    await removeNodes(page, [frame]);
  });

  test('absolute position takes a child out of the flow but leaves it in the frame', async ({ page }) => {
    const frame = await rowFrame(page);
    await select(page, [frame]);
    await page.locator('button[title="Add auto layout"]').click();

    const child = (await doc(page))[frame].children[2];
    await select(page, [child]);
    const before = await page.locator(`[data-node-id="${child}"]`).boundingBox();
    await page.locator('button[title="Absolute position"]').click();

    const node = (await doc(page))[child];
    expect(node.absolute).toBe(true);
    expect(node.parent).toBe(frame);
    await expect(page.locator(`[data-node-id="${child}"]`)).toHaveCSS('position', 'absolute');
    const after = await page.locator(`[data-node-id="${child}"]`).boundingBox();
    expect(after!.x).toBeCloseTo(before!.x, 0);
    await removeNodes(page, [frame]);
  });

  test('wrap adds the second gap, and it lands on the cross axis', async ({ page }) => {
    const frame = await rowFrame(page);
    await select(page, [frame]);
    await page.locator('button[title="Add auto layout"]').click();
    await page.locator('button[title="Wrap"]').click();

    await page.evaluate((id) => {
      const node = window.paperlike!.doc()[id];
      window.paperlike!.store.update(id, { flex: { ...node.flex!, gap: 12, crossGap: 30 } });
    }, frame);

    const element = page.locator(`[data-node-id="${frame}"]`);
    await expect(element).toHaveCSS('flex-wrap', 'wrap');
    // a row flows across, so the second gap is the space between its lines
    await expect(element).toHaveCSS('row-gap', '30px');
    await expect(element).toHaveCSS('column-gap', '12px');
    await removeNodes(page, [frame]);
  });

  test('a plain shape inside a layout can still be told to fill it', async ({ page }) => {
    const frame = await rowFrame(page);
    await select(page, [frame]);
    await page.locator('button[title="Add auto layout"]').click();

    const child = (await doc(page))[frame].children[0];
    await select(page, [child]);
    // a rectangle is not a container, but the layout still sizes it
    await page.getByTitle('Horizontal resizing').click();
    await page.getByRole('option', { name: 'Fill container' }).click();
    expect((await doc(page))[child].wMode).toBe('fill');
    await removeNodes(page, [frame]);
  });

  test('the picker stays on screen when a taller body opens', async ({ page }) => {
    const frame = await rowFrame(page);
    const child = (await doc(page))[frame].children[0];
    await select(page, [child]);
    await page.locator('.fig-section', { hasText: 'Fill' }).locator('.fig-swatch').first().click();

    const bottom = async () =>
      page.evaluate(() => document.querySelector('[data-testid="paint-picker"]')!.getBoundingClientRect().bottom);
    expect(await bottom()).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));

    // the gradient ramp makes the dialog taller; it has to move up to suit
    await page.locator('.fig-picker-type[title="Gradient"] input').click({ force: true });
    await expect(page.locator('.fig-picker-ramp')).toBeVisible();
    expect(await bottom()).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
    await removeNodes(page, [frame]);
  });

  test('canvas stacking puts the first layer in front', async ({ page }) => {
    const frame = await rowFrame(page);
    await select(page, [frame]);
    await page.locator('button[title="Add auto layout"]').click();
    await page.locator('button[title="Advanced layout settings"]').click();
    await page.locator('button[title="First layer on top"]').click();

    const first = (await doc(page))[frame].children[0];
    await expect(page.locator(`[data-node-id="${first}"]`)).toHaveCSS('z-index', '3');
    await removeNodes(page, [frame]);
  });
});

/**
 * Pages.
 *
 * The panel is Figma's: a disclosure that collapses the list, a scroll region
 * whose height a handle sets, and a right-click menu that is the only way to
 * duplicate or delete. Each of these used to be either missing or inert — the
 * `open` flag had no control, and picking Shader in the fill picker wrote a
 * property nothing painted — so they are checked through the UI, not the store.
 */
test.describe('pages', () => {
  test('duplicating copies the layers and lands right after the original', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const source = store.addPage('Source');
      store.create('rect', source, { name: 'OnSource', x: 10, y: 20, w: 80, h: 60 });
      store.commit();
      const copy = store.duplicatePage(source)!;
      store.commit();
      const doc = window.paperlike!.doc();
      const pages = store.listPages();
      return {
        source,
        copy,
        adjacent: pages.indexOf(copy) === pages.indexOf(source) + 1,
        name: doc[copy]?.name,
        children: doc[copy]?.children.map((id) => ({
          name: doc[id]?.name, x: doc[id]?.x, y: doc[id]?.y,
        })),
      };
    });

    expect(ids.adjacent).toBe(true);
    expect(ids.name).toBe('Source copy');
    // the layer comes with it, at the position it had — a duplicate that
    // normalised to the origin would put everything in the corner
    expect(ids.children).toEqual([{ name: 'OnSource', x: 10, y: 20 }]);

    await page.evaluate(([a, b]) => {
      window.paperlike!.store.removePage(a);
      window.paperlike!.store.removePage(b);
    }, [ids.source, ids.copy] as const);
  });

  test('right-clicking a page offers Figma’s four commands', async ({ page }) => {
    const extra = await page.evaluate(() => window.paperlike!.store.addPage('Scratch'));
    await page.locator(`.fig-layer[data-page-id="${extra}"]`).click({ button: 'right' });

    const menu = page.locator('.ctx').first();
    await expect(menu.locator('.ctx-row')).toHaveText([
      'Copy link to page',
      'Rename page',
      'Duplicate page',
      'Delete page',
    ]);
    // more than one page, so deleting is available
    await expect(menu.locator('.ctx-row', { hasText: 'Delete page' })).toBeEnabled();

    await page.keyboard.press('Escape');
    await page.evaluate((id) => window.paperlike!.store.removePage(id), extra);
  });

  test('the only page cannot be deleted, and the row says so', async ({ page }) => {
    await page.evaluate(() => {
      const store = window.paperlike!.store;
      for (const id of store.listPages().slice(1)) store.removePage(id);
    });
    const only = await page.evaluate(() => window.paperlike!.store.listPages()[0]);
    await page.locator(`.fig-layer[data-page-id="${only}"]`).click({ button: 'right' });
    await expect(
      page.locator('.ctx').first().locator('.ctx-row', { hasText: 'Delete page' }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
  });

  test('a copied page link opens on that page', async ({ page }) => {
    const extra = await page.evaluate(() => {
      const id = window.paperlike!.store.addPage('Deep');
      window.paperlike!.store.commit();
      return id;
    });

    await page.goto(`/f/testfile00?page=${extra}`);
    await page.waitForFunction(() => !!window.paperlike);
    await expect
      .poll(() => page.evaluate(() => window.paperlike!.ui.getState().page))
      .toBe(extra);

    await page.evaluate((id) => window.paperlike!.store.removePage(id), extra);
    await openEditor(page);
  });

  test('the title collapses the list, and the handle resizes it', async ({ page }) => {
    const list = page.locator('#fig-pages-list');
    await expect(list).toBeVisible();
    const before = (await list.boundingBox())!.height;

    // the handle is the rule between Pages and Layers
    const handle = page.locator('.fig-pages-resizer');
    await handle.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await list.boundingBox())!.height).toBeGreaterThan(before);

    const title = page.getByRole('button', { name: 'Pages', exact: true });
    await title.click();
    await expect(title).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toBeHidden();
    await title.click();
    await expect(list).toBeVisible();
  });

  test('the page panel carries the background and whether exports show it', async ({ page }) => {
    await page.evaluate(() => window.paperlike!.ui.getState().select([]));
    const checkbox = page.getByLabel('Show in exports');
    await expect(checkbox).toBeChecked();

    await checkbox.uncheck();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ui = window.paperlike!.ui.getState();
          return window.paperlike!.doc()[ui.page]?.exportBackground;
        }),
      )
      .toBe(false);

    // …and the canvas publishes it, which is what the exporter reads
    await expect(page.locator('[data-canvas-root]')).toHaveAttribute('data-export-background', 'off');
    await checkbox.check();
  });
});

/**
 * Space is the hand tool for as long as it is held.
 *
 * It used to pan by poking `document.body.style.cursor` from a ref, so the tool
 * rail still said Move while the canvas behaved like Hand — and the keydown was
 * not swallowed, which meant a focused panel button fired instead.
 */
test.describe('space to pan', () => {
  test('holding space arms the hand tool and pans, and releasing gives it back', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'PanProbe', x: 60, y: 560, w: 120, h: 90 });
    const before = await page.evaluate(() => window.paperlike!.ui.getState().viewport);
    const hand = page.getByRole('button', { name: 'Hand tool' });
    await expect(hand).not.toHaveAttribute('data-on', 'true');

    await page.mouse.move(700, 500);
    await page.keyboard.down('Space');
    // the rail says what the canvas is doing
    await expect(hand).toHaveAttribute('data-on', 'true');

    await dragBy(page, { x: 700, y: 500 }, { x: 120, y: 60 });
    const after = await page.evaluate(() => window.paperlike!.ui.getState().viewport);
    expect(Math.round(after.x - before.x)).toBe(120);
    expect(Math.round(after.y - before.y)).toBe(60);

    // panning must not have moved the layer — the canvas moved under it
    expect((await doc(page))[id].x).toBe(60);

    await page.keyboard.up('Space');
    await expect(hand).not.toHaveAttribute('data-on', 'true');
    // the tool it borrowed from is the tool it hands back
    expect(await page.evaluate(() => window.paperlike!.ui.getState().tool)).toBe('move');

    await page.evaluate((vp) => window.paperlike!.ui.getState().setViewport(vp), before);
    await removeNodes(page, [id]);
  });

  test('using a button in the chrome does not disable panning', async ({ page }) => {
    // A button keeps focus after a click, and Space belongs to a focused
    // button — so clicking anything in the chrome used to leave the canvas
    // unable to pan until you clicked it again. Only a live run caught it:
    // the assertions all pressed Space with focus already on the body.
    await page.getByTitle('Zoom').click();
    await page.getByRole('option', { name: /Zoom to 100%/ }).click();

    await page.keyboard.down('Space');
    await expect(page.getByRole('button', { name: 'Hand tool' })).toHaveAttribute('data-on', 'true');
    await page.keyboard.up('Space');
  });

  test('the hand replaces the tool it borrowed, rather than joining it', async ({ page }) => {
    const move = page.getByRole('button', { name: 'Move', exact: true });
    const hand = page.getByRole('button', { name: 'Hand tool' });
    await expect(move).toHaveAttribute('data-on', 'true');

    await page.keyboard.down('Space');
    await expect(hand).toHaveAttribute('data-on', 'true');
    // two lit buttons would say two tools are armed
    await expect(move).not.toHaveAttribute('data-on', 'true');
    await page.keyboard.up('Space');
    await expect(move).toHaveAttribute('data-on', 'true');
  });

  test('space still belongs to a focused control', async ({ page }) => {
    await page.evaluate(() => window.paperlike!.ui.getState().select([]));
    const checkbox = page.getByLabel('Show in exports');
    await expect(checkbox).toBeChecked();

    await checkbox.focus();
    await page.keyboard.press('Space');
    // the checkbox toggled, and the canvas did not quietly arm the hand tool
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Hand tool' })).not.toHaveAttribute('data-on', 'true');

    await checkbox.check();
  });
});

/**
 * Zoom.
 *
 * The shortcuts scaled `zoom` and left `x`/`y` alone, so every keyboard zoom
 * was about the world origin: press ⌘+ twice and whatever you were looking at
 * has walked off the screen. Figma keeps the middle of the canvas still, which
 * is what makes zoom feel like zoom rather than like a jump.
 */
test.describe('zoom', () => {
  /** the world point sitting at the centre of the canvas area */
  const centre = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const rect = document.querySelector('[data-canvas-root]')!.getBoundingClientRect();
      const vp = window.paperlike!.ui.getState().viewport;
      return {
        x: (rect.width / 2 - vp.x) / vp.zoom,
        y: (rect.height / 2 - vp.y) / vp.zoom,
        zoom: vp.zoom,
      };
    });

  test('zooming in and out holds the middle of the canvas still', async ({ page }) => {
    await page.evaluate(() =>
      window.paperlike!.ui.getState().setViewport({ x: 120, y: 100, zoom: 1 }),
    );
    const before = await centre(page);

    await page.keyboard.press('+');
    const zoomedIn = await centre(page);
    expect(zoomedIn.zoom).toBeCloseTo(1.25, 5);
    // the point you were looking at is the point you are still looking at
    expect(zoomedIn.x).toBeCloseTo(before.x, 1);
    expect(zoomedIn.y).toBeCloseTo(before.y, 1);

    await page.keyboard.press('-');
    const back = await centre(page);
    expect(back.zoom).toBeCloseTo(1, 5);
    expect(back.x).toBeCloseTo(before.x, 1);
    expect(back.y).toBeCloseTo(before.y, 1);
  });

  test('the shortcuts take the modifier or go without it', async ({ page }) => {
    await page.evaluate(() => window.paperlike!.ui.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
    await page.keyboard.press('Meta+=');
    expect(await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom)).toBeCloseTo(1.25, 5);
    await page.keyboard.press('Meta+-');
    expect(await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom)).toBeCloseTo(1, 5);
  });

  test('zoom never escapes its limits, however hard it is pressed', async ({ page }) => {
    for (let i = 0; i < 40; i++) await page.keyboard.press('-');
    expect(await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom)).toBeGreaterThanOrEqual(0.02);
    for (let i = 0; i < 80; i++) await page.keyboard.press('+');
    expect(await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom)).toBeLessThanOrEqual(64);
    await page.keyboard.press('Shift+0');
    expect(await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom)).toBe(1);
  });

  test('⇧2 frames the selection, and the menu offers the same commands', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'FarAway', x: 2400, y: 1800, w: 200, h: 150 });
    await select(page, [id]);
    await page.keyboard.press('Shift+2');

    // the layer is on screen — before, "zoom to selection" did not exist at all
    const box = await page.locator(`[data-node-id="${id}"]`).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThan(0);
    expect(box!.y).toBeGreaterThan(0);

    const readout = page.getByTitle('Zoom');
    await readout.click();
    await expect(page.getByRole('option', { name: /Zoom in/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Zoom to selection/ })).toBeVisible();
    await page.getByRole('option', { name: /Zoom to 100%/ }).click();
    expect(await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom)).toBe(1);

    await removeNodes(page, [id]);
  });

  test('typing a minus in a field does not zoom the canvas', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'TypeHere', x: 60, y: 560, w: 120, h: 90 });
    await select(page, [id]);
    const zoom = await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom);

    const field = page.locator('.fig-input input').first();
    await field.click();
    await page.keyboard.press('-');
    await page.keyboard.press('+');
    expect(await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom)).toBe(zoom);

    await page.keyboard.press('Escape');
    await removeNodes(page, [id]);
  });
});

