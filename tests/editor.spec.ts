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
    let node = (await doc(page))[button];
    expect(node.interactions).toHaveLength(1);
    expect(node.interactions![0].trigger).toBe('click');

    // point it at the second frame through the panel's own control
    await page.locator('.fig-interaction button', { hasText: 'Pick a frame' }).click();
    await page.getByRole('listbox').getByRole('button', { name: 'Second' }).click();

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
    await page.locator('.fig-interaction .fig-input').first().click();

    const option = page.getByRole('listbox').getByRole('button', { name: 'While hovering' });
    expect(await option.evaluate((el) => getComputedStyle(el as HTMLElement).paddingLeft)).toBe('8px');
    // the icon buttons beside it stay square
    const icon = page.locator('.fig-interaction .fig-btn:not([data-text])').first();
    const box = (await icon.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(28);
  });
});
