import { expect, test, type Page } from '@playwright/test';
import { doc, dragBy, makeNode, nodeNamed, openEditor, select } from './helpers';

/**
 * The timeline, driven the way it is used.
 *
 * The model has its own suite (`motion.spec.ts`); this one is about the panel
 * and the canvas: that a chip writes a key, that a scrub moves what you see,
 * that an edit made while the timeline is open lands on the timeline, and that
 * playing is a real animation the browser is running rather than a picture of
 * one.
 */

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const boardId = async (page: Page): Promise<string> => (await nodeNamed(page, 'Fixture Board'))!.id;
const coverId = async (page: Page): Promise<string> => (await nodeNamed(page, 'Cover'))!.id;

function openTimeline(page: Page, frame: string): Promise<void> {
  return page.evaluate((id) => window.paperlike!.ui.getState().openMotion(id), frame);
}

function motionUI(page: Page) {
  return page.evaluate(() => window.paperlike!.ui.getState().motion);
}

function setAt(page: Page, at: number): Promise<void> {
  return page.evaluate((ms) => window.paperlike!.ui.getState().setMotionAt(ms), at);
}

async function timelineOf(page: Page, frame: string) {
  return (await doc(page))[frame].motion;
}

/** A layer with two keys on it: x from 0 to 200 across the whole second. */
async function animate(page: Page): Promise<{ board: string; cover: string }> {
  const board = await boardId(page);
  const cover = await coverId(page);
  await page.evaluate(
    ([frame, node]) => {
      const store = window.paperlike!.store;
      store.ensureMotion(frame, { duration: 1000, loop: true });
      store.setKeyframe(frame, node, 'x', 0, 0, { easing: 'linear' });
      store.setKeyframe(frame, node, 'x', 1000, 200, { easing: 'linear' });
      store.commit();
    },
    [board, cover] as const,
  );
  return { board, cover };
}

/** What the browser has actually resolved the layer to, animation and all. */
function computed(page: Page, id: string, property: string): Promise<string> {
  return page.evaluate(
    ([nodeId, prop]) => {
      const el = document.querySelector(`[data-canvas-root] div[data-node-id="${nodeId}"]`);
      return el ? getComputedStyle(el).getPropertyValue(prop) : '';
    },
    [id, property] as const,
  );
}

test.describe('the timeline panel', () => {
  test('⇧M opens it on the board the selection is on, and Escape closes it', async ({ page }) => {
    const board = await boardId(page);
    await select(page, [await coverId(page)]);

    await page.locator('[data-canvas-root]').click({ position: { x: 500, y: 500 } });
    await select(page, [await coverId(page)]);
    await page.keyboard.press('Shift+M');

    const panel = page.locator('.mo-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-frame', board);
    // it opens armed: an edit made now is meant for the timeline
    expect((await motionUI(page)).recording).toBe(true);

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('a property chip writes the first keyframe at the playhead', async ({ page }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await select(page, [cover]);
    await openTimeline(page, board);
    await setAt(page, 400);

    await page.locator('.mo-chip', { hasText: 'Rotation' }).click();

    const spec = await timelineOf(page, board);
    expect(spec!.tracks).toHaveLength(1);
    expect(spec!.tracks[0].property).toBe('rotation');
    expect(spec!.tracks[0].node).toBe(cover);
    expect(spec!.tracks[0].keys).toHaveLength(1);
    expect(spec!.tracks[0].keys[0].at).toBe(400);
    // the value it takes is what the layer reads there now
    expect(spec!.tracks[0].keys[0].value).toBe(0);

    // and the chip lights, because the property now has a track
    await expect(page.locator('.mo-chip', { hasText: 'Rotation' })).toHaveAttribute('data-on', 'true');
    // the lane and its name are drawn
    await expect(page.locator('.mo-track-name', { hasText: 'Rotation' })).toBeVisible();
    await expect(page.locator('.mo-key')).toHaveCount(1);
  });

  test('the canvas shows the frame the playhead is on', async ({ page }) => {
    const { board, cover } = await animate(page);
    await openTimeline(page, board);

    await setAt(page, 0);
    await expect.poll(() => computed(page, cover, 'left')).toBe('0px');

    await setAt(page, 500);
    // halfway along a linear track between 0 and 200
    await expect.poll(() => computed(page, cover, 'left')).toBe('100px');

    await setAt(page, 1000);
    await expect.poll(() => computed(page, cover, 'left')).toBe('200px');
  });

  test('the selection chrome follows a scrub, and stands back while it plays', async ({ page }) => {
    const { board, cover } = await animate(page);
    await select(page, [cover]);
    await openTimeline(page, board);

    /** where the selection outline actually is, in screen pixels */
    const chromeLeft = async (): Promise<number> => {
      const handles = page.locator('[data-handle]').first();
      return (await handles.boundingBox())!.x;
    };
    const layerLeft = async (): Promise<number> =>
      (await page.locator(`[data-canvas-root] div[data-node-id="${cover}"]`).boundingBox())!.x;

    await setAt(page, 0);
    const chromeAtStart = await chromeLeft();
    const layerAtStart = await layerLeft();

    // scrubbed a long way along: the chrome has to have travelled with it, by
    // the same distance — the handle's own offset is not the point
    await setAt(page, 1000);
    const travelled = (await layerLeft()) - layerAtStart;
    expect(travelled).toBeGreaterThan(100);
    expect(Math.abs((await chromeLeft()) - chromeAtStart - travelled)).toBeLessThan(2);

    // and while it plays it stands back rather than chasing the animation
    await page.locator('.mo-btn[title="Play"]').click();
    await expect(page.locator('[data-handle]').first()).toBeHidden();
    await page.locator('.mo-btn[title="Pause"]').click();
    await expect(page.locator('[data-handle]').first()).toBeVisible();
  });

  test('closing the timeline gives the layer its own value back', async ({ page }) => {
    const { board, cover } = await animate(page);
    await openTimeline(page, board);
    await setAt(page, 500);
    await expect.poll(() => computed(page, cover, 'left')).toBe('100px');

    await page.evaluate(() => window.paperlike!.ui.getState().openMotion(null));
    // the design is what it always was — 40px, where the fixture put it
    await expect.poll(() => computed(page, cover, 'left')).toBe('40px');
  });

  test('the ruler scrubs', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    const ruler = page.locator('.mo-ruler');
    const box = (await ruler.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);

    const at = (await motionUI(page)).at;
    // a quarter of the way along a one-second timeline, give or take a pixel
    expect(at).toBeGreaterThan(200);
    expect(at).toBeLessThan(300);
  });

  test('the timeline zooms, and the lanes scroll when it does', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    const lanes = page.locator('.mo-lanes');
    const fitted = (await page.locator('.mo-field').first().boundingBox())!.width;
    await expect(page.locator('.mo-zoom-level')).toHaveText('Fit');

    await page.locator('.mo-btn[title="Zoom the timeline in"]').click();
    await expect(page.locator('.mo-zoom-level')).toHaveText('1.5×');

    // the lanes are wider than the panel now, and they scroll
    const stretched = (await page.locator('.mo-field').first().boundingBox())!.width;
    expect(stretched).toBeGreaterThan(fitted);
    const scrollable = await lanes.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(scrollable).toBe(true);

    // a time still means the same place: the last key sits at the end of the
    // stretched field, wherever that has scrolled to
    await lanes.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    const field = (await page.locator('.mo-field').first().boundingBox())!;
    const lastKey = (await page.locator('.mo-key').nth(1).boundingBox())!;
    expect(Math.abs(lastKey.x + lastKey.width / 2 - (field.x + field.width))).toBeLessThan(3);

    // and scrubbing at a zoom still reads the right moment
    const box = (await lanes.boundingBox())!;
    await page.mouse.click(box.x + box.width - 6, box.y + 12);
    expect((await motionUI(page)).at).toBeGreaterThan(900);

    await page.locator('.mo-zoom-level').click();
    await expect(page.locator('.mo-zoom-level')).toHaveText('Fit');
  });

  test('zooming holds the moment under the pointer still', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    const lanes = page.locator('.mo-lanes');
    const box = (await lanes.boundingBox())!;
    const at = box.x + box.width * 0.5;

    /** the screen x of the middle of the timeline right now */
    const midX = async (): Promise<number> => {
      const field = (await page.locator('.mo-field').first().boundingBox())!;
      return field.x + field.width * 0.5;
    };
    expect(Math.abs((await midX()) - at)).toBeLessThan(2);

    await page.mouse.move(at, box.y + 12);
    await page.keyboard.down('Meta');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Meta');

    await expect.poll(async () => (await motionUI(page)).zoom).toBeGreaterThan(1);
    // the moment that was under the pointer is still under the pointer
    expect(Math.abs((await midX()) - at)).toBeLessThan(6);
  });

  test('the playhead can be dragged along the lanes', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    const lanes = page.locator('.mo-lanes');
    const box = (await lanes.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.1, box.y + 12);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(box.x + box.width * (0.1 + 0.1 * step), box.y + 12);
    }
    await page.mouse.up();

    expect((await motionUI(page)).at).toBeGreaterThan(600);
  });
});

test.describe('recording', () => {
  test('an edit made while the timeline is open lands on the timeline', async ({ page }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await select(page, [cover]);
    await openTimeline(page, board);
    await setAt(page, 400);

    // the ordinary nudge — no motion-specific gesture at all
    await page.locator('[data-canvas-root]').press('ArrowRight');

    const spec = await timelineOf(page, board);
    const track = spec!.tracks.find((entry) => entry.property === 'x');
    expect(track).toBeDefined();
    expect(track!.keys).toHaveLength(1);
    expect(track!.keys[0].at).toBe(400);
    expect(track!.keys[0].value).toBe(41);
    // and the layer moved too, so the canvas at this moment agrees with itself
    expect((await doc(page))[cover].x).toBe(41);
  });

  test('dragging a layer on the canvas records where it went', async ({ page }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await select(page, [cover]);
    await openTimeline(page, board);
    await setAt(page, 300);

    // the fixture's Cover sits at 40,40 in a board at the world origin, and the
    // viewport is fixed — so this is a real drag on the real layer
    const box = (await page.locator(`[data-canvas-root] div[data-node-id="${cover}"]`).boundingBox())!;
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: 60, y: 40 });

    const after = await doc(page);
    const spec = after[board].motion!;
    const x = spec.tracks.find((track) => track.property === 'x')!;
    const y = spec.tracks.find((track) => track.property === 'y')!;

    // one key each, at the playhead — the drag wrote to the same moment all
    // the way through rather than leaving a key per pointer move
    expect(x.keys).toHaveLength(1);
    expect(y.keys).toHaveLength(1);
    expect(x.keys[0].at).toBe(300);
    expect(Number(x.keys[0].value)).toBeCloseTo(after[cover].x, 5);
    expect(Number(y.keys[0].value)).toBeCloseTo(after[cover].y, 5);
    expect(after[cover].x).toBeGreaterThan(40);
  });

  test('a nested edit keyframes only what moved', async ({ page }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await page.evaluate((id) => {
      window.paperlike!.store.update(id, {
        border: { width: 2, color: '#ff0000', style: 'solid', position: 'inside' },
      });
      window.paperlike!.store.commit();
    }, cover);
    await select(page, [cover]);
    await openTimeline(page, board);
    await setAt(page, 300);

    // a stroke is one object with a weight and a colour in it; changing the
    // weight must not also keyframe the colour that came along in the patch
    await page.evaluate((id) => {
      const node = window.paperlike!.doc()[id];
      window.paperlike!.store.update(id, { border: { ...node.border!, width: 8 } });
      window.paperlike!.store.commit();
    }, cover);

    const spec = await timelineOf(page, board);
    expect(spec!.tracks.map((track) => track.property)).toEqual(['strokeWidth']);
    expect(spec!.tracks[0].keys[0].value).toBe(8);
  });

  test('recording off leaves the timeline alone', async ({ page }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await select(page, [cover]);
    await openTimeline(page, board);
    await page.locator('.mo-record').click();
    expect((await motionUI(page)).recording).toBe(false);

    await page.locator('[data-canvas-root]').press('ArrowRight');

    expect(await timelineOf(page, board)).toBeFalsy();
    expect((await doc(page))[cover].x).toBe(41);
  });

  test('a second edit at the same moment rewrites the key rather than doubling it', async ({ page }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await select(page, [cover]);
    await openTimeline(page, board);
    await setAt(page, 250);

    await page.locator('[data-canvas-root]').press('ArrowRight');
    await page.locator('[data-canvas-root]').press('ArrowRight');
    await page.locator('[data-canvas-root]').press('ArrowRight');

    const track = (await timelineOf(page, board))!.tracks.find((entry) => entry.property === 'x');
    expect(track!.keys).toHaveLength(1);
    expect(track!.keys[0].value).toBe(43);
  });
});

test.describe('keyframes', () => {
  test('a keyframe drags along the lane', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    const keys = page.locator('.mo-key');
    await expect(keys).toHaveCount(2);
    const last = keys.nth(1);
    const from = (await last.boundingBox())!;
    const lanes = (await page.locator('.mo-lanes').boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
      await page.mouse.move(lanes.x + lanes.width * (1 - 0.25 * (step / 6)), from.y + from.height / 2);
    }
    await page.mouse.up();

    const track = (await timelineOf(page, board))!.tracks[0];
    const moved = track.keys[track.keys.length - 1];
    expect(moved.at).toBeGreaterThan(700);
    expect(moved.at).toBeLessThan(800);
    // the first key stayed where it was
    expect(track.keys[0].at).toBe(0);
  });

  test('a keyframe dropped onto another one replaces it rather than doubling up', async ({
    page,
  }) => {
    const { board, cover } = await animate(page);
    // a third key in the middle, to land on
    await page.evaluate(
      ([frame, node]) => {
        window.paperlike!.store.setKeyframe(frame, node, 'x', 500, 90, { easing: 'linear' });
        window.paperlike!.store.commit();
      },
      [board, cover] as const,
    );
    await openTimeline(page, board);
    await expect(page.locator('.mo-key')).toHaveCount(3);

    // drag the last key onto the middle one — snapping means it lands exactly
    const field = (await page.locator('.mo-lane[data-track] .mo-field').first().boundingBox())!;
    const last = page.locator('.mo-key').nth(2);
    const from = (await last.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 5; step++) {
      const x = from.x + from.width / 2 + ((field.x + field.width * 0.5 - (from.x + from.width / 2)) * step) / 5;
      await page.mouse.move(x, from.y + from.height / 2);
    }
    await page.mouse.up();

    const track = (await timelineOf(page, board))!.tracks[0];
    // two keys, not three: the one it landed on is gone, and the value that
    // survives is the one you were dragging
    expect(track.keys.map((key) => key.at)).toEqual([0, 500]);
    expect(track.keys[1].value).toBe(200);
    await expect(page.locator('.mo-key')).toHaveCount(2);
  });

  test('a selected keyframe is removed with ⌫, and the last one takes its track with it', async ({
    page,
  }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    await page.locator('.mo-key').nth(1).click();
    expect((await motionUI(page)).selected).toHaveLength(1);
    await page.keyboard.press('Backspace');
    await expect(page.locator('.mo-key')).toHaveCount(1);

    await page.locator('.mo-key').first().click();
    await page.keyboard.press('Backspace');
    await expect(page.locator('.mo-key')).toHaveCount(0);
    expect((await timelineOf(page, board))!.tracks).toHaveLength(0);
  });

  test('⌫ on a selected keyframe leaves the selected layer alone', async ({ page }) => {
    const { board, cover } = await animate(page);
    // the layer is selected on the canvas as well, which is the ordinary case:
    // you keyframed it, so it is what you have in your hand
    await select(page, [cover]);
    await openTimeline(page, board);

    await page.locator('.mo-key').first().click();
    await page.keyboard.press('Backspace');

    await expect(page.locator('.mo-key')).toHaveCount(1);
    // the layer is still there — ⌫ went to the keyframe, not to the design
    expect((await doc(page))[cover]).toBeTruthy();
  });

  test('a keyframe carries its own easing, and the menu sets it', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    // clicked, not scripted: the press must not knock the selection out from
    // under the menu it is opening
    await page.locator('.mo-key').first().click();
    await expect(page.locator('.mo-select')).toBeVisible();
    await page.locator('.mo-select').click();
    await page.locator('.mo-select').selectOption('bouncy');

    const track = (await timelineOf(page, board))!.tracks[0];
    expect(track.keys[0].easing).toBe('bouncy');
    // a spring is sampled into a CSS `linear()`, so the browser can run it
    const css = await page.locator('style[data-motion]').textContent();
    expect(css).toContain('animation-timing-function: linear(');
  });

  test('a custom bezier can be dragged, and the curve follows the numbers', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    await page.locator('.mo-key').first().click();
    // the editor only opens for an easing that has numbers behind it
    await expect(page.locator('.mo-curve-btn')).toBeDisabled();

    await page.locator('.mo-select').selectOption('custom-bezier');
    const track = () => timelineOf(page, board).then((spec) => spec!.tracks[0]);
    expect((await track()).keys[0].easing).toBe('custom-bezier');
    // it arrives with the four numbers it is made of
    expect((await track()).keys[0].bezier).toEqual([0.42, 0, 0.58, 1]);
    // and choosing it opened the editor
    await expect(page.locator('.mo-curve-pop')).toBeVisible();

    // typing a number moves the curve
    await page.locator('.mo-curve-nums .mo-num').first().fill('0.9');
    await expect.poll(async () => (await track()).keys[0].bezier![0]).toBe(0.9);

    // and so does dragging a handle
    const handle = page.locator('.mo-curve-pop circle').nth(1);
    const from = (await handle.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x - 30, from.y + 20);
    await page.mouse.move(from.x - 40, from.y + 26);
    await page.mouse.up();
    const after = (await track()).keys[0].bezier!;
    expect(after[2]).toBeLessThan(0.58);

    // what the browser is given is the curve those numbers describe
    const css = await page.locator('style[data-motion]').textContent();
    expect(css).toContain(`cubic-bezier(${after[0]}, ${after[1]}, ${after[2]}, ${after[3]})`);
  });

  test('a custom spring is three numbers, and they reach the stylesheet', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    await page.locator('.mo-key').first().click();
    await page.locator('.mo-select').selectOption('custom-spring');
    await expect(page.locator('.mo-curve-pop')).toBeVisible();

    const key = async () => (await timelineOf(page, board))!.tracks[0].keys[0];
    expect((await key()).spring).toEqual({ stiffness: 200, damping: 20, mass: 1 });

    await page.getByLabel('Stiffness').fill('600');
    await expect.poll(async () => (await key()).spring!.stiffness).toBe(600);

    // a spring has no CSS curve, so it is sampled into a `linear()` — the same
    // one the sampler walks
    const css = await page.locator('style[data-motion]').textContent();
    expect(css).toContain('animation-timing-function: linear(');
  });

  test('double-clicking a lane adds a key holding what the track reads there', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    const lane = page.locator('.mo-lane[data-track]').first();
    const box = (await lane.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

    const track = (await timelineOf(page, board))!.tracks[0];
    expect(track.keys).toHaveLength(3);
    const added = track.keys[1];
    expect(added.at).toBeGreaterThan(450);
    expect(added.at).toBeLessThan(550);
    // it holds the value the track already had there, so adding it changes nothing
    expect(Number(added.value)).toBeGreaterThan(90);
    expect(Number(added.value)).toBeLessThan(110);
  });

  test('⇧-click adds a keyframe to the selection, and they drag together', async ({ page }) => {
    const { board, cover } = await animate(page);
    // a second track, so the selection can span two lanes
    await page.evaluate(
      ([frame, node]) => {
        const store = window.paperlike!.store;
        store.setKeyframe(frame, node, 'opacity', 200, 1, { easing: 'linear' });
        store.setKeyframe(frame, node, 'opacity', 800, 0, { easing: 'linear' });
        store.commit();
      },
      [board, cover] as const,
    );
    await openTimeline(page, board);
    await expect(page.locator('.mo-key')).toHaveCount(4);

    // the first key of each track: x at 0 and opacity at 200
    const xKey = page.locator('.mo-lane[data-track]').first().locator('.mo-key').first();
    const oKey = page.locator('.mo-lane[data-track]').nth(1).locator('.mo-key').first();
    await xKey.click();
    await oKey.click({ modifiers: ['Shift'] });
    expect((await motionUI(page)).selected).toHaveLength(2);
    await expect(page.locator('.mo-key[data-on="true"]')).toHaveCount(2);

    // dragging one of them carries the other by the same amount
    const before = (await timelineOf(page, board))!;
    const from = (await oKey.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 5; step++) {
      await page.mouse.move(from.x + from.width / 2 + (120 * step) / 5, from.y + from.height / 2);
    }
    await page.mouse.up();

    const after = (await timelineOf(page, board))!;
    const timeOf = (spec: typeof after, property: string, index: number) =>
      spec.tracks.find((track) => track.property === property)!.keys[index].at;
    const moved = timeOf(after, 'opacity', 0) - timeOf(before, 'opacity', 0);
    expect(moved).toBeGreaterThan(100);
    // the x key travelled exactly as far, and the keys nobody selected did not
    expect(timeOf(after, 'x', 0) - timeOf(before, 'x', 0)).toBe(moved);
    expect(timeOf(after, 'x', 1)).toBe(timeOf(before, 'x', 1));
  });

  test('a band drawn over the lanes selects the keyframes it crosses', async ({ page }) => {
    const { board, cover } = await animate(page);
    await page.evaluate(
      ([frame, node]) => {
        const store = window.paperlike!.store;
        store.setKeyframe(frame, node, 'opacity', 200, 1);
        store.setKeyframe(frame, node, 'opacity', 800, 0);
        store.commit();
      },
      [board, cover] as const,
    );
    await openTimeline(page, board);

    const lanes = (await page.locator('.mo-lane[data-track]').first().boundingBox())!;
    const field = (await page.locator('.mo-lane[data-track] .mo-field').first().boundingBox())!;
    // a band over the left half of both lanes: the keys at 0 and at 200
    await page.mouse.move(field.x - 4, lanes.y - 2);
    await page.mouse.down();
    for (let step = 1; step <= 5; step++) {
      await page.mouse.move(field.x + field.width * 0.3 * (step / 5), lanes.y + 46);
    }
    await expect(page.locator('.mo-band')).toBeVisible();
    await page.mouse.up();

    expect((await motionUI(page)).selected).toHaveLength(2);
    await expect(page.locator('.mo-band')).toHaveCount(0);

    // and ⌫ takes all of them
    await page.keyboard.press('Backspace');
    await expect(page.locator('.mo-key')).toHaveCount(2);
    // the layer is untouched, as ever
    expect((await doc(page))[cover]).toBeTruthy();
  });

  test('⌘C and ⌘V put a copy of the keyframes at the playhead', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    await page.locator('.mo-key').first().click();
    await page.keyboard.press('Meta+c');
    await setAt(page, 400);
    await page.keyboard.press('Meta+v');

    const track = (await timelineOf(page, board))!.tracks[0];
    expect(track.keys.map((key) => key.at)).toEqual([0, 400, 1000]);
    // the paste holds what was copied, and is what is selected afterwards
    expect(track.keys[1].value).toBe(0);
    expect((await motionUI(page)).selected).toHaveLength(1);
    expect((await motionUI(page)).selected[0].key).toBe(track.keys[1].id);
  });

  test('a copy keeps the spacing between the keyframes in it', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    // both keys, 0 and 1000 apart
    await page.locator('.mo-key').first().click();
    await page.locator('.mo-key').nth(1).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Meta+c');

    await page.locator('.mo-num').fill('3000');
    await page.locator('.mo-num').press('Enter');
    // out of the field first: ⌘V inside a text input belongs to the input
    await page.locator('.mo-clock').click();
    await setAt(page, 1500);
    await page.keyboard.press('Meta+v');

    const track = (await timelineOf(page, board))!.tracks[0];
    // the pair landed at the playhead, still a second apart
    expect(track.keys.map((key) => key.at)).toEqual([0, 1000, 1500, 2500]);
  });

  test('the clipboard belongs to the timeline while it has a selection', async ({ page }) => {
    const { board, cover } = await animate(page);
    await select(page, [cover]);
    await openTimeline(page, board);
    const before = Object.keys(await doc(page)).length;

    await page.locator('.mo-key').first().click();
    await page.keyboard.press('Meta+c');
    await setAt(page, 500);
    await page.keyboard.press('Meta+v');

    // a keyframe was pasted, not a copy of the layer
    expect(Object.keys(await doc(page))).toHaveLength(before);
    expect((await timelineOf(page, board))!.tracks[0].keys).toHaveLength(3);
  });

  test('a track can be dropped from the panel', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    await page.locator('.mo-track-name').hover();
    await page.locator('.mo-drop').click();
    expect((await timelineOf(page, board))!.tracks).toHaveLength(0);
    await expect(page.locator('.mo-key')).toHaveCount(0);
  });
});

test.describe('the timeline against the canvas', () => {
  test('a property keyed only in the middle holds its ends on the canvas too', async ({ page }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await page.evaluate(
      ([frame, node]) => {
        const store = window.paperlike!.store;
        store.ensureMotion(frame, { duration: 1000, loop: true });
        // the layer's own x is 40; the track says 120 from 400ms and 60 at 800
        store.setKeyframe(frame, node, 'x', 400, 120, { easing: 'linear' });
        store.setKeyframe(frame, node, 'x', 800, 60, { easing: 'linear' });
        store.commit();
      },
      [board, cover] as const,
    );
    await openTimeline(page, board);

    // before the first key it is held there — not tweened out of the layer's
    // own 40px, which is what a bare CSS animation would have done
    await setAt(page, 0);
    await expect.poll(() => computed(page, cover, 'left')).toBe('120px');
    await setAt(page, 600);
    await expect.poll(() => computed(page, cover, 'left')).toBe('90px');
    await setAt(page, 1000);
    await expect.poll(() => computed(page, cover, 'left')).toBe('60px');
  });

  test("a star's fill really changes colour on the canvas", async ({ page }) => {
    const board = await boardId(page);
    const star = await page.evaluate((frame) => {
      const store = window.paperlike!.store;
      const id = store.create('star', frame, {
        name: 'Star', x: 300, y: 40, w: 120, h: 120, fill: '#FF0000',
      });
      store.ensureMotion(frame, { duration: 1000, loop: true });
      store.setKeyframe(frame, id, 'fill', 0, '#ff0000', { easing: 'linear' });
      store.setKeyframe(frame, id, 'fill', 1000, '#0000ff', { easing: 'linear' });
      store.commit();
      return id;
    }, board);
    await openTimeline(page, board);

    /** the colour of the clipped layer the star actually paints through */
    const paint = () =>
      page.evaluate(
        (id) => {
          const el = document.querySelector(`[data-canvas-root] [data-paint="${id}"]`);
          return el ? getComputedStyle(el).backgroundColor : '';
        },
        star,
      );

    await setAt(page, 0);
    await expect.poll(paint).toBe('rgb(255, 0, 0)');
    await setAt(page, 500);
    await expect.poll(paint).toBe('rgb(128, 0, 128)');
    await setAt(page, 1000);
    await expect.poll(paint).toBe('rgb(0, 0, 255)');
  });

  test('a stroke and a blur animate on the canvas too', async ({ page }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await page.evaluate(
      ([frame, node]) => {
        const store = window.paperlike!.store;
        store.update(node, {
          border: { width: 2, color: '#ff0000', style: 'solid', position: 'inside' },
          filters: { blur: 0, backdropBlur: 0, brightness: 1, contrast: 1, saturate: 1, grayscale: 0, hueRotate: 0 },
        });
        store.ensureMotion(frame, { duration: 1000, loop: true });
        store.setKeyframe(frame, node, 'strokeWidth', 0, 2, { easing: 'linear' });
        store.setKeyframe(frame, node, 'strokeWidth', 1000, 10, { easing: 'linear' });
        store.setKeyframe(frame, node, 'strokeColor', 0, '#ff0000', { easing: 'linear' });
        store.setKeyframe(frame, node, 'strokeColor', 1000, '#0000ff', { easing: 'linear' });
        store.setKeyframe(frame, node, 'blur', 0, 0, { easing: 'linear' });
        store.setKeyframe(frame, node, 'blur', 1000, 8, { easing: 'linear' });
        store.commit();
      },
      [board, cover] as const,
    );
    await openTimeline(page, board);

    await setAt(page, 0);
    await expect.poll(() => computed(page, cover, 'box-shadow')).toContain('inset');
    // the keyframe says `filter: none`, and the browser reads that as a zero
    // blur so that it has something to interpolate from — which is the whole
    // reason the compiler declares the property on every keyframe
    await expect.poll(() => computed(page, cover, 'filter')).toBe('blur(0px)');

    await setAt(page, 1000);
    // the ring is ten pixels wide and blue, and the layer is blurred
    await expect.poll(() => computed(page, cover, 'box-shadow')).toContain('10px');
    await expect.poll(() => computed(page, cover, 'box-shadow')).toContain('rgb(0, 0, 255)');
    await expect.poll(() => computed(page, cover, 'filter')).toBe('blur(8px)');

    // halfway is halfway, which is the browser doing the interpolating
    await setAt(page, 500);
    await expect.poll(() => computed(page, cover, 'filter')).toBe('blur(4px)');
  });

  test('a fill CSS cannot tween is offered as unavailable, not as broken', async ({ page }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await page.evaluate(
      (id) => {
        window.paperlike!.store.update(id, { fill: 'linear-gradient(#fff, #000)' });
        window.paperlike!.store.commit();
      },
      cover,
    );
    await select(page, [cover]);
    await openTimeline(page, board);

    const chip = page.locator('.mo-chip', { hasText: 'Fill' });
    await expect(chip).toBeDisabled();
    // a layer with no stroke has no stroke to animate, and says so
    await expect(page.locator('.mo-chip', { hasText: 'Stroke', hasNotText: 'colour' })).toBeDisabled();
    // and the ones that can be animated are still live
    await expect(page.locator('.mo-chip', { hasText: 'Opacity' })).toBeEnabled();
    await expect(page.locator('.mo-chip', { hasText: 'Blur' })).toBeEnabled();
  });

  test('a keyframe snaps to the other keys, and ⌥ lets it land anywhere', async ({ page }) => {
    const { board, cover } = await animate(page);
    // a second track with a key in the middle, to snap to
    await page.evaluate(
      ([frame, node]) => {
        window.paperlike!.store.setKeyframe(frame, node, 'opacity', 500, 0.5);
        window.paperlike!.store.commit();
      },
      [board, cover] as const,
    );
    await openTimeline(page, board);

    const lanes = (await page.locator('.mo-field').first().boundingBox())!;
    const drag = async (target: number, modifier?: 'Alt') => {
      const key = page.locator('.mo-lane[data-track] .mo-key').first();
      const from = (await key.boundingBox())!;
      if (modifier) await page.keyboard.down(modifier);
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      for (let step = 1; step <= 5; step++) {
        const to = from.x + from.width / 2 + ((target - (from.x + from.width / 2)) * step) / 5;
        await page.mouse.move(to, from.y + from.height / 2);
      }
      await page.mouse.up();
      if (modifier) await page.keyboard.up(modifier);
    };

    // three pixels short of the other track's key: near enough to snap onto it
    await drag(lanes.x + lanes.width * 0.5 - 3);
    let track = (await timelineOf(page, board))!.tracks.find((t) => t.property === 'x')!;
    expect(track.keys[0].at).toBe(500);

    // and with ⌥ down it lands exactly where it was dropped
    await drag(lanes.x + lanes.width * 0.25 - 3, 'Alt');
    track = (await timelineOf(page, board))!.tracks.find((t) => t.property === 'x')!;
    expect(track.keys[0].at).not.toBe(250);
    expect(Math.abs(track.keys[0].at - 250)).toBeLessThan(12);
  });
});

test.describe('finding it', () => {
  test('the Prototype panel starts a timeline, opens it and removes it', async ({ page }) => {
    const board = await boardId(page);
    await select(page, [board]);
    await page.locator('.fig-tab', { hasText: 'Prototype' }).click();

    const section = page.locator('.fig-section', { hasText: 'Motion' });
    await section.getByTitle('Add motion').click();

    await expect(page.locator('.mo-panel')).toBeVisible();
    expect((await timelineOf(page, board))!.tracks).toHaveLength(0);
    // located by what it says rather than by its accessible name: the panel's
    // buttons take theirs from the tooltip
    await expect(section.locator('button', { hasText: '0 tracks, 0 keyframes' })).toBeVisible();

    // a keyframe, and the section counts it
    await select(page, [await coverId(page)]);
    await page.locator('.mo-chip', { hasText: 'Opacity' }).click();
    await select(page, [board]);
    await expect(section.locator('button', { hasText: '1 track, 1 keyframe' })).toBeVisible();

    await section.getByTitle('Remove motion').click();
    expect((await doc(page))[board].motion ?? null).toBeFalsy();
    await expect(page.locator('.mo-panel')).toHaveCount(0);
  });

  test('Space plays the timeline instead of panning while it is open', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    await page.locator('[data-canvas-root]').press('Space');
    await expect.poll(async () => (await motionUI(page)).playing).toBe(true);
    // and the canvas did not take it as the hand tool
    expect(await page.evaluate(() => window.paperlike!.ui.getState().spacePan)).toBe(false);

    await page.locator('[data-canvas-root]').press('Space');
    await expect.poll(async () => (await motionUI(page)).playing).toBe(false);
  });
});

test.describe('playback', () => {
  /** What the browser says it is running on this layer. */
  function animations(page: Page, id: string) {
    return page.evaluate((nodeId) => {
      const el = document.querySelector(`[data-canvas-root] div[data-node-id="${nodeId}"]`);
      return el ? el.getAnimations().map((a) => a.playState) : [];
    }, id);
  }

  test('play runs a real animation, and pause leaves the playhead where it got to', async ({
    page,
  }) => {
    const { board, cover } = await animate(page);
    await openTimeline(page, board);

    expect(await animations(page, cover)).toEqual(['paused']);

    await page.locator('.mo-btn[title="Play"]').click();
    await expect.poll(() => animations(page, cover)).toEqual(['running']);

    await page.waitForTimeout(300);
    await page.locator('.mo-btn[title="Pause"]').click();

    const at = (await motionUI(page)).at;
    expect(at).toBeGreaterThan(150);
    await expect.poll(() => animations(page, cover)).toEqual(['paused']);
  });

  test('back to the start rewinds', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);
    await setAt(page, 700);
    await page.locator('.mo-btn[title="Back to the start"]').click();
    expect((await motionUI(page)).at).toBe(0);
  });

  test('duration and loop belong to the document', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);

    // typed and committed, the way the field is actually used
    await page.locator('.mo-num').fill('2500');
    await page.locator('.mo-num').press('Enter');
    await expect.poll(async () => (await timelineOf(page, board))!.duration).toBe(2500);

    await page.locator('.mo-btn[title="Loop"]').click();
    expect((await timelineOf(page, board))!.loop).toBe(false);

    // it is the running animation that loops or does not; a paused one is a
    // scrub, and a scrub is a position in a single pass
    await page.locator('.mo-btn[title="Play"]').click();
    await expect
      .poll(async () => (await page.locator('style[data-motion]').textContent()) ?? '')
      .toContain('animation-iteration-count: 1;');

    await page.locator('.mo-btn[title="Pause"]').click();
    await page.locator('.mo-btn[title="Loop"]').click();
    await page.locator('.mo-btn[title="Play"]').click();
    await expect
      .poll(async () => (await page.locator('style[data-motion]').textContent()) ?? '')
      .toContain('animation-iteration-count: infinite;');
  });

  test('shortening the timeline brings the playhead back inside it', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);
    await setAt(page, 900);

    await page.locator('.mo-num').fill('400');
    await page.locator('.mo-num').press('Enter');

    await expect.poll(async () => (await timelineOf(page, board))!.duration).toBe(400);
    // the playhead cannot sit past the end of the timeline it is in
    expect((await motionUI(page)).at).toBeLessThanOrEqual(400);
  });

  test('an edit while it is playing stops the playback it would be recording into', async ({
    page,
  }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await select(page, [cover]);
    await openTimeline(page, board);
    await page.locator('.mo-btn[title="Play"]').click();
    await expect.poll(async () => (await motionUI(page)).playing).toBe(true);

    await page.locator('[data-canvas-root]').press('ArrowRight');

    // a recording into a moving playhead is a smear, so the edit stops it
    await expect.poll(async () => (await motionUI(page)).playing).toBe(false);
    const track = (await timelineOf(page, board))!.tracks.find((t) => t.property === 'x');
    expect(track!.keys).toHaveLength(1);
  });

  test('a frame with a timeline plays it in Present', async ({ page }) => {
    const { board, cover } = await animate(page);
    await page.evaluate((id) => window.paperlike!.ui.getState().present(id), board);
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', board);

    const state = await page.evaluate((nodeId) => {
      const el = document.querySelector(`.fig-present-screen div[data-node-id="${nodeId}"]`);
      return el ? el.getAnimations().map((a) => a.playState) : [];
    }, cover);
    expect(state).toEqual(['running']);
  });
});

test.describe('the document', () => {
  test('a timeline survives undo and redo as one step', async ({ page }) => {
    const board = await boardId(page);
    const cover = await coverId(page);
    await select(page, [cover]);
    await openTimeline(page, board);

    await page.locator('.mo-chip', { hasText: 'Opacity' }).click();
    expect((await timelineOf(page, board))!.tracks).toHaveLength(1);

    await page.evaluate(() => window.paperlike!.store.undo());
    await expect.poll(async () => (await timelineOf(page, board))?.tracks.length ?? 0).toBe(0);

    await page.evaluate(() => window.paperlike!.store.redo());
    await expect.poll(async () => (await timelineOf(page, board))?.tracks.length ?? 0).toBe(1);
  });

  test('a duplicated board animates its own copy of the layers', async ({ page }) => {
    const { board, cover } = await animate(page);
    const copy = await page.evaluate((id) => {
      const made = window.paperlike!.store.duplicate([id]);
      window.paperlike!.store.commit();
      return made[0];
    }, board);

    const after = await doc(page);
    const copied = after[copy].motion!;
    expect(copied.tracks).toHaveLength(1);

    // it drives a layer inside the copy, not the layer it was copied from
    const driven = copied.tracks[0].node;
    expect(driven).not.toBe(cover);
    expect(after[driven].parent).toBe(copy);
    expect(copied.tracks[0].keys.map((key) => key.value)).toEqual([0, 200]);

    // and with its own track id, so two timelines never share a @keyframes name
    expect(copied.tracks[0].id).not.toBe(after[board].motion!.tracks[0].id);
    // the original is untouched
    expect(after[board].motion!.tracks[0].node).toBe(cover);
  });

  test('a pasted board brings its timeline with it, re-pointed', async ({ page }) => {
    const { board, cover } = await animate(page);
    const pasted = await page.evaluate((id) => {
      const store = window.paperlike!.store;
      const ids = store.paste(store.serialize([id]), 'root', { x: 900, y: 0 });
      store.commit();
      return ids[0];
    }, board);

    const after = await doc(page);
    const spec = after[pasted].motion!;
    expect(spec.tracks).toHaveLength(1);
    expect(spec.tracks[0].node).not.toBe(cover);
    expect(after[spec.tracks[0].node].parent).toBe(pasted);

    // both boards animate, each its own layers
    await openTimeline(page, pasted);
    await setAt(page, 500);
    await expect.poll(() => computed(page, spec.tracks[0].node, 'left')).toBe('100px');
    // the original is not being driven, because its timeline is not the open one
    await expect.poll(() => computed(page, cover, 'left')).toBe('40px');
  });

  test('an instance of an animated frame drives its own layers', async ({ page }) => {
    const { board, cover } = await animate(page);
    const instance = await page.evaluate((id) => {
      const store = window.paperlike!.store;
      store.createComponent(id);
      const made = store.createInstance(id, 'root', { x: 900, y: 0 });
      store.commit();
      return made;
    }, board);

    const after = await doc(page);
    const spec = after[instance!].motion!;
    expect(spec.tracks[0].node).not.toBe(cover);
    expect(after[spec.tracks[0].node].parent).toBe(instance);
  });

  test('deleting the board closes the timeline with it', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);
    await expect(page.locator('.mo-panel')).toBeVisible();

    await page.evaluate((id) => window.paperlike!.store.remove([id]), board);

    await expect(page.locator('.mo-panel')).toHaveCount(0);
    // and the state went with it, so Escape means what it used to again
    await expect.poll(async () => (await motionUI(page)).frame).toBeNull();
  });

  test('a timeline on one board says nothing about another', async ({ page }) => {
    const { board } = await animate(page);
    const second = await makeNode(page, 'frame', {
      name: 'Second', x: 700, y: 0, w: 400, h: 300, fill: '#FFF7E6', flex: null,
    });
    await openTimeline(page, second);
    await expect(page.locator('.mo-key')).toHaveCount(0);
    expect((await doc(page))[second].motion ?? null).toBeFalsy();
    // the first board kept its own
    expect((await timelineOf(page, board))!.tracks).toHaveLength(1);
  });
});

/**
 * The timeline's keyboard.
 *
 * Time was reachable only by dragging a 24px strip, and the canvas's own arrow
 * nudge never learnt that the panel was open — so an arrow press with a
 * keyframe selected moved the layer instead, writing a stray key whenever
 * Record was armed.
 */
test.describe('the keyboard', () => {
  test('the arrows walk the playhead, and ⌥ jumps to the next key', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);
    await select(page, []);
    await setAt(page, 0);

    // with nothing on the canvas to nudge, a plain arrow is the playhead's. A
    // layer selected and no keys selected still nudges the layer, because with
    // Record armed that is how a keyframe gets written.
    const now = async () => (await motionUI(page)).at;
    await page.keyboard.press('ArrowRight');
    const oneStep = await now();
    expect(oneStep).toBeGreaterThan(0);

    // ⇧ is ten of the same step rather than a different unit
    await setAt(page, 0);
    await page.keyboard.press('Shift+ArrowRight');
    expect(await now()).toBe(oneStep * 10);

    // Home and End are the two ends of the timeline
    await page.keyboard.press('End');
    expect(await now()).toBe(1000);
    await page.keyboard.press('Home');
    expect(await now()).toBe(0);

    // ⌥ lands exactly on a keyframe, which a drag on a 24px strip could only
    // ever approach
    await setAt(page, 400);
    await page.keyboard.press('Alt+ArrowRight');
    expect(await now()).toBe(1000);
    await page.keyboard.press('Alt+ArrowLeft');
    expect(await now()).toBe(0);
  });

  test('with a keyframe selected the arrows move the key, not the layer', async ({ page }) => {
    const { board, cover } = await animate(page);
    await openTimeline(page, board);
    await setAt(page, 0);
    const before = (await doc(page))[cover].x;

    await page.locator('.mo-key').last().click();
    await page.keyboard.press('ArrowLeft');

    const spec = await timelineOf(page, board);
    const times = spec!.tracks[0].keys.map((k: { at: number }) => k.at).sort((a: number, b: number) => a - b);
    expect(times[1]).toBeLessThan(1000);
    // the layer itself has not moved: nudging it is what used to happen, and
    // with Record armed it wrote a keyframe nobody asked for
    expect((await doc(page))[cover].x).toBe(before);
  });
});

/**
 * A timeline of eight layers at three tracks each is thirty-two rows in a panel
 * that stops growing at thirteen, so the layers you are not working on have to
 * fold — and a folded layer still has to say where its keys are.
 */
test.describe('layer rows', () => {
  test('a layer row summarises its keys, and folds its tracks away', async ({ page }) => {
    const { board, cover } = await animate(page);
    await openTimeline(page, board);

    // one mark per moment something happens on the layer, however many tracks
    // those moments are spread across
    const summary = page.locator(`[data-summary="${cover}"]`);
    await expect(summary).toHaveCount(2);
    await page.evaluate(
      ([frame, node]) => {
        const store = window.paperlike!.store;
        store.setKeyframe(frame, node, 'opacity', 0, 1, { easing: 'linear' });
        store.setKeyframe(frame, node, 'opacity', 250, 0.2, { easing: 'linear' });
        store.commit();
      },
      [board, cover] as const,
    );
    // x has keys at 0 and 1000, opacity at 0 and 250 — three distinct moments
    await expect(summary).toHaveCount(3);

    const lanes = page.locator('.mo-lane[data-track]');
    await expect(lanes).toHaveCount(2);
    const tall = (await page.locator('.mo-panel').boundingBox())!.height;

    await page.locator(`[data-fold="${cover}"]`).click();
    await expect(lanes).toHaveCount(0);
    // the summary is what is left, which is the point of folding it
    await expect(summary).toHaveCount(3);
    expect((await page.locator('.mo-panel').boundingBox())!.height).toBeLessThan(tall);

    await page.locator(`[data-fold="${cover}"]`).click();
    await expect(lanes).toHaveCount(2);
  });
});

/**
 * Right-clicking the timeline.
 *
 * Figma's keyframe menu is how most people ever find keyframe easing. Here a
 * right press had no menu at all — and worse, the lane handlers never checked
 * which button it was, so it moved the playhead and threw away the keyframe
 * selection on its way to the browser's own menu.
 */
test.describe('the right-click menu', () => {
  test('a keyframe offers its own commands, and the easings behind them', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);
    await setAt(page, 400);

    await page.locator('.mo-key').last().click({ button: 'right' });
    const menu = page.locator('.ctx');
    await expect(menu).toBeVisible();
    // right-clicking a key selects it, the way every list here behaves
    expect((await motionUI(page)).selected).toHaveLength(1);
    // and the playhead has not moved, which a right press used to do
    expect((await motionUI(page)).at).toBe(400);

    await menu.getByText('Easing', { exact: true }).hover();
    await page.getByRole('menuitem', { name: 'Ease in out', exact: true }).click();
    const spec = await timelineOf(page, board);
    expect(spec!.tracks[0].keys.some((k: { easing: string }) => k.easing === 'ease-in-out')).toBe(true);

    // and Delete takes the key it was opened on
    await page.locator('.mo-key').last().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete keyframe' }).click();
    expect((await timelineOf(page, board))!.tracks[0].keys).toHaveLength(1);
  });

  test('a right press on empty lane space keeps the playhead where it was', async ({ page }) => {
    const { board } = await animate(page);
    await openTimeline(page, board);
    await setAt(page, 700);

    await page.locator('.mo-lane[data-track]').first().click({ button: 'right', position: { x: 20, y: 12 } });
    expect((await motionUI(page)).at).toBe(700);
  });
});
