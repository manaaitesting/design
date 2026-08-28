import { expect, test } from '@playwright/test';
import { doc, dragBy, makeNode, nodeNamed, openEditor, removeNodes, select } from './helpers';

/**
 * The Figma-parity work: shapes, booleans, masks, point editing, the scale
 * tool, variable modes and the quick actions palette.
 *
 * Everything here goes through the real canvas for the same reason the rest of
 * the suite does — a boolean group that resolves correctly in the geometry unit
 * tests and still paints a rectangle on screen is a bug the geometry tests
 * cannot see.
 */

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the shape flyout arms the tool it names', async ({ page }) => {
  await page.getByRole('button', { name: 'More shapes' }).click();
  await page.getByRole('menuitem', { name: 'Star' }).click();
  expect(await page.evaluate(() => window.paperlike!.ui.getState().tool)).toBe('star');
});

test('drawing with the polygon tool creates a polygon that paints through a path', async ({ page }) => {
  await page.evaluate(() => window.paperlike!.ui.getState().setTool('polygon'));
  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(800, 600);
  await page.mouse.up();

  const nodes = await doc(page);
  const polygon = Object.values(nodes).find((node) => node.type === 'polygon');
  expect(polygon).toBeTruthy();
  expect(polygon!.sides).toBe(3);

  // the fill is a clipped layer, not a rectangle with a background
  const clip = await page
    .locator(`[data-node-id="${polygon!.id}"] > div`)
    .first()
    .evaluate((el) => getComputedStyle(el).clipPath);
  expect(clip).toContain('path');
  await removeNodes(page, [polygon!.id]);
});

test('a line is drawn end to end and stays clickable when it is flat', async ({ page }) => {
  await page.evaluate(() => window.paperlike!.ui.getState().setTool('line'));
  await page.mouse.move(400, 700);
  await page.mouse.down();
  await page.mouse.move(600, 700);
  await page.mouse.up();

  const nodes = await doc(page);
  const line = Object.values(nodes).find((node) => node.type === 'line');
  expect(line).toBeTruthy();
  expect(Math.round(line!.w)).toBe(200);
  expect(line!.h).toBe(0);

  // a zero-height box would be impossible to hit, so the layer carries a pad
  await page.evaluate(() => window.paperlike!.ui.getState().select([]));
  await page.mouse.click(500, 700);
  expect(await page.evaluate(() => window.paperlike!.ui.getState().selection)).toEqual([line!.id]);
  await removeNodes(page, [line!.id]);
});

test('a boolean group combines its children and stays editable', async ({ page }) => {
  const a = await makeNode(page, 'rect', { name: 'Bool A', x: 40, y: 560, w: 100, h: 100 });
  const b = await makeNode(page, 'rect', { name: 'Bool B', x: 100, y: 620, w: 100, h: 100 });

  const group = await page.evaluate(
    ([first, second]) => {
      const id = window.paperlike!.store.booleanGroup([first, second], 'subtract');
      window.paperlike!.store.commit();
      return id;
    },
    [a, b] as const,
  );
  expect(group).toBeTruthy();

  const nodes = await doc(page);
  expect(nodes[group!].type).toBe('boolean');
  expect(nodes[group!].op).toBe('subtract');
  // the parts are still there — a boolean group is a rule, not a bake
  expect(nodes[group!].children).toEqual([a, b]);
  expect(nodes[a].parent).toBe(group);

  const clip = await page
    .locator(`[data-node-id="${group}"] > div`)
    .first()
    .evaluate((el) => getComputedStyle(el).clipPath);
  expect(clip).toContain('path');

  // switching the operation re-reads the same children
  await page.evaluate((id) => window.paperlike!.store.setBooleanOp(id, 'intersect'), group!);
  expect((await doc(page))[group!].op).toBe('intersect');
  await removeNodes(page, [group!]);
});

test('a mask clips the sibling above it and moves to the bottom of the stack', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!;
  const masked = await page.evaluate((parent) => {
    const store = window.paperlike!.store;
    const id = store.create('rect', parent, { name: 'Masked', x: 300, y: 40, w: 200, h: 200, fill: '#F2637F' });
    store.commit();
    return id;
  }, board.id);
  const mask = await page.evaluate((parent) => {
    const store = window.paperlike!.store;
    const id = store.create('ellipse', parent, { name: 'Mask', x: 320, y: 60, w: 120, h: 120 });
    store.commit();
    return id;
  }, board.id);

  await page.evaluate((id) => {
    window.paperlike!.store.toggleMask([id]);
    window.paperlike!.store.commit();
  }, mask);

  const nodes = await doc(page);
  expect(nodes[mask].isMask).toBe(true);
  // a mask shapes what paints above it, so it has to be the lowest of them
  expect(nodes[board.id].children[0]).toBe(mask);

  const clip = await page
    .locator(`[data-node-id="${masked}"]`)
    .evaluate((el) => getComputedStyle(el).clipPath);
  expect(clip).toContain('path');
  await removeNodes(page, [mask, masked]);
});

test('flattening a boolean group bakes it into one editable path', async ({ page }) => {
  const a = await makeNode(page, 'rect', { name: 'Flat A', x: 40, y: 560, w: 120, h: 120, radius: 16 });
  const b = await makeNode(page, 'ellipse', { name: 'Flat B', x: 100, y: 620, w: 100, h: 100 });

  const flat = await page.evaluate(
    ([first, second]) => {
      const store = window.paperlike!.store;
      const group = store.booleanGroup([first, second], 'subtract')!;
      const id = store.flatten([group]);
      store.commit();
      return id;
    },
    [a, b] as const,
  );

  const nodes = await doc(page);
  expect(flat).toBeTruthy();
  expect(nodes[flat!].type).toBe('vector');
  // the parts are gone: flatten is the one-way door, unlike the group itself
  expect(nodes[a]).toBeUndefined();
  expect(nodes[b]).toBeUndefined();
  expect((nodes[flat!].paths ?? []).length).toBeGreaterThan(0);
  await removeNodes(page, [flat!]);
});

test('flattening a shape that overlaps another gives their union', async ({ page }) => {
  const a = await makeNode(page, 'rect', { name: 'U A', x: 40, y: 560, w: 100, h: 100 });
  const b = await makeNode(page, 'rect', { name: 'U B', x: 90, y: 610, w: 100, h: 100 });

  const flat = await page.evaluate(
    ([first, second]) => {
      const id = window.paperlike!.store.flatten([first, second]);
      window.paperlike!.store.commit();
      return id;
    },
    [a, b] as const,
  );
  const node = (await doc(page))[flat!];
  // the union of two 100-squares offset by 50 spans 150 each way
  expect(Math.round(node.w)).toBe(150);
  expect(Math.round(node.h)).toBe(150);
  await removeNodes(page, [flat!]);
});

test('outlining a stroke turns it into a filled shape with a hole', async ({ page }) => {
  const id = await makeNode(page, 'ellipse', {
    name: 'Ring',
    x: 60,
    y: 560,
    w: 120,
    h: 120,
    fill: null,
    fillVisible: false,
    border: { width: 12, color: '#F2637F', style: 'solid', position: 'center' },
  });

  const made = await page.evaluate((target) => {
    const out = window.paperlike!.store.outlineStroke([target]);
    window.paperlike!.store.commit();
    return out;
  }, id);

  expect(made).toHaveLength(1);
  const nodes = await doc(page);
  const outline = nodes[made[0]];
  expect(outline.type).toBe('vector');
  expect(outline.fill).toBe('#F2637F');
  // outer edge and inner edge: a ring is two subpaths
  expect(outline.paths).toHaveLength(2);
  // the layer had nothing left to paint, so it went with the stroke
  expect(nodes[id]).toBeUndefined();
  await removeNodes(page, made);
});

test('a maximum width bounds a layer that would otherwise hug', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!;
  const id = await page.evaluate((parent) => {
    const store = window.paperlike!.store;
    const made = store.create('text', parent, {
      name: 'Bounded',
      x: 20,
      y: 20,
      text: 'a fairly long caption that would otherwise run on and on',
      wMode: 'fit',
      maxW: 120,
    });
    store.commit();
    return made;
  }, board.id);

  const width = await page
    .locator(`[data-node-id="${id}"]`)
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(121);
  await removeNodes(page, [id]);
});

test('point editing moves one anchor without moving the layer', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Path',
    x: 60,
    y: 560,
    w: 200,
    h: 100,
    anchors: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 0 },
    ],
    closed: false,
  });
  await select(page, [id]);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.paperlike!.ui.getState().vectorEdit)).toBe(id);

  await page.evaluate(
    (target) => {
      const store = window.paperlike!.store;
      const node = window.paperlike!.doc()[target];
      const anchors = (node.anchors ?? []).map((anchor, index) =>
        index === 1 ? { ...anchor, y: anchor.y + 60 } : anchor,
      );
      store.setAnchors(target, anchors);
      store.commit();
    },
    id,
  );

  const after = (await doc(page))[id];
  // the box re-fits around the points, so the outline never drifts out of it
  expect(after.h).toBe(160);
  expect(after.anchors![1].y).toBe(160);
  await removeNodes(page, [id]);
});

test('outlining a star turns it into editable points', async ({ page }) => {
  const id = await makeNode(page, 'star', { name: 'Star', x: 60, y: 560, w: 100, h: 100, sides: 5 });
  await page.evaluate((target) => {
    window.paperlike!.store.outlineShape([target]);
    window.paperlike!.store.commit();
  }, id);

  const after = (await doc(page))[id];
  expect(after.type).toBe('vector');
  expect(after.anchors).toHaveLength(10);
  await removeNodes(page, [id]);
});

test('the scale tool scales type and radii, not just the box', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!;
  const caption = (await nodeNamed(page, 'Caption'))!;
  const before = caption.font!.size;

  await page.evaluate((id) => {
    window.paperlike!.store.scaleNodes([id], 2);
    window.paperlike!.store.commit();
  }, board.id);

  const after = await doc(page);
  expect(after[board.id].w).toBe(1200);
  expect(after[caption.id].font!.size).toBe(before * 2);
  // put it back so the shared fixture is not left doubled
  await page.evaluate((id) => {
    window.paperlike!.store.scaleNodes([id], 0.5);
    window.paperlike!.store.commit();
  }, board.id);
});

test('a frame set to another variable mode publishes that mode’s values', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!;

  const modes = await page.evaluate((frame) => {
    const store = window.paperlike!.store;
    const collection = store.listCollections()[0];
    const token = store.addToken({ name: 'probe-surface', type: 'color', value: '#FFFFFF' });
    const dark = store.addMode(collection.id, 'Dark')!;
    store.setTokenValue(token, dark, '#101010');
    store.setNodeMode(frame, collection.id, dark);
    store.commit();
    return { collection: collection.id, dark, token };
  }, board.id);
  expect(modes.dark).toBeTruthy();

  const declared = await page
    .locator(`[data-node-id="${board.id}"]`)
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--probe-surface').trim());
  expect(declared.toLowerCase()).toBe('#101010');

  await page.evaluate((state) => {
    const store = window.paperlike!.store;
    store.removeToken(state.token);
    store.removeMode(state.collection, state.dark);
  }, modes as unknown as { token: string; collection: string; dark: string });
});

test.describe('rich text', () => {
  const seed = async (page: import('@playwright/test').Page) => {
    const board = (await nodeNamed(page, 'Fixture Board'))!;
    return page.evaluate((parent) => {
      const store = window.paperlike!.store;
      const id = store.create('text', parent, {
        name: 'Sentence',
        x: 20,
        y: 20,
        w: 400,
        h: 40,
        wMode: 'fixed',
        hMode: 'fit',
        text: 'hello brave new world',
      });
      store.commit();
      return id;
    }, board.id);
  };

  const enter = async (page: import('@playwright/test').Page, id: string) => {
    await page.evaluate((target) => {
      window.paperlike!.ui.getState().select([target]);
      window.paperlike!.ui.getState().setEditing(target);
    }, id);
    await page.waitForFunction(() => document.querySelector('[contenteditable]') !== null);
    await page.waitForTimeout(120);
  };

  /** Selects a character range inside the layer being edited. */
  const selectRange = (page: import('@playwright/test').Page, from: number, to: number) =>
    page.evaluate(([a, b]) => {
      const el = document.querySelector<HTMLElement>('[contenteditable]')!;
      el.focus();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes: Node[] = [];
      let node = walker.nextNode();
      while (node) {
        nodes.push(node);
        node = walker.nextNode();
      }
      const at = (offset: number): [Node, number] => {
        let seen = 0;
        for (const entry of nodes) {
          const length = entry.textContent?.length ?? 0;
          if (offset <= seen + length) return [entry, offset - seen];
          seen += length;
        }
        const last = nodes[nodes.length - 1];
        return [last, last.textContent?.length ?? 0];
      };
      const [sn, so] = at(a);
      const [en, eo] = at(b);
      const range = document.createRange();
      range.setStart(sn, so);
      range.setEnd(en, eo);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, [from, to] as const);

  test('the bar over a selection bolds exactly that range', async ({ page }) => {
    const id = await seed(page);
    await enter(page, id);
    await selectRange(page, 6, 11);
    await expect(page.locator('.fig-range-bar')).toBeVisible();
    await page.locator('.fig-range-bar button[title="Bold"]').click();

    await expect
      .poll(async () => (await doc(page))[id].runs?.map((run) => `${run.text}${run.bold ? '*' : ''}`))
      .toEqual(['hello ', 'brave*', ' new world']);
    await removeNodes(page, [id]);
  });

  test('typing inside a styled run keeps its styling', async ({ page }) => {
    const id = await seed(page);
    await page.evaluate((target) => {
      window.paperlike!.store.update(target, {
        runs: [{ text: 'hello ' }, { text: 'brave', bold: true }, { text: ' new world' }],
      });
      window.paperlike!.store.commit();
    }, id);
    await enter(page, id);
    await selectRange(page, 8, 8);
    await page.keyboard.type('X');

    await expect
      .poll(async () => (await doc(page))[id].text)
      .toBe('hello brXave new world');
    const runs = (await doc(page))[id].runs!;
    expect(runs.find((run) => run.bold)?.text).toBe('brXave');
    await removeNodes(page, [id]);
  });

  test('a styled run renders as its own span, and the plain text still reads', async ({ page }) => {
    const id = await seed(page);
    await page.evaluate((target) => {
      window.paperlike!.store.update(target, {
        runs: [
          { text: 'hello ' },
          { text: 'brave', bold: true, color: '#E5484D' },
          { text: ' new world' },
        ],
      });
      window.paperlike!.store.commit();
    }, id);

    const spans = await page
      .locator(`[data-node-id="${id}"] span`)
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          text: node.textContent,
          weight: getComputedStyle(node).fontWeight,
          color: getComputedStyle(node).color,
        })),
      );
    const bold = spans.find((span) => span.text === 'brave');
    expect(bold?.weight).toBe('700');
    expect(bold?.color).toBe('rgb(229, 72, 77)');
    // the layer still reads as one sentence, which is what search and export use
    expect((await doc(page))[id].text).toBe('hello brave new world');
    await removeNodes(page, [id]);
  });
});

/**
 * The document half of the shared library: what importing a published component
 * leaves in the file, and what taking a newer revision does to the instances
 * already placed from it. The server half is checked without a browser, in
 * `library.spec.ts`.
 */
test('a library component updates in place, and its instances follow', async ({ page }) => {
  const result = await page.evaluate(() => {
    const store = window.paperlike!.store;
    const doc = () => window.paperlike!.doc();

    // something to publish
    const main = store.create('frame', 'root', {
      name: 'Badge',
      x: 40,
      y: 560,
      w: 160,
      h: 48,
      fill: '#5B8DEF',
      flex: null,
    });
    store.create('text', main, { name: 'Label', x: 12, y: 14, w: 100, h: 20, text: 'v1' });
    store.createComponent(main);
    const payloadV1 = store.serialize([main]);
    store.remove([main]);
    store.commit();

    // …imported as if from the library
    const imported = store.importComponent(payloadV1, 'root', { id: 'lib_x', version: 1 })!;
    const instance = store.createInstance(imported, 'root', { x: 300, y: 560 })!;
    store.commit();

    // a second revision, built the same way
    const revised = store.create('frame', 'root', {
      name: 'Badge',
      x: 900,
      y: 900,
      w: 180,
      h: 60,
      fill: '#27C4A6',
      flex: null,
    });
    store.create('text', revised, { name: 'Label', x: 12, y: 14, w: 100, h: 20, text: 'v2' });
    store.create('rect', revised, { name: 'Dot', x: 150, y: 20, w: 12, h: 12 });
    store.createComponent(revised);
    const payloadV2 = store.serialize([revised]);
    store.remove([revised]);
    store.commit();

    store.updateFromLibrary(imported, payloadV2, 2);
    store.commit();
    return { imported, instance, before: doc()[imported].libraryVersion };
  });

  const nodes = await doc(page);
  const main = nodes[result.imported];
  expect(main.libraryId).toBe('lib_x');
  expect(main.libraryVersion).toBe(2);
  expect(main.fill).toBe('#27C4A6');
  expect(main.children).toHaveLength(2);
  // the id survived the update, which is what lets instances keep pointing at it
  expect(nodes[result.instance].instanceOf).toBe(result.imported);

  // propagation is scheduled, so the instance catches up on the next tick
  await expect
    .poll(async () => (await doc(page))[result.instance].children.length)
    .toBe(2);
  expect((await doc(page))[result.instance].fill).toBe('#27C4A6');

  // and there is exactly one main: the paste that carried the revision is gone
  const mains = Object.values(await doc(page)).filter((node) => node.libraryId);
  expect(mains).toHaveLength(1);

  await removeNodes(page, [result.imported, result.instance]);
});

test('a slice exports the region under it, not itself', async ({ page }) => {
  const board = (await nodeNamed(page, 'Fixture Board'))!;
  void board;
  const slice = await makeNode(page, 'slice', {
    name: 'Crop',
    x: 20,
    y: 20,
    w: 220,
    h: 160,
    exports: [{ id: 'e1', scale: 1, format: 'png' }],
  });
  await select(page, [slice]);

  // it paints nothing: the outline on the canvas is chrome
  const painted = await page
    .locator(`[data-node-id="${slice}"]`)
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(painted).toBe('none');

  const download = page.waitForEvent('download');
  await page.locator('.fig-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Crop@1x.png');

  // the PNG is the slice's own size, whatever was underneath it
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const png = Buffer.concat(chunks);
  expect(png.readUInt32BE(16)).toBe(220);
  expect(png.readUInt32BE(20)).toBe(160);

  await removeNodes(page, [slice]);
});

test('an image adjustment reaches the rendered filter', async ({ page }) => {
  const id = await makeNode(page, 'image', {
    name: 'Adjusted',
    x: 60,
    y: 560,
    w: 200,
    h: 150,
    fills: [
      {
        id: 'p1',
        value: 'url(data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)',
        opacity: 1,
        visible: true,
        adjust: {
          exposure: 0.2,
          contrast: 0.1,
          saturation: -0.5,
          temperature: 0.4,
          tint: 0,
          highlights: 0,
          shadows: 0,
        },
      },
    ],
  });

  // an adjusted paint gets an element of its own, because a filter needs one
  const layer = page.locator(`[data-node-id="${id}"] > div`).first();
  const filter = await layer.evaluate((el) => getComputedStyle(el).filter);
  expect(filter).toContain('brightness(1.2)');
  expect(filter).toContain('saturate(0.5)');
  // temperature has no CSS function, so it arrives as an SVG filter
  expect(filter).toContain('url(');
  expect(await page.locator(`[data-node-id="${id}"] filter`).count()).toBe(1);

  await removeNodes(page, [id]);
});

test('an uploaded font is declared for the page and offered in the menu', async ({ page }) => {
  await page.evaluate(() => {
    window.paperlike!.store.addFont({
      name: 'Probe Face',
      // a tiny valid data URL is enough: nothing here renders the glyphs
      src: 'data:font/woff2;base64,d09GMgABAAAAAAAB',
      weight: 400,
    });
    window.paperlike!.store.commit();
  });

  await expect
    .poll(async () =>
      page.evaluate(() =>
        [...document.querySelectorAll('style')].some((style) =>
          style.textContent?.includes('Probe Face'),
        ),
      ),
    )
    .toBe(true);

  const caption = (await nodeNamed(page, 'Caption'))!;
  await select(page, [caption.id]);
  await page.locator('button[title="Font"]').click();
  await expect(page.getByRole('button', { name: 'Probe Face' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    const store = window.paperlike!.store;
    for (const font of store.listFonts()) store.removeFont(font.id);
  });
});

test('OpenType settings reach the rendered text', async ({ page }) => {
  const caption = (await nodeNamed(page, 'Caption'))!;
  await page.evaluate((id) => {
    const store = window.paperlike!.store;
    const node = window.paperlike!.doc()[id];
    store.update(id, { font: { ...node.font!, numeric: 'tabular', features: ['ss01', 'dlig'] } });
    store.commit();
  }, caption.id);

  const element = page.locator(`[data-node-id="${caption.id}"]`);
  await expect(element).toHaveCSS('font-variant-numeric', 'tabular-nums');
  // the browser sorts the tags, so ask what is set rather than in what order
  const features = await element.evaluate((el) => getComputedStyle(el).fontFeatureSettings);
  expect(features).toContain('"ss01"');
  expect(features).toContain('"dlig"');
});

test('quick actions opens on ⌘/ and jumps to a layer by name', async ({ page }) => {
  await page.keyboard.press('Meta+/');
  const palette = page.getByPlaceholder('Run a command or jump to a layer…');
  await expect(palette).toBeVisible();

  await palette.fill('Cover');
  await page.keyboard.press('Enter');

  const cover = (await nodeNamed(page, 'Cover'))!;
  expect(await page.evaluate(() => window.paperlike!.ui.getState().selection)).toEqual([cover.id]);
});

test('rulers can be toggled and a guide dragged off one', async ({ page }) => {
  await page.keyboard.press('Shift+R');
  expect(await page.evaluate(() => window.paperlike!.ui.getState().rulers)).toBe(true);

  const ruler = page.locator('.fig-ruler-top');
  await expect(ruler).toBeVisible();
  const box = (await ruler.boundingBox())!;
  await dragBy(page, { x: box.x + 200, y: box.y + 10 }, { x: 0, y: 220 });

  const pageId = await page.evaluate(() => window.paperlike!.ui.getState().page);
  const guides = (await doc(page))[pageId].rulerGuides ?? [];
  expect(guides.length).toBeGreaterThan(0);
  expect(guides[0].axis).toBe('y');

  await page.evaluate((id) => window.paperlike!.store.removeRulerGuide(id, 0), pageId);
  await page.keyboard.press('Shift+R');
});

test('the inspect tab shows the CSS the canvas is rendering with', async ({ page }) => {
  const cover = (await nodeNamed(page, 'Cover'))!;
  await select(page, [cover.id]);
  await page.keyboard.press('Shift+D');

  const code = page.locator('.fig-code').first();
  await expect(code).toBeVisible();
  await expect(code).toContainText('background');
  await page.keyboard.press('Shift+D');
});

test('an image fill can be cropped, and the crop reaches the CSS', async ({ page }) => {
  const id = await makeNode(page, 'image', {
    name: 'Crop me',
    x: 60,
    y: 560,
    w: 200,
    h: 150,
    src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  });
  await page.evaluate((target) => {
    window.paperlike!.store.update(target, { imageFit: 'crop', imageScale: 2, imageOffset: [10, 90] });
    window.paperlike!.store.commit();
  }, id);

  const style = await page
    .locator(`[data-node-id="${id}"]`)
    .evaluate((el) => {
      const computed = getComputedStyle(el);
      return { size: computed.backgroundSize, position: computed.backgroundPosition };
    });
  expect(style.size).toBe('200%');
  expect(style.position).toBe('10% 90%');
  await removeNodes(page, [id]);
});
