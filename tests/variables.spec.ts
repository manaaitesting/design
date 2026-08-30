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
