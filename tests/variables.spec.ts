import { expect, test } from '@playwright/test';
import { doc, openEditor, removeNodes, select } from './helpers';

/**
 * Components and variables — the two halves of a design system.
 *
 * These run through the real editor because the bugs they cover are seams
 * rather than functions: a nested instance that resolves correctly in the
 * document and still shows an empty panel, or a number variable the stylesheet
 * and the model disagree about, are both invisible to a unit test.
 */

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test.describe('nested instances', () => {
  /** A Button component, and a Card component that holds an instance of it. */
  async function composed(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const store = window.paperlike!.store;
      const button = store.create('frame', 'root', {
        name: 'Button', x: 700, y: 40, w: 120, h: 40, fill: '#4CC3F0', flex: null,
      });
      const label = store.create('text', button, { name: 'Label', x: 8, y: 8, w: 100, h: 20, text: 'Button' });
      store.createComponent(button);
      const prop = store.addComponentProp(button, { name: 'Label', type: 'text', value: 'Button' })!;
      store.bindProp(label, { prop, field: 'text' });

      const card = store.create('frame', 'root', {
        name: 'Card', x: 900, y: 40, w: 200, h: 120, fill: '#FFFFFF', flex: null,
      });
      store.createComponent(card);
      store.createInstance(button, card, { x: 20, y: 20 });
      store.commit();
      return { button, card, prop };
    });
  }

  test('placing a component that holds an instance keeps the inner one an instance', async ({ page }) => {
    const { button, card } = await composed(page);
    const placed = await page.evaluate(
      (id) => window.paperlike!.store.createInstance(id, 'root', { x: 700, y: 300 })!,
      card,
    );

    const nodes = await doc(page);
    const inner = nodes[placed].children[0];
    expect(nodes[inner].instanceOf).toBe(button);

    // and it wears the instance chrome, so the panel is not empty behind it
    await select(page, [inner]);
    await expect(page.getByTitle('Swap instance')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset overrides' })).toBeVisible();

    await removeNodes(page, [card, button, placed]);
  });

  test("a nested instance sets its own properties, not the outer one's", async ({ page }) => {
    const { button, card, prop } = await composed(page);
    const placed = await page.evaluate(
      (id) => window.paperlike!.store.createInstance(id, 'root', { x: 700, y: 300 })!,
      card,
    );
    const inner = (await doc(page))[placed].children[0];

    await page.evaluate(
      ([id, propId]) => window.paperlike!.store.setPropValue(id as string, propId as string, 'Save'),
      [inner, prop],
    );
    await page.waitForFunction(
      ([id]) => {
        const d = window.paperlike!.doc();
        return d[d[id as string].children[0]]?.text === 'Save';
      },
      [inner],
    );

    // the Card main's own button is untouched — the value belongs to this copy
    const nodes = await doc(page);
    const mainInner = nodes[card].children[0];
    expect(nodes[nodes[mainInner].children[0]].text).toBe('Button');

    await removeNodes(page, [card, button, placed]);
  });
});

test.describe('variant properties', () => {
  /** Three mains combined into one set, so there is room for a second axis. */
  async function matrix(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const store = window.paperlike!.store;
      const made = ['One', 'Two', 'Three'].map((name, i) => {
        const id = store.create('frame', 'root', {
          name, x: 700 + i * 160, y: 40, w: 120, h: 60, fill: '#DDDDDD', flex: null,
        });
        store.createComponent(id);
        return id;
      });
      const set = store.combineAsVariants(made)!;
      store.commit();
      return { one: made[0], two: made[1], three: made[2], set };
    });
  }

  test('a set takes a second variant axis, and every variant answers to it', async ({ page }) => {
    const { one, two, set } = await matrix(page);

    await select(page, [set]);
    await page.getByRole('button', { name: 'Add property' }).click();
    await page.getByRole('option', { name: 'Variant' }).click();
    await expect(page.getByRole('button', { name: /^Remove Variant$/ })).toBeVisible();

    const nodes = await doc(page);
    const added = nodes[set].props!.find((prop) => prop.name === 'Variant')!;
    expect(added.type).toBe('variant');
    // seeded on the variants that were already there, or the matcher would find
    // nothing for any value the picker offers
    expect(nodes[one].variantValues![added.id]).toBe('Default');
    expect(nodes[two].variantValues![added.id]).toBe('Default');

    await removeNodes(page, [set]);
  });

  test("retyping a variant's own value moves the set's options with it", async ({ page }) => {
    const { two, set } = await matrix(page);
    const prop = (await doc(page))[set].props![0];

    await select(page, [two]);
    const field = page.getByTitle(`${prop.name} value`);
    await expect(field).toHaveValue('Two');
    await field.fill('Hover');
    await field.blur();

    const nodes = await doc(page);
    expect(nodes[two].variantValues![prop.id]).toBe('Hover');
    // the set offers what its variants answer to, not a list typed beside them
    expect(nodes[set].props![0].options).toEqual(['One', 'Hover', 'Three']);

    await removeNodes(page, [set]);
  });

  test('an instance is set along both axes, and a combination no variant covers says so', async ({ page }) => {
    const { one, two, set } = await matrix(page);
    const size = (await doc(page))[set].props![0];

    await page.evaluate(
      ([setId, second, sizeId]) => {
        const store = window.paperlike!.store;
        const state = store.addComponentProp(setId as string, {
          name: 'State', type: 'variant', value: 'Default',
        })!;
        // One and Two share a size and differ by state; Three is the odd one out
        store.setVariantValue(second as string, sizeId as string, 'One');
        store.setVariantValue(second as string, state, 'Hover');
        store.commit();
      },
      [set, two, size.id] as const,
    );

    const instance = await page.evaluate(
      (id) => window.paperlike!.store.createInstance(id as string, 'root', { x: 700, y: 300 })!,
      one,
    );
    await select(page, [instance]);

    await page.getByRole('combobox', { name: 'State' }).click();
    await page.getByRole('option', { name: 'Hover' }).click();
    await page.waitForFunction(([id]) => window.paperlike!.ui.getState().selection[0] !== id, [instance]);
    const swapped = (await page.evaluate(() => window.paperlike!.ui.getState().selection))[0];
    expect((await doc(page))[swapped].instanceOf).toBe(two);

    // Three is only ever Default, so Three + Hover is a cell the set was never
    // given — and the panel says so rather than reverting in silence
    await page.getByRole('combobox', { name: size.name }).click();
    await page.getByRole('option', { name: 'Three' }).click();
    await expect(page.getByText(`No variant with ${size.name} = Three`)).toBeVisible();

    await removeNodes(page, [set, swapped]);
  });

  test('a variant left blank answers for every value of that property', async ({ page }) => {
    const { one, two, set } = await matrix(page);
    const size = (await doc(page))[set].props![0];

    const state = await page.evaluate(
      ([setId, second, sizeId]) => {
        const store = window.paperlike!.store;
        const id = store.addComponentProp(setId as string, {
          name: 'State', type: 'variant', value: 'Default',
        })!;
        store.setVariantValue(second as string, sizeId as string, '*');
        store.setVariantValue(second as string, id, 'Hover');
        store.commit();
        return id;
      },
      [set, two, size.id] as const,
    );

    const instance = await page.evaluate(
      (id) => window.paperlike!.store.createInstance(id as string, 'root', { x: 700, y: 300 })!,
      one,
    );
    const next = await page.evaluate(
      ([id, propId]) => window.paperlike!.store.setPropValue(id as string, propId as string, 'Hover'),
      [instance, state],
    );

    const nodes = await doc(page);
    // Two says nothing about size, so it answers for One's size as well
    expect(nodes[next!].instanceOf).toBe(two);
    // and `*` is not itself one of the values the picker offers
    expect(nodes[set].props![0].options).toEqual(['One', 'Three']);

    await removeNodes(page, [set, next!]);
  });
});
