import { headless } from './mcp-render';
import { importDocument, readInPage, type NodeSpec, type ReadOptions } from '../src/lib/html-import';

/**
 * HTML into the canvas — the direction that makes an agent cheap.
 *
 * Every other write tool here is one call per layer, which is fine for an edit
 * and hopeless for a build: a login screen is thirty layers and thirty round
 * trips. But this canvas *is* HTML and CSS, so the inverse is the same mapping
 * read backwards. The walk itself lives in `src/lib/html-import.ts`, shared
 * with the editor's AI assistant, which runs it in a hidden iframe; here it
 * runs in headless Chromium.
 */

export type { NodeSpec, ReadOptions };

/**
 * Lays the markup out and reads the result back as a node tree.
 *
 * Runs entirely inside the page: one `evaluate` rather than a call per element,
 * because a per-element round trip over CDP is the same mistake at a smaller
 * scale.
 */
export async function readHtml(html: string, options: ReadOptions = {}): Promise<NodeSpec[]> {
  const width = Math.min(4096, Math.max(1, Math.round(options.width ?? 1440)));
  const page = await (await headless()).newPage({ viewport: { width, height: 900 } });
  try {
    await page.setContent(importDocument(html, options), { waitUntil: 'domcontentloaded' });
    // web fonts and remote images decide the measurements, so they are worth a
    // moment — but an offline machine still gets a tree, with fallback metrics
    await page.waitForLoadState('load', { timeout: 4000 }).catch(() => undefined);
    return (await page.evaluate(readInPage)) as NodeSpec[];
  } finally {
    await page.close().catch(() => undefined);
  }
}
