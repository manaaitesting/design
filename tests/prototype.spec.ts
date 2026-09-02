/**
 * Prototyping: what the canvas says about a flow, and what the player does with
 * it.
 *
 * These are about the two halves disagreeing. An interaction Present honours
 * but the canvas does not draw is a flow you can only read by opening the
 * panel; a board Present can open but the destination menu will not offer is a
 * board that has fallen out of the prototype without saying so.
 */
import { expect, test } from '@playwright/test';
import { doc, makeNode, nodeNamed, openEditor, removeNodes, select } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

const openTab = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.paperlike!.ui.getState().setInspectorTab('prototype'));

test('a board inside a section is still a destination, a flow and a target', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!.id;
  const inner = await makeNode(page, 'frame', {
    name: 'Sectioned', x: 760, y: 0, w: 300, h: 200, fill: '#FFF7E6', flex: null,
  });
  const section = await page.evaluate((id) => {
    const made = window.paperlike!.store.wrapInSection([id]);
    window.paperlike!.store.commit();
    return made;
  }, inner);
  expect(section).toBeTruthy();
  expect((await doc(page))[inner].parent).toBe(section);

  // the destination menu offers it
  const button = (await nodeNamed(page, 'Cover'))!.id;
  await select(page, [button]);
  await openTab(page);
  await page.locator('button[title="Add interactions"]').click();
  await page.locator('.fig-interaction-summary').click();
  await page.locator('.fig-interaction button', { hasText: 'Pick a frame' }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'Sectioned' }).click();
  expect((await doc(page))[button].interactions![0].destination).toBe(inner);

  // and it can start a flow, which is the other thing a section used to cost it
  await select(page, [inner]);
  await expect(page.locator('.fig-flow-badge')).toBeVisible();

  await page.evaluate((id) => {
    const store = window.paperlike!.store;
    store.update(id, { interactions: [] });
    store.commit();
  }, button);
  await removeNodes(page, [section!]);
  void board;
});

test('an overlay draws a connection too, and says it is not a navigation', async ({ page }) => {
  const second = await makeNode(page, 'frame', {
    name: 'Overlay Target', x: 700, y: 0, w: 300, h: 200, fill: '#FFF7E6', flex: null,
  });
  const button = (await nodeNamed(page, 'Cover'))!.id;
  await select(page, [button]);
  await openTab(page);

  await page.evaluate(
    ([id, dest]) => {
      window.paperlike!.store.addInteraction(id, { action: 'open-overlay', destination: dest });
      window.paperlike!.store.commit();
    },
    [button, second] as const,
  );

  // it used to draw nothing at all: only `navigate` got a line, though Present
  // honours the overlay perfectly well
  const link = page.locator('g[data-connection="open-overlay"] path[marker-end]');
  await expect(link).toHaveCount(1);
  // dashed, because an overlay is a layer over where you are rather than a move
  await expect(link).toHaveAttribute('stroke-dasharray', '5 3');

  await page.evaluate((id) => {
    window.paperlike!.store.update(id, { interactions: [] });
    window.paperlike!.store.commit();
  }, button);
  await removeNodes(page, [second]);
});

test('the presentation scales to the window, fills it, or shows it actual size', async ({ page }) => {
  // a frame far smaller than the window: fitting it used to be capped at 1:1,
  // so it sat in the middle of a large display as a small rectangle
  const small = await makeNode(page, 'frame', {
    name: 'Phone', x: 700, y: 0, w: 320, h: 240, fill: '#FFFFFF', flex: null,
  });
  await page.evaluate((id) => window.paperlike!.ui.getState().present(id), small);

  const width = async () => (await page.locator('.fig-present-frame').boundingBox())!.width;
  const fit = await width();
  expect(fit).toBeGreaterThan(320);

  await page.keyboard.press('Shift+Digit0');
  expect(Math.round(await width())).toBe(320);

  await page.keyboard.press('Shift+Digit2');
  expect(await width()).toBeGreaterThan(fit);

  await page.keyboard.press('Shift+Digit1');
  expect(Math.round(await width())).toBe(Math.round(fit));

  // and the choice is on the bar as well as on the keys
  await expect(page.getByLabel('Scaling')).toHaveValue('fit');

  await page.keyboard.press('Escape');
  await removeNodes(page, [small]);
});

/**
 * Figma's two momentary triggers undo themselves: While hovering runs on the
 * way in and is taken back on the way out, and While pressing is taken back
 * when the press ends. Both were dispatched here exactly like Mouse enter and
 * Mouse down — one-way — so a hover state, once entered, stuck for the rest of
 * the run. That is the difference between a hover state and a click.
 */
test('While hovering runs on the way in and is taken back on the way out', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!.id;
  const sheet = await makeNode(page, 'frame', {
    name: 'Hover Sheet', x: 1200, y: 0, w: 200, h: 140, fill: '#FFF7E6', flex: null,
  });
  const button = (await nodeNamed(page, 'Cover'))!.id;
  await page.evaluate(
    ([id, dest]) => {
      window.paperlike!.store.addInteraction(id, {
        trigger: 'hover',
        action: 'open-overlay',
        destination: dest,
      });
      window.paperlike!.store.commit();
    },
    [button, sheet] as const,
  );

  await page.evaluate((id) => window.paperlike!.ui.getState().present(id), board);
  const overlay = page.locator('.fig-overlay');
  await expect(overlay).toHaveCount(0);

  const hotspot = page.locator(`.fig-present [data-node-id="${button}"]`).first();
  await hotspot.hover();
  await expect(overlay).toHaveCount(1);

  // off the hotspot: the overlay goes back where it was, which is away
  await page.mouse.move(4, 4);
  await expect(overlay).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.evaluate((id) => {
    window.paperlike!.store.update(id, { interactions: [] });
    window.paperlike!.store.commit();
  }, button);
  await removeNodes(page, [sheet]);
});

test('While pressing is taken back when the press ends', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!.id;
  const sheet = await makeNode(page, 'frame', {
    name: 'Press Sheet', x: 1200, y: 0, w: 200, h: 140, fill: '#E6F7FF', flex: null,
  });
  const button = (await nodeNamed(page, 'Cover'))!.id;
  await page.evaluate(
    ([id, dest]) => {
      window.paperlike!.store.addInteraction(id, {
        trigger: 'press',
        action: 'open-overlay',
        destination: dest,
      });
      window.paperlike!.store.commit();
    },
    [button, sheet] as const,
  );

  await page.evaluate((id) => window.paperlike!.ui.getState().present(id), board);
  const overlay = page.locator('.fig-overlay');
  const box = await page.locator(`.fig-present [data-node-id="${button}"]`).first().boundingBox();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect(overlay).toHaveCount(1);
  await page.mouse.up();
  await expect(overlay).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.evaluate((id) => {
    window.paperlike!.store.update(id, { interactions: [] });
    window.paperlike!.store.commit();
  }, button);
  await removeNodes(page, [sheet]);
});

/**
 * An overlay animates in with the transition the interaction chose — Move in
 * from the bottom for a sheet, Dissolve for a modal. All three overlay branches
 * used to ignore the Animation the Prototype panel had written, so every sheet
 * simply appeared.
 */
test('an overlay arrives with the animation its interaction chose', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!.id;
  const sheet = await makeNode(page, 'frame', {
    name: 'Sliding Sheet', x: 1200, y: 0, w: 200, h: 140, fill: '#FFF7E6', flex: null,
  });
  const button = (await nodeNamed(page, 'Cover'))!.id;
  const arm = (transition: Record<string, unknown>) =>
    page.evaluate(
      ([id, dest, spec]) => {
        window.paperlike!.store.update(id as string, { interactions: [] });
        window.paperlike!.store.addInteraction(id as string, {
          trigger: 'click',
          action: 'open-overlay',
          destination: dest as string,
          transition: spec,
        });
        window.paperlike!.store.commit();
      },
      [button, sheet, transition] as const,
    );

  await arm({ type: 'move', direction: 'bottom', duration: 400, easing: 'ease-out' });
  await page.evaluate((id) => window.paperlike!.ui.getState().present(id), board);
  const hotspot = page.locator(`.fig-present [data-node-id="${button}"]`).first();
  await hotspot.click();

  const overlay = page.locator('.fig-overlay');
  await expect(overlay).toHaveCount(1);
  // the animation is on the overlay itself, and on `translate` so it composes
  // with the transform its position already spends
  // two properties animate, so the computed value names a duration for each
  expect(await overlay.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0.4s, 0.4s');
  expect(await overlay.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain('translate');
  // …and it settles where the position put it, rather than staying offset
  await expect
    .poll(() => overlay.evaluate((el) => getComputedStyle(el).translate))
    .toMatch(/^(none|0px)$/);
  await page.keyboard.press('Escape');

  // Instant means instant: no transition at all, as before
  await arm({ type: 'instant', direction: 'bottom', duration: 400, easing: 'ease-out' });
  await page.evaluate((id) => window.paperlike!.ui.getState().present(id), board);
  await page.locator(`.fig-present [data-node-id="${button}"]`).first().click();
  await expect(overlay).toHaveCount(1);
  expect(await overlay.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(await overlay.evaluate((el) => getComputedStyle(el).translate)).toMatch(/^(none|0px)$/);

  await page.keyboard.press('Escape');
  await page.evaluate((id) => {
    window.paperlike!.store.update(id, { interactions: [] });
    window.paperlike!.store.commit();
  }, button);
  await removeNodes(page, [sheet]);
});

/**
 * …and it leaves the same way. Closing cannot be "remove it and then animate",
 * because an element that is gone has nothing to animate — so the overlay is
 * marked as leaving, put back where it came from, and dropped once the
 * animation has had its time.
 */
test('an overlay leaves with an animation too, rather than vanishing', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!.id;
  const sheet = await makeNode(page, 'frame', {
    name: 'Leaving Sheet', x: 1200, y: 0, w: 200, h: 140, fill: '#FFF7E6', flex: null,
  });
  const button = (await nodeNamed(page, 'Cover'))!.id;
  await page.evaluate(
    ([id, dest]) => {
      window.paperlike!.store.addInteraction(id as string, {
        trigger: 'click',
        action: 'open-overlay',
        destination: dest as string,
        // long enough that the leaving state is observable rather than a race
        transition: { type: 'move', direction: 'bottom', duration: 1200, easing: 'ease-out' },
        overlay: { position: 'bottom', background: true, closeOnOutside: true },
      });
      window.paperlike!.store.commit();
    },
    [button, sheet] as const,
  );

  await page.evaluate((id) => window.paperlike!.ui.getState().present(id), board);
  await page.locator(`.fig-present [data-node-id="${button}"]`).first().click();

  const overlay = page.locator('.fig-overlay');
  await expect(overlay).toHaveCount(1);
  await expect
    .poll(() => overlay.evaluate((el) => getComputedStyle(el).translate))
    .toMatch(/^(none|0px)$/);

  // a press on the scrim closes it — and it is still on screen while it goes,
  // travelling back the way it came rather than blinking out
  const scrim = await page.locator('.fig-overlay-layer').boundingBox();
  await page.mouse.click(scrim!.x + scrim!.width / 2, scrim!.y + 8);
  await expect(overlay).toHaveAttribute('data-leaving', '');
  // on its way out it is travelling, not sitting where it rested
  expect(await overlay.evaluate((el) => getComputedStyle(el).translate)).not.toMatch(/^(none|0px)$/);
  // and it is gone once the animation has had its time
  await expect(overlay).toHaveCount(0, { timeout: 4000 });

  await page.keyboard.press('Escape');
  await page.evaluate((id) => {
    window.paperlike!.store.update(id, { interactions: [] });
    window.paperlike!.store.commit();
  }, button);
  await removeNodes(page, [sheet]);
});
