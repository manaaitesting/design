import { expect, test } from '@playwright/test';
import { toTailwind, toUtilities } from '../src/export/tailwind';
import { toHtml } from '../src/export/toCode';
import { flatColor, toAndroidXml, toSwiftUI } from '../src/export/toNative';
import { makeNode } from '../src/document/defaults';
import { ROOT_ID, type Doc } from '../src/document/types';

/**
 * The Tailwind export.
 *
 * Checked as a pure function rather than through the dialog, because what can
 * go wrong here is arithmetic and table lookups, not clicking. The property
 * that matters most is the one asserted last: nothing is dropped. An exporter
 * that silently loses a declaration produces code that looks fine and renders
 * wrong, which is the worst failure a handoff tool has.
 */

/** A card with a laid-out frame, a heading and a filled button inside it. */
function build(): Doc {
  const doc: Doc = {
    [ROOT_ID]: makeNode(ROOT_ID, 'page', null, { children: ['card'] }),
    card: makeNode('card', 'frame', ROOT_ID, {
      name: 'Card',
      x: 0,
      y: 0,
      w: 320,
      h: 200,
      fill: '#101828',
      radius: 12,
      children: ['title', 'cta'],
      flex: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: [20, 20, 20, 20],
        align: 'stretch',
        justify: 'start',
        wrap: false,
      },
    }),
    title: makeNode('title', 'text', 'card', {
      name: 'Title',
      w: 280,
      h: 32,
      text: 'Pro',
      font: {
        family: 'Inter',
        size: 24,
        weight: 600,
        lineHeight: 1.2,
        letterSpacing: 0,
        align: 'left',
        color: '#ffffff',
      },
    }),
    cta: makeNode('cta', 'frame', 'card', {
      name: 'CTA',
      w: 280,
      h: 40,
      fill: '#635bff',
      radius: 8,
    }),
  };
  return doc;
}

test('a declaration becomes the utility a person would have written', () => {
  expect(toUtilities('display', 'flex')).toEqual(['flex']);
  expect(toUtilities('flex-direction', 'column')).toEqual(['flex-col']);
  expect(toUtilities('justify-content', 'space-between')).toEqual(['justify-between']);
  expect(toUtilities('gap', '12px')).toEqual(['gap-3']);
  expect(toUtilities('padding-top', '20px')).toEqual(['pt-5']);
  // the four-value shorthand nodeStyle writes is up to four utilities
  expect(toUtilities('padding', '20px 20px 20px 20px')).toEqual(['p-5']);
  expect(toUtilities('padding', '8px 16px 8px 16px')).toEqual(['py-2', 'px-4']);
  expect(toUtilities('padding', '1px 2px 3px 4px')).toEqual(['pt-px', 'pr-0.5', 'pb-[3px]', 'pl-1']);
  // the type scale is not the spacing scale, and confusing them is silent
  expect(toUtilities('font-size', '24px')).toEqual(['text-2xl']);
  expect(toUtilities('font-size', '13px')).toEqual(['text-[13px]']);
  expect(toUtilities('border-width', '1px')).toEqual(['border']);
  expect(toUtilities('border-radius', '12px')).toEqual(['rounded-xl']);
  expect(toUtilities('font-weight', '600')).toEqual(['font-semibold']);
  expect(toUtilities('opacity', '0.5')).toEqual(['opacity-50']);
  expect(toUtilities('width', '100%')).toEqual(['w-full']);
  expect(toUtilities('width', 'fit-content')).toEqual(['w-fit']);
  expect(toUtilities('flex', '1 1 0')).toEqual(['flex-1']);
});

test('an off-scale length becomes an arbitrary value, not the nearest step', () => {
  // Rounding 13px to gap-3 would be a lie about the design, and the whole point
  // of this exporter is that it does not lie about the design.
  expect(toUtilities('gap', '13px')).toEqual(['gap-[13px]']);
  expect(toUtilities('border-radius', '7px')).toEqual(['rounded-[7px]']);
  expect(toUtilities('margin-top', '-8px')).toEqual(['-mt-2']);
});

test('a variable survives as a variable', () => {
  // Flattening var(--brand) to its hex would break the export the moment the
  // theme changed — the reason the canvas stores the reference in the first place.
  expect(toUtilities('background-color', 'var(--brand)')).toEqual(['bg-[var(--brand)]']);
  expect(toUtilities('color', 'var(--ink)')).toEqual(['text-[var(--ink)]']);
});

test('a property with no utility at all still lands in the class list', () => {
  expect(toUtilities('mask-image', 'url(#a)')).toEqual(['[mask-image:url(#a)]']);
  // spaces are illegal inside an arbitrary value; underscores are how Tailwind
  // spells them
  expect(toUtilities('grid-template-columns', 'repeat(3, 1fr)')).toEqual([
    '[grid-template-columns:repeat(3,_1fr)]',
  ]);
});

test('a subtree exports as classes on the same markup', () => {
  const { markup } = toTailwind('card', build());

  // the layout came across as layout, not as a stack of absolute boxes
  expect(markup).toContain('flex');
  expect(markup).toContain('flex-col');
  expect(markup).toContain('gap-3');
  expect(markup).toContain('p-5');
  expect(markup).toContain('rounded-xl');
  expect(markup).toContain('bg-[#101828]');
  // the button inside it kept its own paint and radius
  expect(markup).toContain('bg-[#635bff]');
  expect(markup).toContain('rounded-lg');
  // the heading kept its type
  expect(markup).toContain('text-2xl');
  expect(markup).toContain('font-semibold');
  // and there is no stylesheet left to import
  expect(markup).not.toContain(".css'");
  expect(markup).not.toMatch(/className="[A-Za-z0-9_-]+"/);
});

test('nothing is dropped: every declaration reaches the class list', () => {
  const doc = build();
  // a property the utility tables have never heard of
  doc.card = { ...doc.card, blend: 'multiply', opacity: 0.9 };
  const { markup, css } = toTailwind('card', doc);

  expect(markup).toContain('mix-blend-multiply');
  expect(markup).toContain('opacity-90');
  // The only CSS left is what cannot live on an element — here the `@import`
  // for the face the design uses. No layer rule survives, which is the check
  // that every declaration found a class.
  expect(css).toContain('@import');
  expect(css).not.toMatch(/^\./m);
});

/**
 * SwiftUI and Android XML, the two languages Figma's handoff offers beside CSS.
 *
 * The property under test is the same one the Tailwind export is held to:
 * nothing is invented. Both emitters read their numbers back out of
 * `nodeStyle()`, so what they say about a layer cannot drift from what the
 * canvas draws — which is why the assertions below are about the *values*
 * rather than about the shape of the snippet.
 */
test('a colour reaches both platforms in the form each one spells it', () => {
  expect(flatColor('#635bff')).toEqual({ hex: '#635BFF', alpha: 1 });
  expect(flatColor('#abc')).toEqual({ hex: '#AABBCC', alpha: 1 });
  expect(flatColor('rgba(16, 24, 40, 0.5)')).toEqual({ hex: '#101828', alpha: 0.5 });
  // a gradient has no one colour, and guessing at one would be a lie
  expect(flatColor('linear-gradient(90deg, #fff, #000)')).toBeNull();
  expect(flatColor(undefined)).toBeNull();
});

test('the card becomes a SwiftUI view with its own numbers', () => {
  const swift = toSwiftUI('card', build());

  // the auto layout is the stack, with the gap it actually has
  expect(swift).toContain('VStack(spacing: 12)');
  expect(swift).toContain('.padding(20)');
  // size, fill and radius, all as the canvas has them
  expect(swift).toContain('.frame(width: 320, height: 200)');
  expect(swift).toContain('Color(hex: "#101828")');
  expect(swift).toContain('cornerRadius: 12');
  // the text, its size and its weight
  expect(swift).toContain('Text("Pro")');
  expect(swift).toContain('.font(.system(size: 24, weight: .semibold))');
  expect(swift).toContain('Color(hex: "#FFFFFF")');
  // and the helper the snippet needs to compile travels with it
  expect(swift).toContain('extension Color {');
});

test('the card becomes an Android layout with its own numbers', () => {
  const xml = toAndroidXml('card', build());

  expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
  expect(xml).toContain('xmlns:android="http://schemas.android.com/apk/res/android"');
  // a laid-out frame is a LinearLayout, and it keeps its direction
  expect(xml).toContain('<LinearLayout');
  expect(xml).toContain('android:orientation="vertical"');
  expect(xml).toContain('android:layout_width="320dp"');
  expect(xml).toContain('android:background="#101828"');
  expect(xml).toContain('android:paddingTop="20dp"');
  // text carries sp rather than dp, which is the whole point of the unit
  expect(xml).toContain('<TextView');
  expect(xml).toContain('android:text="Pro"');
  expect(xml).toContain('android:textSize="24sp"');
  expect(xml).toContain('android:textColor="#FFFFFF"');
  // every tag that opened is closed
  expect((xml.match(/<LinearLayout/g) ?? []).length).toBe((xml.match(/<\/LinearLayout>/g) ?? []).length);
});

/**
 * A link on a range of characters is an anchor.
 *
 * `linked()` reads the layer's own `link` and nothing else, so a run that
 * carried one came out as a blue span — visibly a link and clickable by
 * nobody. The words in the middle of a sentence are where a link usually is.
 */
test('a link on a run exports as an anchor around exactly those characters', () => {
  const doc: Doc = {
    [ROOT_ID]: makeNode(ROOT_ID, 'page', null, { children: ['line'] }),
    line: makeNode('line', 'text', ROOT_ID, {
      name: 'Consent',
      x: 0,
      y: 0,
      w: 320,
      h: 20,
      text: 'read our Terms first',
      runs: [
        { text: 'read our ' },
        { text: 'Terms', link: 'https://example.com/terms' },
        { text: ' first' },
      ],
      font: {
        family: 'Inter',
        size: 14,
        weight: 400,
        lineHeight: 1.4,
        letterSpacing: 0,
        align: 'left',
        color: '#101828',
      },
    }),
  };

  const html = toHtml('line', doc, [], [], []);

  expect(html).toContain('<a href="https://example.com/terms"');
  expect(html).toMatch(/<a [^>]*>[^<]*<span[^>]*>Terms<\/span><\/a>/);
  // and the words either side of it are outside the anchor
  expect(html.match(/<a /g)?.length).toBe(1);
  expect(html).not.toMatch(/<a[^>]*>[^<]*read our/);
});

/**
 * Text on a path exports as the SVG the canvas drew, not as a picture of it.
 *
 * This is the assertion that says the feature kept the invariant: the glyphs in
 * the exported markup are still text, laid out along the same `d` by the same
 * engine, and a reader can select them.
 */
test('a text layer on a path exports as real type along the same outline', () => {
  const doc: Doc = {
    [ROOT_ID]: makeNode(ROOT_ID, 'page', null, { children: ['ring', 'round'] }),
    ring: makeNode('ring', 'ellipse', ROOT_ID, { name: 'Ring', x: 0, y: 0, w: 200, h: 200 }),
    round: makeNode('round', 'text', ROOT_ID, {
      name: 'Round',
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      text: 'around we go',
      textPath: { source: 'ring', offset: 25, side: 'top' },
      font: {
        family: 'Inter',
        size: 18,
        weight: 600,
        lineHeight: 1.4,
        letterSpacing: 0,
        align: 'left',
        color: '#101828',
      },
    }),
  };

  const html = toHtml('round', doc, [], [], []);

  expect(html).toContain('<textPath');
  expect(html).toContain('href="#');
  expect(html).toContain('startOffset="25%"');
  expect(html).toContain('side="left"');
  // the words are still words, and the type is the layer's own
  expect(html).toContain('around we go');
  expect(html).toContain('font-size="18"');
  expect(html).toContain('font-weight="600"');
  expect(html).toContain('fill="#101828"');
  // and the outline is the ellipse's, drawn in the box the two layers share
  const path = /<defs><path id="([^"]+)" d="([^"]+)"\/><\/defs>/.exec(html);
  expect(path).not.toBeNull();
  expect(html).toContain(`href="#${path![1]}"`);
  expect(path![2].length).toBeGreaterThan(10);
});
