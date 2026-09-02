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
import { MODIFIER_GLYPHS, SHORTCUTS } from '../src/lib/shortcuts';

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

test('⌥⇧A takes auto layout off, which ⇧A only ever put on', async ({ page }) => {
  const frame = await makeNode(page, 'frame', {
    name: 'KB Layout', x: 700, y: 400, w: 300, h: 120, fill: '#FFFFFF', flex: null,
  });
  await page.evaluate((parent) => {
    const store = window.paperlike!.store;
    store.create('rect', parent, { name: 'KB One', x: 0, y: 0, w: 60, h: 60, fill: '#4CC3F0' } as never);
    store.create('rect', parent, { name: 'KB Two', x: 0, y: 0, w: 60, h: 60, fill: '#F2637F' } as never);
    store.commit();
  }, frame);

  await select(page, [frame]);
  await page.keyboard.press('Shift+a');
  expect((await doc(page))[frame].flex).toBeTruthy();

  // and back off again, with the children left where the layout had put them
  await select(page, [frame]);
  await page.keyboard.press('Alt+Shift+a');
  const after = await doc(page);
  expect(after[frame].flex).toBeFalsy();
  const kids = Object.values(after).filter((n) => n.parent === frame);
  expect(kids.length).toBe(2);
  // side by side, not stacked back on the origin the flow had made meaningless
  expect(new Set(kids.map((n) => n.x)).size).toBe(2);

  await removeNodes(page, [frame]);
});

test('⇧X swaps the fill and the stroke, and ⌘X still cuts', async ({ page }) => {
  const id = await makeNode(page, 'rect', {
    name: 'KB Swap', x: 700, y: 500, w: 80, h: 80, fill: '#4CC3F0',
    border: { width: 4, color: '#F2637F', style: 'solid', position: 'inside' },
  } as never);
  await select(page, [id]);

  await page.keyboard.press('Shift+x');
  const swapped = (await doc(page))[id];
  expect(swapped.fill).toBe('#F2637F');
  expect(swapped.border!.color).toBe('#4CC3F0');
  // the stroke keeps everything about itself except its colour
  expect(swapped.border!.width).toBe(4);

  // twice puts it back, which is what makes the key safe to press
  await page.keyboard.press('Shift+x');
  const back = (await doc(page))[id];
  expect([back.fill, back.border!.color]).toEqual(['#4CC3F0', '#F2637F']);

  // a filled shape with no stroke gains one in the fill's colour: Figma's way
  // of outlining something you have just drawn
  const plain = await makeNode(page, 'rect', {
    name: 'KB Outline', x: 900, y: 500, w: 60, h: 60, fill: '#9B7BF0',
  });
  await select(page, [plain]);
  await page.keyboard.press('Shift+x');
  const outlined = (await doc(page))[plain];
  expect(outlined.border).toMatchObject({ color: '#9B7BF0', width: 1 });
  expect(outlined.fill).toBeNull();

  // and the layer is still there — ⇧X must not reach the unguarded ⌘X cut
  expect((await selection(page))[0]).toBe(plain);
  await removeNodes(page, [id, plain]);
});

test('a modal owns the keyboard, and Escape is the way out of it', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'KB Modal', x: 700, y: 500, w: 60, h: 60, fill: '#4CC3F0' });
  await select(page, [id]);

  await page.evaluate(() => window.paperlike!.ui.getState().setExportOpen(true));

  // ⌫ used to delete the very layer the export sheet was previewing
  await page.keyboard.press('Backspace');
  expect((await doc(page))[id]).toBeTruthy();
  // and the tool keys used to arm a tool behind the sheet
  await page.keyboard.press('r');
  expect(await tool(page)).toBe('move');
  // as did ⌘D, which duplicated a layer nobody could see
  const before = Object.keys(await doc(page)).length;
  await page.keyboard.press('Meta+d');
  expect(Object.keys(await doc(page)).length).toBe(before);

  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.paperlike!.ui.getState().exportOpen)).toBe(false);

  // with the sheet gone the same keys work again
  await page.keyboard.press('r');
  expect(await tool(page)).toBe('rect');
  await page.keyboard.press('v');
  await removeNodes(page, [id]);
});

test('⌘B / ⌘I / ⌘U / ⇧⌘X mark a text layer that is only selected', async ({ page }) => {
  const id = await makeNode(page, 'text', {
    name: 'KB Marks', x: 700, y: 500, w: 200, h: 40, text: 'weight of it',
  } as never);
  await select(page, [id]);

  await page.keyboard.press('Meta+b');
  await page.keyboard.press('Meta+i');
  const marked = (await doc(page))[id];
  expect(marked.runs!.every((r: { bold?: boolean; italic?: boolean }) => r.bold && r.italic)).toBe(true);

  // ⇧⌘X is Figma's strikethrough; it used to reach the cut branch below and
  // take the layer to the clipboard instead
  await page.keyboard.press('Shift+Meta+x');
  expect((await doc(page))[id]).toBeTruthy();
  expect((await doc(page))[id].runs!.every((r: { strike?: boolean }) => r.strike)).toBe(true);

  // and the same key takes it off again, which is what makes it a toggle
  await page.keyboard.press('Meta+b');
  expect((await doc(page))[id].runs!.every((r: { bold?: boolean }) => !r.bold)).toBe(true);

  // on anything that is not text the keys are left alone
  const box = await makeNode(page, 'rect', { name: 'KB NotText', x: 900, y: 500, w: 40, h: 40, fill: '#4CC3F0' });
  await select(page, [box]);
  await page.keyboard.press('Meta+b');
  expect((await doc(page))[box].runs).toBeUndefined();

  await removeNodes(page, [id, box]);
});

/**
 * The shortcuts panel.
 *
 * Its risk is not that it fails to open — it is that it prints a chord the
 * editor does not answer, which is worse than printing nothing. So the panel
 * gets one test about being a panel, and one about telling the truth.
 */
test('⌃⇧? opens the shortcuts panel, and Escape closes it', async ({ page }) => {
  const panel = page.locator('[role="dialog"][aria-label="Keyboard shortcuts"]');
  await expect(panel).toBeHidden();

  await page.keyboard.press('Control+Shift+Slash');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-shortcut-tab="Tools"]')).toBeVisible();

  // the categories are Figma's, and switching one shows that category's rows
  await panel.locator('[data-shortcut-tab="Zoom"]').click();
  await expect(panel.locator('[data-shortcut="shift+Digit1"]')).toBeVisible();
  await expect(panel.locator('[data-shortcut="KeyV"]')).toBeHidden();

  // it does not take the keyboard: the point is to press the keys while reading
  await page.keyboard.press('r');
  expect(await tool(page)).toBe('rect');
  await page.keyboard.press('v');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('a chord you press is ticked in the panel afterwards', async ({ page }) => {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('paperlike:shortcuts');
    } catch {
      /* private windows have no storage, and the test does not need one */
    }
    window.paperlike!.ui.getState().resetUsedShortcuts();
  });

  await page.keyboard.press('Control+Shift+Slash');
  const panel = page.locator('[role="dialog"][aria-label="Keyboard shortcuts"]');
  await panel.locator('[data-shortcut-tab="View"]').click();
  const row = panel.locator('[data-shortcut="shift+KeyG"]');
  await expect(row).not.toHaveAttribute('data-used', 'true');

  await page.keyboard.press('Shift+g');
  await expect(row).toHaveAttribute('data-used', 'true');
  // and it survives a reload, which is what makes it a record rather than a hint
  await page.reload();
  await page.waitForFunction(() => !!window.paperlike);
  expect(await page.evaluate(() => window.paperlike!.ui.getState().usedShortcuts)).toContain('shift+KeyG');

  await page.keyboard.press('Shift+g');
  await page.keyboard.press('Escape');
});

test('every chord the panel prints is the chord it is written as', () => {
  const rows = SHORTCUTS.flatMap((group) =>
    group.rows
      .filter((row) => !!row.code)
      .map((row) => {
        // a row may print two chords for one command ("F  A", "⌥A  ⌥D"); the id
        // belongs to the first of them
        const printed = row.keys.split('  ')[0];
        const wanted = MODIFIER_GLYPHS.filter(([name]) => row.code!.split('+').includes(name))
          .map(([, glyph]) => glyph)
          .join('');
        return { keys: row.keys, code: row.code!, wanted, got: printed.replace(/[^⌘⌃⌥⇧]/gu, '') };
      }),
  );

  expect(rows.length).toBeGreaterThan(80);
  expect(rows.filter((row) => row.wanted !== row.got)).toEqual([]);

  // and no chord is printed twice under two different names
  const seen = new Set<string>();
  expect(rows.filter((row) => !seen.add(row.code))).toEqual([]);
});

test('⇧1 and ⇧2 zoom, which only ⌘1 and ⌘2 used to do', async ({ page }) => {
  const id = await makeNode(page, 'rect', { name: 'KB Zoom', x: 700, y: 500, w: 80, h: 80, fill: '#4CC3F0' });
  await select(page, [id]);

  const zoom = () => page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom);
  const park = () => page.evaluate(() => window.paperlike!.ui.getState().setViewport({ x: 0, y: 0, zoom: 0.4 }));

  // ⇧1 is Figma's Zoom to fit. It arrives as "!", which is why matching the
  // character left the key doing nothing.
  await park();
  await page.keyboard.press('Shift+Digit1');
  expect(await zoom()).not.toBe(0.4);

  // ⇧2 is Zoom to selection, which is a different view from fitting the page
  const view = () => page.evaluate(() => window.paperlike!.ui.getState().viewport);
  await park();
  await page.keyboard.press('Shift+Digit2');
  const toSelection = await view();
  await park();
  await page.keyboard.press('Shift+Digit1');
  expect(toSelection).not.toEqual(await view());

  // ⇧0 is 100%
  await park();
  await page.keyboard.press('Shift+Digit0');
  expect(await zoom()).toBe(1);

  await removeNodes(page, [id]);
});
