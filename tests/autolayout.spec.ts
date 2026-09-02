import { expect, test } from '@playwright/test';
import { dragBy, doc, openEditor, removeNodes, select } from './helpers';

/**
 * Auto layout, against what the browser actually laid out.
 *
 * Every assertion here reads a rendered box or a computed style rather than the
 * document, because the bugs these cover were all cases where the document said
 * one thing and the canvas drew another: a negative gap the CSS threw away, a
 * "Fill container" child that came out 0px wide inside a grid, a baseline rule
 * applied down a column where it means nothing.
 */

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

/** The rendered box of a node, in CSS pixels, at the fixed test zoom of 1. */
async function boxOf(page: import('@playwright/test').Page, id: string) {
  const box = await page.locator(`[data-node-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`no box for ${id}`);
  return box;
}

function styleOf(page: import('@playwright/test').Page, id: string, prop: string) {
  return page.evaluate(
    ({ id, prop }) => {
      const el = document.querySelector(`[data-node-id="${id}"]`);
      return el ? getComputedStyle(el).getPropertyValue(prop) : null;
    },
    { id, prop },
  );
}

/** A frame with `flex`, and `count` plain children in it. */
async function frameWith(
  page: import('@playwright/test').Page,
  name: string,
  flex: Record<string, unknown>,
  kids: Record<string, unknown>[],
) {
  return page.evaluate(
    ({ name, flex, kids }) => {
      const store = window.paperlike!.store;
      const frame = store.create('frame', 'root', {
        name, x: 200, y: 500, w: 400, h: 200, fill: '#FFFFFF', flex,
      } as never);
      const ids = kids.map((extra, index) =>
        store.create('rect', frame, {
          name: `${name}-${index}`, w: 40, h: 40, fill: '#4CC3F0', ...extra,
        } as never),
      );
      store.commit();
      return { frame, ids };
    },
    { name, flex, kids },
  );
}

const STACK = {
  mode: 'flex', direction: 'row', padding: [0, 0, 0, 0],
  align: 'start', justify: 'start', wrap: false,
};
const GRID = {
  mode: 'grid', direction: 'row', gap: 0, crossGap: 0, padding: [0, 0, 0, 0],
  align: 'stretch', justify: 'start', wrap: false,
};

/**
 * Negative spacing is how a stack of overlapping avatars is built, and it is
 * the reason the Canvas-stacking control exists at all. CSS `gap` refuses a
 * negative length and drops the whole declaration, so this used to read as no
 * gap whatever number was typed.
 */
test('a negative gap overlaps the children instead of being thrown away', async ({ page }) => {
  const built = await frameWith(page, 'NegGap', { ...STACK, gap: -20 }, [
    { w: 60, h: 60 }, { w: 60, h: 60 },
  ]);
  const [a, b] = [await boxOf(page, built.ids[0]), await boxOf(page, built.ids[1])];
  // 60 wide, pulled 20 back over its neighbour
  expect(Math.round(b.x - a.x)).toBe(40);
  expect(await styleOf(page, built.ids[1], 'margin-left')).toBe('-20px');
  // and the frame keeps a legal gap rather than an ignored one
  expect(await styleOf(page, built.frame, 'column-gap')).toBe('0px');
  await removeNodes(page, [built.frame]);
});

test('a positive gap is still spacing, not a margin', async ({ page }) => {
  const built = await frameWith(page, 'PosGap', { ...STACK, gap: 24 }, [
    { w: 60, h: 60 }, { w: 60, h: 60 },
  ]);
  const [a, b] = [await boxOf(page, built.ids[0]), await boxOf(page, built.ids[1])];
  expect(Math.round(b.x - a.x)).toBe(84);
  expect(await styleOf(page, built.ids[1], 'margin-left')).toBe('0px');
  await removeNodes(page, [built.frame]);
});

/**
 * A grid places its children in tracks, so `flex: 1 1 0` means nothing to one.
 * A child set to "Fill container" got no width rule at all and collapsed to
 * zero — an invisible layer in a layout that looked empty.
 */
test('a child set to fill fills its grid cell rather than collapsing to nothing', async ({ page }) => {
  const built = await frameWith(page, 'GridFill', { ...GRID, columns: 2, rows: 0 }, [
    { wMode: 'fill', hMode: 'fill' }, { wMode: 'fill', hMode: 'fill' },
  ]);
  const first = await boxOf(page, built.ids[0]);
  expect(Math.round(first.width)).toBe(200);
  expect(Math.round(first.height)).toBe(200);
  await removeNodes(page, [built.frame]);
});

test('a grid column can be fixed while the others take what is left', async ({ page }) => {
  const built = await frameWith(
    page,
    'GridTracks',
    {
      ...GRID, columns: 2, rows: 0,
      columnTracks: [{ mode: 'fixed', value: 120 }, { mode: 'fill' }],
    },
    [{ wMode: 'fill', hMode: 'fill' }, { wMode: 'fill', hMode: 'fill' }],
  );
  expect(Math.round((await boxOf(page, built.ids[0])).width)).toBe(120);
  expect(Math.round((await boxOf(page, built.ids[1])).width)).toBe(280);
  expect(await styleOf(page, built.frame, 'grid-template-columns')).toBe('120px 280px');
  await removeNodes(page, [built.frame]);
});

test('a fill track takes its share by weight, so 1fr beside 2fr is a third', async ({ page }) => {
  const built = await frameWith(
    page,
    'GridWeights',
    {
      ...GRID, columns: 2, rows: 0,
      columnTracks: [{ mode: 'fill', value: 1 }, { mode: 'fill', value: 3 }],
    },
    [{ wMode: 'fill', hMode: 'fill' }, { wMode: 'fill', hMode: 'fill' }],
  );
  expect(Math.round((await boxOf(page, built.ids[0])).width)).toBe(100);
  expect(Math.round((await boxOf(page, built.ids[1])).width)).toBe(300);
  await removeNodes(page, [built.frame]);
});

test('a grid child spans the columns it is given', async ({ page }) => {
  const built = await frameWith(page, 'GridSpan', { ...GRID, columns: 2, rows: 2 }, [
    { wMode: 'fill', hMode: 'fill' },
    { wMode: 'fill', hMode: 'fill' },
    { wMode: 'fill', hMode: 'fill', gridColumnSpan: 2 },
  ]);
  expect(Math.round((await boxOf(page, built.ids[2])).width)).toBe(400);
  expect(await styleOf(page, built.ids[2], 'grid-column')).toBe('span 2');
  await removeNodes(page, [built.frame]);
});

test('a grid child put in a named cell goes there, and leaves the others alone', async ({ page }) => {
  const built = await frameWith(page, 'GridCell', { ...GRID, columns: 2, rows: 2 }, [
    { wMode: 'fill', hMode: 'fill', gridColumn: 2, gridRow: 2 },
  ]);
  const frame = await boxOf(page, built.frame);
  const only = await boxOf(page, built.ids[0]);
  // the second column and the second row, so the far corner of the frame
  expect(Math.round(only.x - frame.x)).toBe(200);
  expect(Math.round(only.y - frame.y)).toBe(100);
  await removeNodes(page, [built.frame]);
});

/**
 * A baseline is a cross-axis rule about text, so it only means anything while
 * the cross axis is the vertical one. On a column it used to overwrite the
 * frame's own cross-axis alignment with a rule that could not apply.
 */
test('text baseline alignment is honoured on a row and ignored down a column', async ({ page }) => {
  const row = await frameWith(
    page,
    'BaseRow',
    { ...STACK, gap: 8, align: 'center', baseline: true },
    [{ w: 60, h: 60 }],
  );
  expect(await styleOf(page, row.frame, 'align-items')).toBe('baseline');
  await removeNodes(page, [row.frame]);

  const column = await frameWith(
    page,
    'BaseCol',
    { ...STACK, direction: 'column', gap: 8, align: 'center', baseline: true },
    [{ w: 60, h: 60 }],
  );
  // the frame's own alignment survives rather than being replaced
  expect(await styleOf(page, column.frame, 'align-items')).toBe('center');
  await removeNodes(page, [column.frame]);
});

test('the baseline control is greyed on a column, where Figma disables it', async ({ page }) => {
  const built = await frameWith(page, 'BaseUI', { ...STACK, direction: 'column', gap: 8 }, [
    { w: 60, h: 60 },
  ]);
  await select(page, [built.frame]);
  await page.locator('.fig-btn[title="Advanced layout settings"]').click();
  const group = page.locator('.fig-seg[data-disabled]');
  await expect(group).toHaveCount(1);
  await expect(group.locator('button').first()).toBeDisabled();
  await page.keyboard.press('Escape');
  await removeNodes(page, [built.frame]);
});

/**
 * A grid frame used to get no on-canvas layout chrome at all: `FlexHandles`
 * bailed out before drawing anything, so the padding you can drag on every
 * stack was unreachable the moment the flow became a grid.
 */
test('a grid frame gets its padding bands and both families of gutter', async ({ page }) => {
  const built = await frameWith(
    page,
    'GridChrome',
    { ...GRID, columns: 2, rows: 2, gap: 12, crossGap: 12, padding: [16, 16, 16, 16] },
    [{}, {}, {}, {}],
  );
  await select(page, [built.frame]);
  await expect(page.locator('.fig-flex-pad')).toHaveCount(4);
  // one space between the two columns, one between the two rows
  await expect(page.locator('.fig-flex-gap')).toHaveCount(2);
  await removeNodes(page, [built.frame]);
});

test("dragging a grid's row gutter changes the space between rows, not between columns", async ({ page }) => {
  const built = await frameWith(
    page,
    'GridDrag',
    { ...GRID, columns: 2, rows: 2, gap: 10, crossGap: 10, padding: [0, 0, 0, 0] },
    [
      { wMode: 'fill', hMode: 'fill' }, { wMode: 'fill', hMode: 'fill' },
      { wMode: 'fill', hMode: 'fill' }, { wMode: 'fill', hMode: 'fill' },
    ],
  );
  await select(page, [built.frame]);
  // the row gutter runs across, so its grip is the wide-and-short one
  const grip = page.locator(".fig-flex-gap[data-axis='x']");
  await expect(grip).toHaveCount(1);
  const at = await grip.boundingBox();
  await dragBy(page, { x: at!.x + at!.width / 2, y: at!.y + at!.height / 2 }, { x: 0, y: 20 });

  const nodes = await doc(page);
  expect(nodes[built.frame].flex!.crossGap).toBe(30);
  // the column gap is untouched — the two are different numbers
  expect(nodes[built.frame].flex!.gap).toBe(10);
  await removeNodes(page, [built.frame]);
});

/**
 * The panel has to offer what the canvas can do. A stack takes negative
 * spacing; a grid and a wrapping row cannot draw it, so their field stops at 0.
 */
test('the gap field takes a negative number on a stack and refuses one on a grid', async ({ page }) => {
  const stack = await frameWith(page, 'GapMinStack', { ...STACK, gap: 0 }, [{}, {}]);
  await select(page, [stack.frame]);
  const field = page.locator('.fig-section', { hasText: 'Layout' }).locator('input').nth(0);
  await field.fill('-16');
  await field.press('Enter');
  expect((await doc(page))[stack.frame].flex!.gap).toBe(-16);
  await removeNodes(page, [stack.frame]);

  const grid = await frameWith(page, 'GapMinGrid', { ...GRID, columns: 2, rows: 0, gap: 0 }, [{}, {}]);
  await select(page, [grid.frame]);
  // the columns/rows counts come first on a grid, so the gap is the third field
  const gridField = page.locator('.fig-section', { hasText: 'Layout' }).locator('input').nth(2);
  await gridField.fill('-16');
  await gridField.press('Enter');
  expect((await doc(page))[grid.frame].flex!.gap).toBe(0);
  await removeNodes(page, [grid.frame]);
});

/**
 * Two controls that were drawn and wired to nothing. The main-menu glyph is the
 * worse of the pair: it carried `aria-haspopup="menu"` and no handler, which is
 * the one combination that promises a menu and never opens one.
 */
test('the main menu button opens the app menu, grouped as Figma groups it', async ({ page }) => {
  // the menu lives on the collapsed island, so put the sidebar away first
  await page.evaluate(() => {
    const ui = window.paperlike!.ui.getState();
    if (ui.leftPanel) ui.toggleLeftPanel();
  });
  const button = page.locator('button[aria-label="Main menu"]');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();

  const menu = page.locator('[role="menu"]').last();
  for (const group of ['File', 'Edit', 'View', 'Object', 'Help']) {
    await expect(menu.getByRole('menuitem', { name: new RegExp(`^${group}`) })).toBeVisible();
  }
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  // and a row inside one of them actually runs: View ▸ Zoom to 100%
  await menu.getByRole('menuitem', { name: /^View/ }).hover();
  await page.getByRole('menuitem', { name: /Zoom to 100%/ }).click();
  expect(await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom)).toBe(1);
});

test('Escape closes the main menu and leaves the button unpressed', async ({ page }) => {
  await page.evaluate(() => {
    const ui = window.paperlike!.ui.getState();
    if (ui.leftPanel) ui.toggleLeftPanel();
  });
  const button = page.locator('button[aria-label="Main menu"]');
  await button.click();
  await expect(page.getByRole('menuitem', { name: /^Object/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: /^Object/ })).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});
