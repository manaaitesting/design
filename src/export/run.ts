'use client';

import { download, nodeToPng, nodeToSvg, safeFilename } from './raster';
import { toHtml, toJson, toReact } from './toCode';
import type { Doc, ExportSetting, Token } from '../document/types';
import type { Collection } from '../document/variables';

/**
 * Running a layer's export settings.
 *
 * Figma's Export button does not open anything: it saves what the rows say, in
 * order. Both the panel and the dialog end up here so a file saved from one is
 * byte-identical to the same settings saved from the other.
 */

/** The suffix goes into a filename, so it is filtered like one. */
export function safeSuffix(suffix: string | undefined): string {
  if (!suffix) return '';
  return suffix.trim().replace(/[^a-zA-Z0-9._@-]+/g, '-').replace(/-$/, '');
}

export interface ExportContext {
  doc: Doc;
  tokens: Token[];
  collections: Collection[];
  /** the theme's custom properties, re-declared on the rasterised clone */
  tokenVars: Record<string, string>;
  zoom: number;
}

export async function runExport(
  setting: ExportSetting,
  nodeId: string,
  context: ExportContext,
): Promise<void> {
  const node = context.doc[nodeId];
  if (!node) throw new Error('That layer is gone.');
  const name = safeFilename(node.name) + safeSuffix(setting.suffix);

  switch (setting.format) {
    case 'png': {
      const blob = await nodeToPng(
        nodeId,
        context.zoom,
        setting.scale,
        context.tokenVars,
        setting.contentsOnly,
      );
      download(blob, `${name}@${setting.scale}x.png`);
      return;
    }
    case 'svg': {
      const serialised = nodeToSvg(nodeId, context.zoom, context.tokenVars, setting.contentsOnly);
      if (!serialised) throw new Error('That layer is not on screen.');
      download(new Blob([serialised.svg], { type: 'image/svg+xml' }), `${name}.svg`);
      return;
    }
    case 'react': {
      const { markup, css } = toReact(nodeId, context.doc, context.tokens, context.collections);
      download(new Blob([markup], { type: 'text/plain' }), `${name}.jsx`);
      download(new Blob([css], { type: 'text/css' }), `${name}.css`);
      return;
    }
    case 'html': {
      const html = toHtml(nodeId, context.doc, context.tokens, context.collections);
      download(new Blob([html], { type: 'text/html' }), `${name}.html`);
      return;
    }
    case 'json':
    default: {
      const json = toJson(nodeId, context.doc);
      download(new Blob([json], { type: 'application/json' }), `${name}.json`);
    }
  }
}

/** Runs every setting on every layer given, in order. */
export async function runExports(
  ids: string[],
  context: ExportContext,
): Promise<{ saved: number; error?: string }> {
  let saved = 0;
  for (const id of ids) {
    for (const setting of context.doc[id]?.exports ?? []) {
      try {
        await runExport(setting, id, context);
        saved += 1;
      } catch (error) {
        return { saved, error: error instanceof Error ? error.message : 'Export failed.' };
      }
    }
  }
  return { saved };
}
