import { expect, test, type Page } from '@playwright/test';
import { doc, dragBy, makeNode, nodeNamed, openEditor, removeNodes, select, selection } from './helpers';

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

  /**
   * ⌘B and its neighbours have to be claimed by the editor rather than left to
   * the browser. A `contentEditable` answers ⌘B by writing a <b> into the DOM,
   * which this editor treats as a view of the runs — the plain text does not
   * change, so nothing reaches the model, and the styling is gone the next time
   * the spans are rebuilt.
   */
  test('\u2318B bolds the selected range, and \u2318B again takes it off', async ({ page }) => {
    const id = await seed(page);
    await enter(page, id);
    await selectRange(page, 6, 11);
    await page.keyboard.press('Meta+b');

    await expect
      .poll(async () => (await doc(page))[id].runs?.map((run) => `${run.text}${run.bold ? '*' : ''}`))
      .toEqual(['hello ', 'brave*', ' new world']);

    await selectRange(page, 6, 11);
    await page.keyboard.press('Meta+b');
    await expect
      .poll(async () => (await doc(page))[id].runs?.some((run) => run.bold))
      .toBe(false);
    await removeNodes(page, [id]);
  });

  test('\u2318I and \u21e7\u2318X reach the runs as well', async ({ page }) => {
    const id = await seed(page);
    await enter(page, id);
    await selectRange(page, 0, 5);
    await page.keyboard.press('Meta+i');
    await selectRange(page, 0, 5);
    await page.keyboard.press('Shift+Meta+x');

    await expect
      .poll(async () => {
        const run = (await doc(page))[id].runs?.[0];
        return [run?.text, !!run?.italic, !!run?.strike];
      })
      .toEqual(['hello', true, true]);
    await removeNodes(page, [id]);
  });

  /**
   * With no range selected the type panel acts on the whole text object, so the
   * shortcut does too. It is the only reading that is never a no-op.
   */
  test('with the caret collapsed the shortcut styles the whole layer', async ({ page }) => {
    const id = await seed(page);
    await enter(page, id);
    await selectRange(page, 4, 4);
    await page.keyboard.press('Meta+u');

    await expect
      .poll(async () => (await doc(page))[id].runs?.map((run) => `${run.text}${run.underline ? '_' : ''}`))
      .toEqual(['hello brave new world_']);
    await removeNodes(page, [id]);
  });

  /**
   * The layer-wide type shortcuts keep working with the caret inside the layer,
   * which is a second path: the text editor claims the key before the window
   * handler can see it.
   */
  test('\u21e7\u2318> steps the size while the caret is inside the layer', async ({ page }) => {
    const id = await seed(page);
    await enter(page, id);
    const before = (await doc(page))[id].font!.size;
    await selectRange(page, 2, 2);
    await page.keyboard.press('Shift+Meta+Period');

    await expect.poll(async () => (await doc(page))[id].font!.size).toBe(before + 1);
    // and the layer is still being edited, not dropped out of
    await expect(page.locator('[contenteditable]')).toBeVisible();
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
  // the picker lists families as options, named "Family — classification"
  await expect(page.getByRole('option', { name: /^Probe Face/ })).toBeVisible();
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

/**
 * Vector edit mode.
 *
 * The screenshots this was built from are Figma's: double-clicking a shape
 * opens its points, hatches the inside blue, and brings up a toolbar of
 * sub-tools along the bottom. These drive the real thing, because the whole
 * point of the mode is what the pointer does inside it.
 */
test('double clicking a shape opens its points, and the toolbar with them', async ({ page }) => {
  const id = await makeNode(page, 'rect', {
    name: 'Plate',
    x: 60,
    y: 560,
    w: 160,
    h: 120,
    fill: '#D9D9D9',
  });
  const box = (await page.locator(`[data-node-id="${id}"]`).boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

  expect(await page.evaluate(() => window.paperlike!.ui.getState().vectorEdit)).toBe(id);
  await expect(page.locator('.vec-bar')).toBeVisible();
  await expect(page.locator('.vec-bar .vec-tool', { hasText: 'Bend' })).toBeVisible();
  // a rectangle has four corners, and they are all on screen
  await expect(page.locator('[data-vector-anchor]')).toHaveCount(4);
  // the right panel is the point's, not the layer's
  await expect(page.locator('.fig-section', { hasText: 'Vector' }).first()).toBeVisible();

  // and none of that has converted anything yet
  expect((await doc(page))[id].type).toBe('rect');

  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('dragging a corner converts the rectangle and moves only that point', async ({ page }) => {
  const id = await makeNode(page, 'rect', {
    name: 'Plate',
    x: 60,
    y: 560,
    w: 160,
    h: 120,
    fill: '#D9D9D9',
  });
  const box = (await page.locator(`[data-node-id="${id}"]`).boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-vector-anchor]')).toHaveCount(4);

  // the top-left corner, pulled 40px to the right
  await dragBy(page, { x: box.x, y: box.y }, { x: 40, y: 0 });

  const after = (await doc(page))[id];
  expect(after.type).toBe('vector');
  // one corner moved and the other three did not, so the box is unchanged —
  // the bottom-left is still holding the left edge where it was
  expect(after.x).toBe(60);
  expect(after.w).toBe(160);
  expect(after.anchors!.map((a) => Math.round(a.x + after.x))).toEqual([100, 220, 220, 60]);
  expect(after.anchors!.map((a) => Math.round(a.y + after.y))).toEqual([560, 560, 680, 680]);

  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('a marquee inside the shape selects the points it covers', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Zigzag',
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
  await expect(page.locator('[data-vector-anchor]')).toHaveCount(3);

  const box = (await page.locator(`[data-node-id="${id}"]`).boundingBox())!;
  // a band across the bottom of the box catches the middle point only
  await dragBy(page, { x: box.x - 20, y: box.y + box.height - 20 }, { x: box.width + 40, y: 40 });

  expect(await page.evaluate(() => window.paperlike!.ui.getState().anchorSelection)).toEqual([1]);
  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('the Cut tool slices a closed path open where you click it', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Ring',
    x: 60,
    y: 560,
    w: 200,
    h: 200,
    anchors: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ],
    closed: true,
  });
  await select(page, [id]);
  await page.keyboard.press('Enter');
  await page.locator('.vec-bar .vec-tool', { hasText: 'Cut' }).click();

  const box = (await page.locator(`[data-node-id="${id}"]`).boundingBox())!;
  // halfway along the top edge
  await page.mouse.click(box.x + box.width / 2, box.y);

  const after = (await doc(page))[id];
  expect(after.paths?.[0].closed ?? after.closed).toBe(false);
  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('the Erase tool takes out the segment under the pointer', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Square',
    x: 60,
    y: 560,
    w: 200,
    h: 200,
    anchors: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ],
    closed: true,
  });
  await select(page, [id]);
  await page.keyboard.press('Enter');
  await page.locator('.vec-bar .vec-tool', { hasText: 'Erase' }).click();

  const box = (await page.locator(`[data-node-id="${id}"]`).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y);

  const after = (await doc(page))[id];
  // the ring is open now, and every corner survived: only the edge went
  expect(after.paths?.[0].closed ?? after.closed).toBe(false);
  expect(after.anchors).toHaveLength(4);
  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('the Paint tool closes the region you click and fills it', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Wedge',
    x: 60,
    y: 560,
    w: 120,
    h: 100,
    anchors: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 60, y: 100 },
    ],
    closed: false,
    fillVisible: false,
  });
  await select(page, [id]);
  await page.keyboard.press('Enter');
  await page.locator('.vec-bar .vec-tool', { hasText: 'Paint' }).click();

  const box = (await page.locator(`[data-node-id="${id}"]`).boundingBox())!;
  // well inside the wedge, near the top where it is widest
  await page.mouse.click(box.x + box.width / 2, box.y + 20);

  const after = (await doc(page))[id];
  expect(after.paths?.[0].closed ?? after.closed).toBe(true);
  expect(after.fillVisible).not.toBe(false);
  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('the Bend tool curves a straight segment', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Rule',
    x: 60,
    y: 600,
    w: 200,
    h: 1,
    anchors: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ],
    closed: false,
    border: { width: 2, color: '#111111', style: 'solid', position: 'center' },
  });
  await select(page, [id]);
  await page.keyboard.press('Enter');
  await page.locator('.vec-bar .vec-tool', { hasText: 'Bend' }).click();

  const box = (await page.locator(`[data-node-id="${id}"]`).first().boundingBox())!;
  await dragBy(page, { x: box.x + box.width / 2, y: box.y }, { x: 0, y: 60 });

  const after = (await doc(page))[id];
  // both ends now carry a handle, which is what turned the line into a curve
  expect(after.anchors![0].out).toBeTruthy();
  expect(after.anchors![1].in).toBeTruthy();
  expect(after.h).toBeGreaterThan(20);
  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('the Vector panel rounds the corner a point sits on', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Corner',
    x: 60,
    y: 560,
    w: 200,
    h: 200,
    anchors: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ],
    closed: true,
  });
  await select(page, [id]);
  await page.keyboard.press('Enter');
  await page.locator('[data-vector-anchor="1"]').click();

  const radius = page.getByTitle('Corner radius at this point').locator('input');
  await radius.fill('24');
  await radius.press('Enter');

  const after = (await doc(page))[id];
  expect(after.anchors![1].r).toBe(24);
  // and the shape actually draws the arc, rather than storing a number nobody
  // reads — the rendered path carries it
  const d = await page
    .locator(`[data-node-id="${id}"] svg path`)
    .first()
    .getAttribute('d');
  expect(d).toContain('A 24 24');
  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('Variable width tapers the stroke at the point it is dragged', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Taper',
    x: 60,
    y: 600,
    w: 200,
    h: 1,
    anchors: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ],
    closed: false,
    border: { width: 2, color: '#111111', style: 'solid', position: 'center' },
  });
  await select(page, [id]);
  await page.keyboard.press('Enter');
  await page.locator('.vec-bar .vec-tool', { hasText: 'More' }).click();
  await page.locator('.vec-more button', { hasText: 'Variable width' }).click();

  const box = (await page.locator(`[data-node-id="${id}"]`).first().boundingBox())!;
  await dragBy(page, { x: box.x + box.width, y: box.y }, { x: 0, y: 12 });

  const after = (await doc(page))[id];
  expect(after.anchors![1].width).toBeGreaterThan(20);
  // a tapering stroke is drawn as the band it sweeps, so the stroke path fills
  const filled = await page
    .locator(`[data-node-id="${id}"] svg path[fill="#111111"]`)
    .count();
  expect(filled).toBe(1);
  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('the Lasso tool selects the points it is drawn around', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Zigzag',
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
  await page.locator('.vec-bar .vec-tool', { hasText: 'Lasso' }).click();

  const box = (await page.locator(`[data-node-id="${id}"]`).first().boundingBox())!;
  // a loop drawn around the bottom point only
  const at = { x: box.x + box.width / 2, y: box.y + box.height };
  await page.mouse.move(at.x - 30, at.y - 25);
  await page.mouse.down();
  for (const [dx, dy] of [
    [30, -30],
    [60, 0],
    [60, 40],
    [0, 40],
    [-30, 10],
  ] as const) {
    await page.mouse.move(at.x - 30 + dx, at.y - 25 + dy);
  }
  await page.mouse.up();

  expect(await page.evaluate(() => window.paperlike!.ui.getState().anchorSelection)).toEqual([1]);
  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('outlining a tapered stroke keeps the taper', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Taper',
    x: 60,
    y: 600,
    w: 200,
    h: 1,
    anchors: [
      { x: 0, y: 0, width: 2 },
      { x: 200, y: 0, width: 40 },
    ],
    closed: false,
    border: { width: 2, color: '#111111', style: 'solid', position: 'center' },
  });
  await select(page, [id]);
  await page.evaluate(() => {
    const made = window.paperlike!.store.outlineStroke(
      window.paperlike!.ui.getState().selection,
    );
    window.paperlike!.store.commit();
    return made;
  });

  const outlined = await nodeNamed(page, 'Taper stroke');
  expect(outlined).toBeTruthy();
  // a uniform 2px pen would sweep a 2px band; this one ends 40 wide
  expect(outlined!.h).toBeGreaterThan(30);
  await removeNodes(page, [outlined!.id]);
});

test('the points of a rotated shape land on the shape', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    name: 'Turned',
    x: 400,
    y: 560,
    w: 200,
    h: 100,
    rotation: 45,
    anchors: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
    closed: true,
  });
  await select(page, [id]);
  await page.keyboard.press('Enter');

  const anchor = page.locator('[data-vector-anchor="0"]');
  const dot = (await anchor.boundingBox())!;
  // the first corner of a 200×100 box turned 45° about its centre sits up and
  // to the left of the centre by (100,50) rotated — that is where the handle
  // has to be, not at the corner of the measured box
  const centre = { x: 400 + 100, y: 560 + 50 };
  const expected = {
    x: centre.x + (-100 * Math.SQRT1_2 - -50 * Math.SQRT1_2),
    y: centre.y + (-100 * Math.SQRT1_2 + -50 * Math.SQRT1_2),
  };
  const viewport = await page.evaluate(() => window.paperlike!.ui.getState().viewport);
  const canvas = (await page.locator('[data-canvas-root]').boundingBox())!;
  expect(dot.x + dot.width / 2).toBeCloseTo(canvas.x + expected.x * viewport.zoom + viewport.x, 0);
  expect(dot.y + dot.height / 2).toBeCloseTo(canvas.y + expected.y * viewport.zoom + viewport.y, 0);

  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('a rounded rectangle keeps its corners through a point edit', async ({ page }) => {
  const id = await makeNode(page, 'rect', {
    name: 'Pill',
    x: 60,
    y: 560,
    w: 160,
    h: 120,
    radius: 16,
    fill: '#D9D9D9',
  });
  const box = (await page.locator(`[data-node-id="${id}"]`).first().boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-vector-anchor]')).toHaveCount(4);

  // move one corner: that is what converts the rectangle
  await dragBy(page, { x: box.x, y: box.y }, { x: 30, y: 0 });

  const after = (await doc(page))[id];
  expect(after.type).toBe('vector');
  // all four corners are still rounded — the radius moved onto the points
  expect(after.anchors!.map((a) => a.r)).toEqual([16, 16, 16, 16]);
  // and it is the shape on screen, not a number nobody reads: the fill is
  // clipped to a path that arcs across every corner
  const clip = await page
    .locator(`[data-node-id="${id}"] > div[aria-hidden]`)
    .first()
    .evaluate((el) => getComputedStyle(el).clipPath);
  expect(clip).toContain('A 16 16');
  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('a pie slice opens as a pie and stays one', async ({ page }) => {
  const id = await makeNode(page, 'ellipse', {
    name: 'Slice',
    x: 60,
    y: 560,
    w: 160,
    h: 160,
    arcStart: 0,
    arcEnd: 0.25,
    fill: '#D9D9D9',
  });
  await select(page, [id]);
  await page.keyboard.press('Enter');

  // an arc of a quarter turn is two cubic spans, plus the centre it returns to
  await expect(page.locator('[data-vector-anchor]')).toHaveCount(3);
  await page.evaluate((target) => {
    window.paperlike!.store.outlineShape([target]);
    window.paperlike!.store.commit();
  }, id);

  const after = (await doc(page))[id];
  expect(after.type).toBe('vector');
  expect(after.closed).toBe(true);
  // the last point is the centre it came back through, not a fourth rim point
  const last = after.anchors!.at(-1)!;
  expect(last.x).toBeCloseTo(80, 0);
  expect(last.y).toBeCloseTo(80, 0);
  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

/**
 * Regions.
 *
 * Two rings that overlap enclose three areas, and both the paint bucket and the
 * shape builder are about picking one of them. These drive the real canvas
 * because the arrangement is derived from what is on screen.
 */
const OVERLAP = {
  name: 'Overlap',
  x: 60,
  y: 560,
  w: 150,
  h: 100,
  paths: [
    {
      closed: true,
      anchors: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    },
    {
      closed: true,
      anchors: [
        { x: 50, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 100 },
        { x: 50, y: 100 },
      ],
    },
  ],
};

test('the Paint tool fills just the region you click', async ({ page }) => {
  const id = await makeNode(page, 'vector', {
    ...OVERLAP,
    fill: '#D9D9D9',
    fillVisible: false,
  });
  await select(page, [id]);
  await page.keyboard.press('Enter');
  await page.locator('.vec-bar .vec-tool', { hasText: 'Paint' }).click();

  const box = (await page.locator(`[data-node-id="${id}"]`).first().boundingBox())!;
  // well inside the left square, clear of the overlap that starts at 50
  await page.mouse.click(box.x + 25, box.y + 50);

  const after = (await doc(page))[id];
  expect(after.fillSeeds).toHaveLength(1);
  // the fill is clipped to that one region, so it stops where the overlap does
  const clip = await page
    .locator(`[data-node-id="${id}"] > div[aria-hidden]`)
    .first()
    .evaluate((el) => getComputedStyle(el).clipPath);
  const far = Math.max(...[...clip.matchAll(/(-?\d+(?:\.\d+)?) -?\d+(?:\.\d+)?/g)].map((m) => Number(m[1])));
  expect(far).toBeLessThan(60);

  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('⌥ with the Paint tool empties a region again', async ({ page }) => {
  const id = await makeNode(page, 'vector', { ...OVERLAP, fill: '#D9D9D9' });
  await select(page, [id]);
  await page.keyboard.press('Enter');
  await page.locator('.vec-bar .vec-tool', { hasText: 'Paint' }).click();

  const box = (await page.locator(`[data-node-id="${id}"]`).first().boundingBox())!;
  // the lens the two squares share, taken out of a shape that was wholly filled
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x + 75, box.y + 50);
  await page.keyboard.up('Alt');

  let after = (await doc(page))[id];
  expect(after.fillSeeds).toHaveLength(2);

  // and putting it back
  await page.mouse.click(box.x + 75, box.y + 50);
  after = (await doc(page))[id];
  expect(after.fillSeeds).toHaveLength(3);

  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

test('the Shape builder merges the regions you drag across', async ({ page }) => {
  const id = await makeNode(page, 'vector', { ...OVERLAP, fill: '#D9D9D9' });
  await select(page, [id]);
  await page.keyboard.press('Enter');
  await page.locator('.vec-bar .vec-tool', { hasText: 'More' }).click();
  await page.locator('.vec-more button', { hasText: 'Shape builder' }).click();

  const box = (await page.locator(`[data-node-id="${id}"]`).first().boundingBox())!;
  // straight across all three regions: left only, the lens, right only
  await dragBy(page, { x: box.x + 20, y: box.y + 50 }, { x: 110, y: 0 });

  const after = (await doc(page))[id];
  // two rings that happened to overlap are now the one silhouette they drew
  expect(after.paths).toHaveLength(1);
  expect(after.w).toBe(150);

  await page.keyboard.press('Escape');
  await removeNodes(page, [id]);
});

/**
 * The panel header, which is where Figma keeps the commands that act on the
 * whole layer rather than on one of its properties.
 */
test.describe('panel header', () => {
  test('select matching layers picks up every layer painted the same way', async ({ page }) => {
    const chip = await makeNode(page, 'rect', { name: 'Chip', x: 40, y: 620, w: 60, h: 24, fill: '#123456', radius: 4 });
    const twin = await makeNode(page, 'rect', { name: 'Twin', x: 120, y: 620, w: 60, h: 24, fill: '#123456', radius: 4 });
    // same shape, different paint — the point of "matching" is what it looks like
    const other = await makeNode(page, 'rect', { name: 'Other', x: 200, y: 620, w: 60, h: 24, fill: '#654321', radius: 4 });
    await select(page, [chip]);

    await page.getByRole('button', { name: /Select matching layers/ }).click();
    const picked = await selection(page);
    expect(picked).toContain(chip);
    expect(picked).toContain(twin);
    expect(picked).not.toContain(other);

    await removeNodes(page, [chip, twin, other]);
  });

  test('a frame dimension preset resizes the frame to the device', async ({ page }) => {
    const id = await makeNode(page, 'frame', { name: 'Board', x: 40, y: 700, w: 200, h: 200 });
    await select(page, [id]);

    await page.getByRole('button', { name: /frame dimension presets/i }).click();
    await page.getByRole('listbox', { name: 'Frame dimension presets' })
      .getByRole('button', { name: /^iPhone 16 393/ })
      .click();

    const after = (await doc(page))[id];
    expect([after.w, after.h]).toEqual([393, 852]);
    expect(after.wMode).toBe('fixed');

    await removeNodes(page, [id]);
  });

  test('the boolean menu combines the selection and can change the operation after', async ({ page }) => {
    const a = await makeNode(page, 'rect', { name: 'A', x: 40, y: 940, w: 80, h: 80, fill: '#111111' });
    const b = await makeNode(page, 'rect', { name: 'B', x: 90, y: 940, w: 80, h: 80, fill: '#111111' });
    await select(page, [a, b]);

    await page.getByRole('button', { name: 'Boolean operations' }).click();
    await page.getByRole('listbox', { name: 'Boolean operations' })
      .getByRole('button', { name: /^Subtract/ })
      .click();

    const combined = (await selection(page))[0];
    expect((await doc(page))[combined].type).toBe('boolean');
    expect((await doc(page))[combined].op).toBe('subtract');

    // with the group selected the menu changes the operation instead of nesting
    await page.getByRole('button', { name: 'Boolean operations' }).click();
    await page.getByRole('listbox', { name: 'Boolean operations' })
      .getByRole('button', { name: /^Intersect/ })
      .click();
    expect((await doc(page))[combined].op).toBe('intersect');
    expect((await selection(page))[0]).toBe(combined);

    await removeNodes(page, [combined]);
  });

  test('a hyperlink is kept on the layer and written into the export', async ({ page }) => {
    const id = await makeNode(page, 'text', { name: 'Linked', x: 40, y: 1060, w: 160, h: 24, text: 'Docs' });
    await select(page, [id]);

    await page.getByRole('button', { name: /Create link/ }).click();
    await page.getByPlaceholder('https://…').fill('https://example.com/docs');
    await page.keyboard.press('Enter');

    expect((await doc(page))[id].link).toBe('https://example.com/docs');

    const html = await page.evaluate(async (nodeId) => {
      const { toHtml } = await import('/src/export/toCode.ts' as string);
      return toHtml(nodeId, window.paperlike!.doc());
    }, id).catch(() => null);
    // the import path only resolves in dev; when it does, the anchor is there
    if (html) expect(html).toContain('href="https://example.com/docs"');

    await removeNodes(page, [id]);
  });
});

test('prototype settings live on the page, not on the person playing it', async ({ page }) => {
  // both panels have a tab strip; this one is the inspector's
  await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();

  await page.getByTitle('The device the prototype plays inside').click();
  await page.getByRole('option', { name: /^Phone — 390 × 844/ }).click();

  const pageId = await page.evaluate(() => window.paperlike!.ui.getState().page);
  expect((await doc(page))[pageId].prototypeDevice).toBe('phone');

  await page.getByTitle('The device the prototype plays inside').click();
  await page.getByRole('option', { name: 'No device' }).click();
  await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
});

/**
 * The view menu behind the zoom percentage — Figma's second half of that menu,
 * where what the canvas *shows* is decided.
 */
test.describe('view options', () => {
  /** Opens the zoom menu, which is where all of these live. */
  const openView = async (page: import('@playwright/test').Page) => {
    // its accessible name is the percentage; the title is what identifies it
    await page.locator('button[title="Zoom"]').click();
  };

  test('the menu ticks what is on and turns it off again', async ({ page }) => {
    await openView(page);
    const guides = page.getByRole('option', { name: /Layout guides/ });
    await expect(guides).toHaveAttribute('aria-selected', 'true');

    // the menu stays open while you flip options, as Figma's does
    await guides.click();
    expect(await page.evaluate(() => window.paperlike!.ui.getState().view.layoutGuides)).toBe(false);
    await expect(guides).toHaveAttribute('aria-selected', 'false');

    await guides.click();
    await page.keyboard.press('Escape');
  });

  test('outlines strips the paint off the canvas without touching the document', async ({ page }) => {
    const id = await makeNode(page, 'rect', {
      name: 'Painted', x: 40, y: 1180, w: 80, h: 80, fill: '#123456',
    });
    // popovers carry the same class so they inherit the panel's variables
    const shell = page.locator('.fig-shell').first();
    await expect(shell).not.toHaveAttribute('data-outlines', 'true');

    await openView(page);
    await page.getByRole('option', { name: /Outlines/ }).click();
    await expect(shell).toHaveAttribute('data-outlines', 'true');
    await page.keyboard.press('Escape');
    // the layer still says what it is; only the drawing changed
    expect((await doc(page))[id].fill).toBe('#123456');

    await openView(page);
    await page.getByRole('option', { name: /Outlines/ }).click();
    await page.keyboard.press('Escape');
    await removeNodes(page, [id]);
  });

  test('the zoom field takes a number and goes there', async ({ page }) => {
    await openView(page);
    await page.getByLabel('Zoom', { exact: true }).fill('150');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => Math.round(window.paperlike!.ui.getState().viewport.zoom * 100)))
      .toBe(150);

    await openView(page);
    await page.getByRole('option', { name: /Zoom to 100%/ }).click();
  });
});

test('collapse layers shuts every open row', async ({ page }) => {
  await page.evaluate(() => {
    const ui = window.paperlike!.ui.getState();
    ui.setExpanded(Object.keys(window.paperlike!.doc()), true);
  });
  expect(
    await page.evaluate(() => Object.values(window.paperlike!.ui.getState().expanded).some(Boolean)),
  ).toBe(true);

  await page.getByRole('button', { name: /Collapse layers/ }).click();
  expect(
    await page.evaluate(() => Object.values(window.paperlike!.ui.getState().expanded).some(Boolean)),
  ).toBe(false);
});

test('the Actions button opens the command menu', async ({ page }) => {
  await page.getByRole('button', { name: 'Actions' }).click();
  expect(await page.evaluate(() => window.paperlike!.ui.getState().paletteOpen)).toBe(true);
  await page.keyboard.press('Escape');
});

test('Show/Hide UI takes every panel away and brings it back', async ({ page }) => {
  await expect(page.locator('.fig-rail')).toBeVisible();

  await page.evaluate(() => window.paperlike!.ui.getState().toggleChrome());
  await expect(page.locator('.fig-rail')).toHaveCount(0);
  await expect(page.locator('.fig-left')).toHaveCount(0);

  // the canvas is still there, and still the whole point
  await expect(page.locator('[data-canvas-root]')).toBeVisible();

  await page.evaluate(() => window.paperlike!.ui.getState().toggleChrome());
  await expect(page.locator('.fig-rail')).toBeVisible();
});

test.describe('pixel preview', () => {
  test('rasterises the page and shows it back with the pixels visible', async ({ page }) => {
    await page.evaluate(() => window.paperlike!.ui.getState().setPixelPreview('1x'));
    const shot = page.locator('[data-pixel-preview]');
    await expect(shot).toBeAttached({ timeout: 15_000 });
    // nearest-neighbour is the whole point: it is what makes a pixel a pixel
    await expect(shot).toHaveCSS('image-rendering', 'pixelated');

    // the live stage steps aside while its raster stands in
    const stage = page.locator('[data-canvas-root] > div').first();
    await expect(stage).toHaveCSS('visibility', 'hidden');

    await page.evaluate(() => window.paperlike!.ui.getState().setPixelPreview('off'));
    await expect(shot).toHaveCount(0);
    await expect(stage).toHaveCSS('visibility', 'visible');
  });

  test('the raster covers the design, not the stored numbers', async ({ page }) => {
    // a hug-height frame is whatever the layout made it; the preview has to
    // measure that rather than trust the number on the node
    const id = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const frame = store.create('frame', 'root', {
        name: 'Hugging', x: 1400, y: 40, w: 200, h: 9999, hMode: 'fit',
        flex: { mode: 'flex', direction: 'column', gap: 0, crossGap: 0, padding: [0, 0, 0, 0],
                align: 'start', justify: 'start', wrap: false, columns: 1, rows: 0,
                alignContent: 'start', strokesIncluded: false, stacking: 'last', baseline: false },
      });
      // a hug frame only shrinks around something; empty, it keeps its size
      store.create('rect', frame, { name: 'Inside', w: 120, h: 80, fill: '#888888' });
      store.commit();
      return frame;
    });
    await page.evaluate(() => window.paperlike!.ui.getState().setPixelPreview('1x'));
    const shot = page.locator('[data-pixel-preview]');
    await expect(shot).toBeAttached({ timeout: 15_000 });

    const zoom = await page.evaluate(() => window.paperlike!.ui.getState().viewport.zoom);
    const box = (await shot.boundingBox())!;
    expect(box.height / zoom).toBeLessThan(9999);

    await page.evaluate(() => window.paperlike!.ui.getState().setPixelPreview('off'));
    await removeNodes(page, [id]);
  });
});

test('additional labels write a size under every frame', async ({ page }) => {
  await expect(page.locator('.fig-size-label')).toHaveCount(0);
  await page.evaluate(() => window.paperlike!.ui.getState().toggleView('labels'));
  await expect(page.locator('.fig-size-label').first()).toBeVisible();

  await page.evaluate(() => window.paperlike!.ui.getState().toggleView('labels'));
  await expect(page.locator('.fig-size-label')).toHaveCount(0);
});

test('the Annotate tool pins a note to the layer you click', async ({ page }) => {
  const cover = (await nodeNamed(page, 'Cover'))!;
  await page.getByRole('button', { name: 'Annotate' }).click();

  const box = (await page.locator(`[data-node-id="${cover.id}"]`).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  expect((await doc(page))[cover.id].annotations).toHaveLength(1);
  // and it hands you to the tab where the note is written
  expect(await page.evaluate(() => window.paperlike!.ui.getState().inspectorTab)).toBe('inspect');
  // the tool returns to Move, as a one-shot tool should
  expect(await page.evaluate(() => window.paperlike!.ui.getState().tool)).toBe('move');

  await page.evaluate((id) => {
    window.paperlike!.store.update(id, { annotations: [] });
  }, cover.id);
  await page.locator('.fig-tab', { hasText: 'Design' }).last().click();
});

test('the Measure tool latches the readout that ⌥ gives you', async ({ page }) => {
  await page.getByRole('button', { name: 'Measure' }).click();
  expect(await page.evaluate(() => window.paperlike!.ui.getState().measuring)).toBe(true);

  await page.getByRole('button', { name: 'Move', exact: true }).click();
  expect(await page.evaluate(() => window.paperlike!.ui.getState().measuring)).toBe(false);
});

/**
 * The two prototype actions Figma has that map onto features this canvas
 * already carries: swapping an instance to a sibling variant, and putting a
 * variable collection into one of its modes while the prototype plays.
 */
test.describe('prototype actions', () => {
  test('Change to offers the sibling variants and records the swap', async ({ page }) => {
    const { instance, other } = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const a = store.create('frame', 'root', { name: 'State=On', x: 40, y: 1300, w: 80, h: 40 });
      const b = store.create('frame', 'root', { name: 'State=Off', x: 140, y: 1300, w: 80, h: 40 });
      store.createComponent(a);
      store.createComponent(b);
      const set = store.combineAsVariants([a, b])!;
      const main = window.paperlike!.doc()[set].children[0];
      const placed = store.createInstance(main, 'root', { x: 40, y: 1400 })!;
      store.commit();
      return { instance: placed, other: window.paperlike!.doc()[set].children[1] };
    });

    await select(page, [instance]);
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();
    await addInteraction(page);

    await page.getByRole('combobox', { name: 'Action' }).click();
    await page.getByRole('option', { name: 'Change to' }).click();
    // the destination menu offers variants of this set, not frames on the page
    await page.getByRole('combobox', { name: 'Destination' }).click();
    await page.getByRole('option', { name: 'State=Off' }).click();

    const written = (await doc(page))[instance].interactions![0];
    expect(written.action).toBe('change-to');
    expect(written.destination).toBe(other);

    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
    await removeNodes(page, [instance]);
  });

  test('Set variable mode names a collection and one of its modes', async ({ page }) => {
    // a name of its own: collections outlive the reset the fixture does, so a
    // second run would otherwise find two of them
    const name = `Theme ${Date.now().toString(36)}`;
    const collection = await page.evaluate((label) => {
      const store = window.paperlike!.store;
      const id = store.addCollection(label);
      store.addMode(id, 'Dark');
      store.commit();
      return id;
    }, name);

    const id = await makeNode(page, 'rect', { name: 'Switch', x: 300, y: 1400, w: 60, h: 60 });
    await select(page, [id]);
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();
    await addInteraction(page);

    await page.getByRole('combobox', { name: 'Action' }).click();
    await page.getByRole('option', { name: 'Set variable mode' }).click();
    await page.getByRole('combobox', { name: 'Collection' }).click();
    await page.getByRole('option', { name, exact: true }).click();
    await page.getByRole('combobox', { name: 'Mode' }).click();
    await page.getByRole('option', { name: 'Dark', exact: true }).click();

    const written = (await doc(page))[id].interactions![0];
    expect(written.action).toBe('set-mode');
    expect(written.collection).toBe(collection);
    expect(written.mode).toBeTruthy();

    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
    await removeNodes(page, [id]);
  });
});

/**
 * The rest of Figma's interaction editor: the triggers it fires on, the eight
 * animations, and the thirteen easings — including the springs, which are not
 * a curve and so are sampled into a CSS `linear()`.
 */
/**
 * Add an interaction and open its editor.
 *
 * The panel lists one summary line per interaction, as Figma's does; the
 * controls live in the dialog that line opens.
 */
async function addInteraction(page: Page) {
  // the section button is "Add interactions"; the dialog's own + is "Add
  // another interaction", so this has to name the section's exactly
  await page.getByRole('button', { name: 'Add interactions', exact: true }).click();
  await page.locator('.fig-interaction-summary').last().click();
}

test.describe('interaction editor', () => {
  /** The prototype device the page is played on — it renames three triggers. */
  const setDevice = (page: Page, prototypeDevice: string) =>
    page.evaluate((device) => {
      const store = window.paperlike!.store;
      store.update(window.paperlike!.ui.getState().page, {
        prototypeDevice: device as never,
      });
      store.commit();
    }, prototypeDevice);

  test('the panel lists one line per interaction and opens it in a dialog', async ({ page }) => {
    const dest = await makeNode(page, 'frame', { name: 'Elsewhere', x: 1300, y: 1500, w: 80, h: 80 });
    const id = await makeNode(page, 'rect', { name: 'Opener', x: 1100, y: 1500, w: 60, h: 60 });
    await setDevice(page, 'none');
    await select(page, [id]);
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();

    await page.getByRole('button', { name: 'Add interactions', exact: true }).click();

    // the panel itself stays one line: what fires it, and where it goes
    const summary = page.locator('.fig-interaction-summary');
    await expect(summary).toHaveCount(1);
    await expect(summary.locator('.fig-interaction-trigger')).toHaveText('Click');
    await expect(summary.locator('.fig-interaction-target')).toHaveText('None');
    // and the controls are not in the panel until you ask for them
    await expect(page.getByRole('combobox', { name: 'Action' })).toHaveCount(0);

    await summary.click();
    await expect(page.getByRole('combobox', { name: 'Action' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Destination' }).click();
    await page.getByRole('option', { name: 'Elsewhere', exact: true }).click();

    // the line now says where it goes, without opening anything
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Action' })).toHaveCount(0);
    await expect(summary.locator('.fig-interaction-target')).toHaveText('Elsewhere');

    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
    await removeNodes(page, [id, dest]);
  });

  test('the trigger menu offers every trigger the runtime honours', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Hotspot', x: 400, y: 1500, w: 60, h: 60 });
    // the labels follow the prototype device, so this test states the one it means
    await setDevice(page, 'none');
    await select(page, [id]);
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();
    await addInteraction(page);

    await page.getByRole('combobox', { name: 'Trigger' }).click();
    for (const label of [
      'None',
      'On click',
      'On drag',
      'While hovering',
      'While pressing',
      'Key/Gamepad',
      'Mouse enter',
      'Mouse leave',
      'Mouse down',
      'Mouse up',
      'After delay',
    ]) {
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
    }

    // drag and mouse-up were both wired in the runtime long before the menu
    // offered them, which is the bug this pins
    await page.getByRole('option', { name: 'Mouse up', exact: true }).click();
    expect((await doc(page))[id].interactions![0].trigger).toBe('mouse-up');

    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
    await removeNodes(page, [id]);
  });

  test('a touch device taps rather than clicks', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Tappable', x: 500, y: 1500, w: 60, h: 60 });
    await setDevice(page, 'phone');
    await select(page, [id]);
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();
    await addInteraction(page);

    await page.getByRole('combobox', { name: 'Trigger' }).click();
    await expect(page.getByRole('option', { name: 'On tap', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Touch down', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'On click', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await setDevice(page, 'none');
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
    await removeNodes(page, [id]);
  });

  test('the animation menu has both halves of move and slide', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Mover', x: 600, y: 1500, w: 60, h: 60 });
    await select(page, [id]);
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();
    await addInteraction(page);

    await page.locator('.fig-interaction .fig-row').last().getByRole('combobox').first().click();
    for (const label of ['Move in', 'Move out', 'Slide in', 'Slide out']) {
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole('option', { name: 'Move out', exact: true }).click();
    expect((await doc(page))[id].interactions![0].transition.type).toBe('move-out');

    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
    await removeNodes(page, [id]);
  });

  test('the State section says what a navigation forgets', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Goer', x: 700, y: 1500, w: 60, h: 60 });
    await setDevice(page, 'none');
    await select(page, [id]);
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();
    await addInteraction(page);

    // it is collapsed until you open it, as Figma's is
    const state = page.locator('.fig-state');
    await expect(state.getByRole('button', { name: 'State' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await state.getByRole('button', { name: 'State' }).click();

    await state.getByRole('checkbox').first().check();
    await state.getByRole('checkbox').nth(1).check();

    const written = (await doc(page))[id].interactions![0];
    expect(written.resetScroll).toBe(true);
    expect(written.resetComponentState).toBe(true);

    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
    await removeNodes(page, [id]);
  });

  test('a frame comes back scrolled where you left it, unless told to reset', async ({
    page,
  }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const a = store.create('frame', 'root', { name: 'Long', x: 2000, y: 0, w: 200, h: 200 });
      const b = store.create('frame', 'root', { name: 'Other', x: 2300, y: 0, w: 200, h: 200 });
      // something to scroll, and something tall enough inside it to need to
      const pane = store.create('frame', a, {
        name: 'Pane',
        x: 0,
        y: 0,
        w: 200,
        h: 200,
        scroll: 'vertical',
      });
      store.create('rect', pane, { name: 'Tall', x: 0, y: 0, w: 200, h: 900 });
      const there = store.create('rect', a, { name: 'There', x: 0, y: 0, w: 40, h: 40 });
      const backAgain = store.create('rect', b, { name: 'BackAgain', x: 0, y: 0, w: 40, h: 40 });
      store.addInteraction(there, { action: 'navigate', destination: b });
      store.addInteraction(backAgain, { action: 'navigate', destination: a });
      store.commit();
      return { a, b, pane, there, backAgain };
    });

    const pane = page.locator(`.fig-present [data-node-id="${ids.pane}"]`);
    const scrollTop = () => pane.evaluate((el) => el.scrollTop);

    await page.evaluate((id) => window.paperlike!.ui.getState().present(id), ids.a);
    await pane.evaluate((el) => {
      el.scrollTop = 300;
      el.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    await page.locator(`.fig-present [data-node-id="${ids.there}"]`).click();
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', ids.b);
    await page.locator(`.fig-present [data-node-id="${ids.backAgain}"]`).click();
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', ids.a);
    expect(await scrollTop()).toBe(300);

    // now say to forget, and the same trip lands at the top
    await page.evaluate((id) => {
      const store = window.paperlike!.store;
      const node = window.paperlike!.doc()[id];
      store.updateInteraction(id, node.interactions![0].id, { resetScroll: true });
      store.commit();
    }, ids.backAgain);

    await page.locator(`.fig-present [data-node-id="${ids.there}"]`).click();
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', ids.b);
    await page.locator(`.fig-present [data-node-id="${ids.backAgain}"]`).click();
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', ids.a);
    expect(await scrollTop()).toBe(0);

    await page.keyboard.press('Escape');
    await removeNodes(page, [ids.a, ids.b]);
  });

  test('a condition reads the variables the run is holding', async ({ page }) => {
    const check = (condition: string, vars: Record<string, string>) =>
      page.evaluate(
        ([expression, values]) =>
          window.paperlike!.evaluate(
            expression as string,
            values as Record<string, string>,
          ),
        [condition, vars] as const,
      );

    expect(await check('$count > 3', { count: '5' })).toBe(true);
    expect(await check('$count > 3', { count: '2' })).toBe(false);
    // numbers compare as numbers, not alphabetically
    expect(await check('$count > 9', { count: '10' })).toBe(true);
    expect(await check("$theme == 'dark'", { theme: 'dark' })).toBe(true);
    expect(await check('${Brand/Primary} == "red"', { 'Brand/Primary': 'red' })).toBe(true);
    expect(await check('$a and not $b', { a: 'true', b: 'false' })).toBe(true);
    expect(await check('$a or $b', { a: 'false', b: 'false' })).toBe(false);
    expect(await check('($count > 1) and $theme == "dark"', { count: '2', theme: 'dark' })).toBe(
      true,
    );
    // an empty condition is the branch you always take; nonsense is never taken
    expect(await check('', {})).toBe(true);
    expect(await check('$a >', { a: '1' })).toBe(false);
    // a name the run never set is empty, and so false
    expect(await check('$missing', {})).toBe(false);
  });

  test('the Conditional editor builds an if / else-if / else list', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Brancher', x: 800, y: 1500, w: 60, h: 60 });
    await setDevice(page, 'none');
    await select(page, [id]);
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();
    await addInteraction(page);

    await page.getByRole('combobox', { name: 'Action' }).click();
    await page.getByRole('option', { name: 'Conditional', exact: true }).click();

    const branches = page.locator('.fig-branches');
    await branches.getByRole('button', { name: 'Add condition' }).click();
    await branches.getByRole('textbox', { name: 'Condition' }).fill('$gate == "open"');
    await branches.getByRole('textbox', { name: 'Condition' }).press('Enter');
    await branches.getByRole('button', { name: 'Add else' }).click();

    const written = (await doc(page))[id].interactions![0];
    expect(written.action).toBe('conditional');
    expect(written.branches).toHaveLength(2);
    expect(written.branches![0].condition).toBe('$gate == "open"');
    // the else carries no condition — that is what makes it the else
    expect(written.branches![1].condition).toBeUndefined();
    // and it stays last when another condition is added
    await branches.getByRole('button', { name: 'Add condition' }).click();
    const after = (await doc(page))[id].interactions![0].branches!;
    expect(after).toHaveLength(3);
    expect(after[2].condition).toBeUndefined();

    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
    await removeNodes(page, [id]);
  });

  test('a conditional runs the branch whose condition holds', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const a = store.create('frame', 'root', { name: 'CondA', x: 2600, y: 0, w: 200, h: 200 });
      const yes = store.create('frame', 'root', { name: 'CondYes', x: 2900, y: 0, w: 200, h: 200 });
      const no = store.create('frame', 'root', { name: 'CondNo', x: 3200, y: 0, w: 200, h: 200 });
      const hotspot = store.create('rect', a, { name: 'Decide', x: 0, y: 0, w: 60, h: 60 });
      store.commit();
      return { a, yes, no, hotspot };
    });

    // a variable to branch on, and a conditional that reads it
    const gate = await page.evaluate(
      ([hotspot, yes, no]) => {
        const store = window.paperlike!.store;
        const token = store.addToken({ name: 'gate', type: 'string', value: 'open' });
        const id = store.addInteraction(hotspot!, { action: 'conditional' })!;
        store.updateInteraction(hotspot!, id, {
          branches: [
            {
              id: 'b1',
              condition: "$gate == 'open'",
              actions: [{ id: 'a1', trigger: 'none', delay: 0, action: 'navigate', destination: yes }],
            },
            {
              id: 'b2',
              actions: [{ id: 'a2', trigger: 'none', delay: 0, action: 'navigate', destination: no }],
            },
          ],
        });
        store.commit();
        return token;
      },
      [ids.hotspot, ids.yes, ids.no] as const,
    );

    await page.evaluate((id) => window.paperlike!.ui.getState().present(id), ids.a);
    await page.locator(`.fig-present [data-node-id="${ids.hotspot}"]`).click();
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', ids.yes);
    await page.keyboard.press('Escape');

    // close the gate and the else branch is the one that runs
    await page.evaluate((token) => {
      const store = window.paperlike!.store;
      store.updateToken(token, { value: 'shut' });
      store.commit();
    }, gate);

    await page.evaluate((id) => window.paperlike!.ui.getState().present(id), ids.a);
    await page.locator(`.fig-present [data-node-id="${ids.hotspot}"]`).click();
    await expect(page.locator('.fig-present-screen')).toHaveAttribute('data-frame-id', ids.no);
    await page.keyboard.press('Escape');

    await removeNodes(page, [ids.a, ids.yes, ids.no]);
  });

  test('Play/Pause and Set playhead drive a video on the frame', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = window.paperlike!.store;
      const frame = store.create('frame', 'root', { name: 'Reel', x: 3600, y: 0, w: 200, h: 200 });
      const clipNode = store.create('rect', frame, {
        name: 'Clip',
        x: 0,
        y: 60,
        w: 200,
        h: 120,
        video: { src: '/clip.mp4', loop: false, muted: true, autoplay: false, fit: 'cover' },
      });
      const button = store.create('rect', frame, { name: 'Toggle', x: 0, y: 0, w: 60, h: 40 });
      const seeker = store.create('rect', frame, { name: 'Seek', x: 70, y: 0, w: 60, h: 40 });
      store.commit();
      return { frame, clipNode, button, seeker };
    });

    await page.evaluate(
      ([button, seeker, clipNode]) => {
        const store = window.paperlike!.store;
        const a = store.addInteraction(button!, { action: 'play-pause' })!;
        store.updateInteraction(button!, a, { animation: clipNode, behavior: 'play' });
        const b = store.addInteraction(seeker!, { action: 'set-playhead' })!;
        store.updateInteraction(seeker!, b, { animation: clipNode, timestamp: 0.25 });
        store.commit();
      },
      [ids.button, ids.seeker, ids.clipNode] as const,
    );

    await page.evaluate((id) => window.paperlike!.ui.getState().present(id), ids.frame);
    const video = page.locator(`.fig-present [data-node-id="${ids.clipNode}"] video`);
    await expect(video).toHaveCount(1);

    // Whether a clip actually decodes is the browser's business, not ours, and a
    // real one cannot start in a headless run — so the media element is stubbed
    // and what the test pins is the thing this code owns: that clicking asks the
    // right element to play, and that a playhead lands on the right second.
    await page.evaluate(() => {
      const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
      proto.play = function (this: Record<string, unknown>) {
        this.__playing = true;
        return Promise.resolve();
      };
      proto.pause = function (this: Record<string, unknown>) {
        this.__playing = false;
      };
      Object.defineProperty(proto, 'paused', {
        configurable: true,
        get(this: Record<string, unknown>) {
          return this.__playing !== true;
        },
      });
      Object.defineProperty(proto, 'currentTime', {
        configurable: true,
        get(this: Record<string, unknown>) {
          return (this.__at as number) ?? 0;
        },
        set(this: Record<string, unknown>, value: number) {
          this.__at = value;
        },
      });
    });

    expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);

    await page.locator(`.fig-present [data-node-id="${ids.button}"]`).click();
    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.paused))
      .toBe(false);

    await page.locator(`.fig-present [data-node-id="${ids.seeker}"]`).click();
    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => Math.round(el.currentTime * 100)))
      .toBe(25);

    await page.keyboard.press('Escape');
    await removeNodes(page, [ids.frame]);
  });

  test('the State section offers all three of Figma\'s resets', async ({ page }) => {
    const id = await makeNode(page, 'rect', { name: 'Resetter', x: 900, y: 1500, w: 60, h: 60 });
    await setDevice(page, 'none');
    await select(page, [id]);
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();
    await addInteraction(page);

    const state = page.locator('.fig-state');
    await state.getByRole('button', { name: 'State' }).click();
    for (const label of ['Reset scroll position', 'Reset component state', 'Reset video state']) {
      await expect(state.getByText(label, { exact: true })).toBeVisible();
    }
    await state.getByRole('checkbox').nth(2).check();
    expect((await doc(page))[id].interactions![0].resetVideo).toBe(true);

    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
    await removeNodes(page, [id]);
  });

  test('Scroll behavior reads the way Figma words it', async ({ page }) => {
    const frame = await makeNode(page, 'frame', {
      name: 'Scroller',
      x: 1000,
      y: 1500,
      w: 200,
      h: 200,
    });
    await select(page, [frame]);
    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Prototype' }).click();

    // a frame gets Overflow, in Figma's order
    await page.getByRole('combobox', { name: 'Overflow' }).click();
    for (const label of ['No scrolling', 'Horizontal', 'Vertical', 'Both directions']) {
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole('option', { name: 'Vertical', exact: true }).click();
    expect((await doc(page))[frame].scroll).toBe('vertical');

    // a layer inside one gets Position, with the parenthesised names Figma uses
    const child = await page.evaluate((parent) => {
      const store = window.paperlike!.store;
      const id = store.create('rect', parent, { name: 'Pinned', x: 0, y: 0, w: 60, h: 60 });
      store.commit();
      return id;
    }, frame);
    await select(page, [child]);
    await page.getByRole('combobox', { name: 'Position' }).click();
    for (const label of [
      'Scroll with parent',
      'Fixed (stay in place)',
      'Sticky (stop at top edge)',
    ]) {
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
    await page.getByRole('option', { name: 'Fixed (stay in place)', exact: true }).click();
    expect((await doc(page))[child].scrollBehavior).toBe('fixed');

    await page.locator('.fig > .fig-tabs .fig-tab', { hasText: 'Design' }).click();
    await removeNodes(page, [frame]);
  });

  test('a spring easing becomes a sampled linear() curve', async ({ page }) => {
    const css = await page.evaluate(() =>
      window.paperlike!.easingCss({ easing: 'bouncy', duration: 400 }),
    );
    expect(css.startsWith('linear(')).toBe(true);
    // a bouncy spring overshoots, so some sample sits past its destination
    const samples = css
      .slice('linear('.length, -1)
      .split(',')
      .map((n: string) => Number(n));
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(1);
    expect(Math.max(...samples)).toBeGreaterThan(1);

    // and a plain curve stays a curve
    expect(
      await page.evaluate(() =>
        window.paperlike!.easingCss({ easing: 'ease-out-back', duration: 400 }),
      ),
    ).toContain('cubic-bezier');
  });
});

/**
 * Deep links.
 *
 * A link that only names the file is a link to "somewhere in this document",
 * which is no use in a review or a handoff. `?node=` is the addressing
 * primitive underneath comments, agent references and "look at this bit".
 */
test.describe('deep links', () => {
  test('?node= opens on the right page, selected and framed', async ({ page }) => {
    await openEditor(page);
    const id = await makeNode(page, 'rect', {
      name: 'Deep target',
      x: 4200,
      y: 3800,
      w: 120,
      h: 90,
      fill: '#F2637F',
    });

    await page.goto(`/f/testfile00?node=${id}`);
    await page.waitForFunction((room) => window.paperlike?.room === room, 'testfile00');

    // selected…
    await expect
      .poll(() => page.evaluate(() => window.paperlike!.ui.getState().selection))
      .toEqual([id]);

    // …and actually on screen, which is the half a plain selection would miss
    await expect(page.locator(`[data-node-id="${id}"]`)).toBeInViewport();

    await removeNodes(page, [id]);
  });

  test('an id that is not in the document is ignored, not obeyed', async ({ page }) => {
    await openEditor(page);
    await page.goto('/f/testfile00?node=not-a-real-node');
    await page.waitForFunction((room) => window.paperlike?.room === room, 'testfile00');
    // no selection, no crash, and the canvas still framed itself
    await expect
      .poll(() => page.evaluate(() => window.paperlike!.ui.getState().selection))
      .toEqual([]);
    await expect(page.locator('[data-canvas-root]')).toBeVisible();
  });
});

/**
 * Auto layout, dragged on the canvas.
 *
 * Spacing is a number you arrive at by looking, so the gesture matters more
 * than the field. These drive the real pointer over the real gutter, because
 * the thing that can break is the measuring — the mutation is the same
 * `store.update` the panel has always called.
 */
test.describe('flex handles', () => {
  /** A row of three boxes in an auto-layout frame. */
  async function stack(page: Page, direction: 'row' | 'column') {
    const frame = await makeNode(page, 'frame', {
      name: 'Stack',
      x: 60,
      y: 60,
      w: 400,
      h: 200,
      fill: '#ffffff',
      flex: {
        mode: 'flex',
        direction,
        gap: 20,
        padding: [24, 24, 24, 24],
        align: 'start',
        justify: 'start',
        wrap: false,
      },
    });
    for (const name of ['A', 'B', 'C']) {
      await page.evaluate(
        ({ parent, label }) =>
          window.paperlike!.store.create('rect', parent, {
            name: label,
            w: 60,
            h: 40,
            fill: '#0d99ff',
          }),
        { parent: frame, label: name },
      );
    }
    await select(page, [frame]);
    return frame;
  }

  /** The frame's layout spec. Non-null by construction — `stack` sets one. */
  const flexOf = async (page: Page, id: string) => {
    const flex = await page.evaluate((node) => window.paperlike!.doc()[node].flex, id);
    expect(flex, 'the frame lost its auto layout').not.toBeNull();
    return flex!;
  };

  test('dragging a gutter changes the gap', async ({ page }) => {
    const frame = await stack(page, 'row');
    const before = await flexOf(page, frame);

    const gutter = page.locator('.fig-flex-gap').first();
    await expect(gutter).toBeVisible();
    const box = (await gutter.boundingBox())!;
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: 30, y: 0 });

    const after = await flexOf(page, frame);
    expect(after.gap).toBe(before.gap + 30);
    // the padding was not along for the ride
    expect(after.padding).toEqual(before.padding);

    await removeNodes(page, [frame]);
  });

  test('dragging the left band changes only that padding', async ({ page }) => {
    const frame = await stack(page, 'row');

    // side 3 is the left edge; it is the fourth band rendered
    const band = page.locator('.fig-flex-pad').nth(3);
    const box = (await band.boundingBox())!;
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: 16, y: 0 });

    const after = await flexOf(page, frame);
    expect(after.padding).toEqual([24, 24, 24, 40]);

    await removeNodes(page, [frame]);
  });

  test('⌥ takes the opposite edge with it', async ({ page }) => {
    const frame = await stack(page, 'row');

    const band = page.locator('.fig-flex-pad').nth(3);
    const box = (await band.boundingBox())!;
    await page.keyboard.down('Alt');
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: 10, y: 0 });
    await page.keyboard.up('Alt');

    const after = await flexOf(page, frame);
    expect(after.padding).toEqual([24, 34, 24, 34]);

    await removeNodes(page, [frame]);
  });

  test('a column frame gets horizontal gutters, and the gap still follows y', async ({ page }) => {
    const frame = await stack(page, 'column');
    const before = await flexOf(page, frame);

    const gutter = page.locator('.fig-flex-gap').first();
    const box = (await gutter.boundingBox())!;
    // wider than tall: the gutter of a column runs across, not down
    expect(box.width).toBeGreaterThan(box.height);
    await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: 0, y: -12 });

    expect((await flexOf(page, frame)).gap).toBe(before.gap - 12);
    await removeNodes(page, [frame]);
  });

  test('a frame with no auto layout has no handles', async ({ page }) => {
    const plain = await makeNode(page, 'frame', { name: 'Plain', x: 700, y: 60, w: 200, h: 120 });
    await select(page, [plain]);
    await expect(page.locator('.fig-flex-gap')).toHaveCount(0);
    await expect(page.locator('.fig-flex-pad')).toHaveCount(0);
    await removeNodes(page, [plain]);
  });
});
