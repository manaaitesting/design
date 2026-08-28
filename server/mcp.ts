#!/usr/bin/env -S npx tsx
import fs from 'node:fs';
import path from 'node:path';

// The MCP server is launched by the agent host, not by `pnpm dev`, so nothing
// has loaded the env for it. AUTH_SECRET is what signs the sync handshake.
const envFile = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { closeAll, openFile, outline } from './mcp-doc';
import { listAllFiles } from '../src/server/db';
import { toHtml, toJson, toReact } from '../src/export/toCode';
import { ROOT_ID, type NodeType, type SceneNode } from '../src/document/types';
import { DEFAULT_FONT } from '../src/document/defaults';
import { effectsOf, newEffect, splitColor } from '../src/document/effects';
import type { Effect, EffectType } from '../src/document/types';

/**
 * Paperlike's MCP server.
 *
 * Mirrors what Figma's server does for design-to-code — read a node's context,
 * get its metadata, walk the tree — and adds the other direction, because this
 * canvas is HTML/CSS all the way down: an agent can create and edit nodes and
 * the result is a real document, not a screenshot to interpret.
 */

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

const server = new McpServer(
  { name: 'paperlike', version: '0.1.0' },
  {
    instructions: [
      'Paperlike is a code-native design canvas. Every node maps onto CSS, so',
      '`get_design_context` returns the component the design actually is, not an',
      'approximation of it.',
      '',
      'Start with `list_files`, then `get_metadata` to see the tree, then',
      '`get_design_context` on the node you care about. Edits through',
      '`create_node` / `update_node` appear live on every open canvas.',
    ].join('\n'),
  },
);

// ── Reading ──────────────────────────────────────────────────────────────

server.registerTool(
  'list_files',
  {
    title: 'List design files',
    description: 'Every design file, with its id and when it was last touched.',
    inputSchema: {},
  },
  async () => {
    const files = listAllFiles();
    if (!files.length) {
      return text('No files yet. Create one in the app, or pass a known file id directly.');
    }
    return text(
      files
        .map((f) => `${f.id}  "${f.name}"  updated ${new Date(f.updated_at).toISOString()}`)
        .join('\n'),
    );
  },
);

server.registerTool(
  'get_metadata',
  {
    title: 'Get document outline',
    description:
      'The node tree for a file: ids, types, names, sizes and layout mode. Cheap — use it to find the node you want before asking for its context.',
    inputSchema: {
      fileId: z.string().describe('File id, e.g. "demofile0" — the last path segment of /f/<id>'),
      nodeId: z.string().optional().describe('Subtree root. Defaults to the page.'),
    },
  },
  async ({ fileId, nodeId }) => {
    const { store } = await openFile(fileId);
    const doc = store.getSnapshot();
    const root = nodeId ?? ROOT_ID;
    if (!doc[root]) return text(`No node "${root}" in ${fileId}.`);
    return text(outline(doc, root).join('\n'));
  },
);

server.registerTool(
  'get_design_context',
  {
    title: 'Get design as code',
    description:
      'The node as production code. `react` returns a component plus its stylesheet, `html` a self-contained file, `json` the raw scene graph. This is generated from the same style function the canvas renders with, so it is exact.',
    inputSchema: {
      fileId: z.string(),
      nodeId: z.string().describe('Node to export. Use get_metadata to find it.'),
      format: z.enum(['react', 'html', 'json']).default('react'),
    },
  },
  async ({ fileId, nodeId, format }) => {
    const { store } = await openFile(fileId);
    const doc = store.getSnapshot();
    if (!doc[nodeId]) return text(`No node "${nodeId}" in ${fileId}.`);
    const tokens = store.listTokens();
    const collections = store.listCollections();
    const fonts = store.listFonts();

    if (format === 'json') return text(toJson(nodeId, doc));
    if (format === 'html') return text(toHtml(nodeId, doc, tokens, collections, fonts));
    const { markup, css } = toReact(nodeId, doc, tokens, collections, fonts);
    return text(`${markup}\n/* ── stylesheet ── */\n\n${css}`);
  },
);

server.registerTool(
  'get_node',
  {
    title: 'Get node properties',
    description: 'Every property of one node, as JSON — position, size, layout, paint, text.',
    inputSchema: { fileId: z.string(), nodeId: z.string() },
  },
  async ({ fileId, nodeId }) => {
    const { store } = await openFile(fileId);
    const node = store.getSnapshot()[nodeId];
    return node ? text(JSON.stringify(node, null, 2)) : text(`No node "${nodeId}".`);
  },
);

server.registerTool(
  'get_variables',
  {
    title: 'Get theme tokens',
    description:
      'The file\'s design tokens. They publish as CSS custom properties, so a fill of "var(--brand)" resolves live and survives export.',
    inputSchema: { fileId: z.string() },
  },
  async ({ fileId }) => {
    const { store } = await openFile(fileId);
    const tokens = store.listTokens();
    if (!tokens.length) return text('No variables defined in this file.');
    const collections = store.listCollections();
    const lines = collections.map((collection) => {
      const mine = tokens.filter((t) => (t.collection ?? 'default') === collection.id);
      if (!mine.length) return '';
      const modes = collection.modes.map((mode) => mode.name).join(' · ');
      const rows = mine.map((t) => {
        const values = collection.modes
          .map((mode) => t.values?.[mode.id] ?? t.value)
          .join('  |  ');
        return `  --${t.name}: ${values}   (${t.type})`;
      });
      return `${collection.name}  [${modes}]\n${rows.join('\n')}`;
    });
    return text(lines.filter(Boolean).join('\n\n'));
  },
);

// ── Writing ──────────────────────────────────────────────────────────────

const NODE_TYPES = [
  'frame',
  'text',
  'rect',
  'ellipse',
  'image',
  'vector',
  'shader',
  'polygon',
  'star',
  'line',
  'arrow',
] as const;

const PROPS = z
  .object({
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    wMode: z.enum(['fixed', 'fit', 'fill']).optional(),
    hMode: z.enum(['fixed', 'fit', 'fill']).optional(),
    fill: z.string().nullable().optional().describe('Hex, CSS gradient, or var(--token)'),
    radius: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    rotation: z.number().optional(),
    text: z.string().optional().describe('Text nodes only'),
    sides: z.number().int().min(3).max(60).optional().describe('Polygon sides / star points'),
    innerRatio: z.number().min(0.01).max(1).optional().describe('Star inner radius, as a fraction'),
    arcStart: z.number().min(0).max(1).optional().describe('Ellipse arc start, in turns'),
    arcEnd: z.number().min(0).max(1).optional().describe('Ellipse arc end, in turns'),
    innerRadius: z.number().min(0).max(0.99).optional().describe('Ellipse hole, as a fraction'),
    closed: z.boolean().optional().describe('Vector paths only'),
    anchors: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          in: z.tuple([z.number(), z.number()]).nullable().optional(),
          out: z.tuple([z.number(), z.number()]).nullable().optional(),
        }),
      )
      .optional()
      .describe('Vector points, in the node\'s own space. `in`/`out` are cubic handles.'),
    font: z
      .object({
        family: z.string().optional(),
        size: z.number().optional(),
        weight: z.number().optional(),
        lineHeight: z.number().optional(),
        letterSpacing: z.number().optional(),
        align: z.enum(['left', 'center', 'right']).optional(),
        color: z.string().optional(),
      })
      .optional()
      .describe('Text nodes only. Partial — unset fields keep their current value.'),
    border: z
      .object({
        width: z.number().optional(),
        color: z.string().optional(),
        style: z.enum(['solid', 'dashed', 'dotted']).optional(),
        position: z.enum(['inside', 'center', 'outside']).optional(),
      })
      .nullable()
      .optional()
      .describe('null removes the border. Partial patches merge.'),
    shadow: z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
        blur: z.number().optional(),
        spread: z.number().optional(),
        color: z.string().optional(),
      })
      .nullable()
      .optional()
      .describe('null removes the shadow. Partial patches merge.'),
    effects: z
      .array(
        z
          .object({
            type: z.enum([
              'inner-shadow',
              'drop-shadow',
              'layer-blur',
              'background-blur',
              'noise',
              'texture',
              'glass',
              'shader',
            ]),
            visible: z.boolean().optional(),
            x: z.number().optional().describe('shadows: offset'),
            y: z.number().optional(),
            blur: z.number().optional().describe('shadows and uniform blurs'),
            spread: z.number().optional(),
            color: z.string().optional().describe('shadows and mono/duo noise'),
            opacity: z.number().min(0).max(1).optional().describe("the colour's own alpha"),
            blend: z.string().optional().describe('blend mode for this effect alone'),
            progressive: z.boolean().optional().describe('blurs: ramp start → end'),
            start: z.number().optional(),
            end: z.number().optional(),
            variant: z.enum(['mono', 'duo', 'multi']).optional().describe('noise'),
            sizeX: z.number().optional().describe('noise and texture grain size'),
            sizeY: z.number().optional(),
            density: z.number().min(0).max(1).optional(),
            color2: z.string().optional().describe('duo noise'),
            opacity2: z.number().min(0).max(1).optional(),
            grain: z.number().min(0).max(1).optional().describe('multi noise opacity'),
            radius: z.number().optional().describe('texture'),
            clip: z.boolean().optional().describe('texture: clip to shape'),
            refraction: z.number().min(0).max(1).optional().describe('glass'),
            depth: z.number().optional(),
          })
          .describe('Only the fields the type uses matter; the rest take Figma\'s defaults.'),
      )
      .nullable()
      .optional()
      .describe('The Effects list, in paint order. Replaces whatever the layer had.'),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    clip: z.boolean().optional(),
    flex: z
      .object({
        mode: z.enum(['flex', 'grid']).default('flex'),
        direction: z.enum(['row', 'column']).default('column'),
        gap: z.number().default(16),
        padding: z.array(z.number()).length(4).default([16, 16, 16, 16]),
        align: z.enum(['start', 'center', 'end', 'stretch']).default('start'),
        justify: z.enum(['start', 'center', 'end', 'between']).default('start'),
        wrap: z.boolean().default(false),
        columns: z.number().optional(),
        rows: z.number().optional().describe('grid rows; 0 fits as many as the children need'),
        crossGap: z.number().optional().describe('space between wrapped lines and grid rows'),
        alignContent: z
          .enum(['start', 'center', 'end', 'stretch', 'between'])
          .optional()
          .describe('how wrapped lines share the leftover cross-axis space'),
        strokesIncluded: z.boolean().optional().describe('count strokes inside the box'),
        stacking: z.enum(['first', 'last']).optional().describe('which sibling paints on top'),
        baseline: z.boolean().optional().describe('align text by its baseline'),
      })
      .nullable()
      .optional()
      .describe('Non-null makes this a layout container; children then flow.'),
    absolute: z
      .boolean()
      .optional()
      .describe('Opts this child out of its parent\'s auto layout, keeping its own x/y.'),
    alignSelf: z
      .enum(['auto', 'start', 'center', 'end', 'stretch'])
      .optional()
      .describe('Overrides the parent layout\'s cross-axis alignment for this child.'),
  })
  .describe('Any subset of a node\'s properties.');

const DEFAULT_BORDER = { width: 1, color: '#000000', style: 'solid', position: 'inside' } as const;
const DEFAULT_SHADOW = { x: 0, y: 2, blur: 8, spread: 0, color: 'rgba(0,0,0,0.2)' } as const;

/**
 * font/border/shadow are whole objects on a node, so a patch carrying one
 * would otherwise replace it outright — setting just `size` would drop the
 * colour with it. Merge each over what the node already has.
 *
 * `shadow` is also the older way of asking for one. A layer edited in the
 * panel keeps its shadows in the effects list, and the list wins when it is
 * there — so a legacy patch is folded into it rather than written somewhere
 * that no longer renders.
 */
function withSpecs(props: Record<string, unknown>, node?: SceneNode): Partial<SceneNode> {
  const out = { ...props };
  if (out.font) out.font = { ...(node?.font ?? DEFAULT_FONT), ...(out.font as object) };
  if (out.border) out.border = { ...(node?.border ?? DEFAULT_BORDER), ...(out.border as object) };
  if (out.shadow) out.shadow = { ...(node?.shadow ?? DEFAULT_SHADOW), ...(out.shadow as object) };

  if (Array.isArray(out.effects)) {
    out.effects = (out.effects as { type: EffectType }[]).map((effect, index) => ({
      ...newEffect(effect.type),
      id: `mcp-${index}`,
      ...effect,
    }));
    // the list supersedes the older fields, so retire them in the same patch
    Object.assign(out, { shadow: null, innerShadow: null, shadows: [] });
  } else if (out.shadow && node?.effects) {
    const spec = out.shadow as { x: number; y: number; blur: number; spread: number; color: string };
    const drop: Effect = { ...newEffect('drop-shadow'), ...spec, ...splitColor(spec.color) };
    const list = effectsOf(node);
    const at = list.findIndex((effect) => effect.type === 'drop-shadow');
    out.effects = at === -1 ? [...list, drop] : list.map((e, i) => (i === at ? { ...drop, id: e.id } : e));
    out.shadow = null;
  }
  return out as Partial<SceneNode>;
}

server.registerTool(
  'create_node',
  {
    title: 'Create a node',
    description:
      'Adds a node to a file. Appears on every open canvas immediately. Returns the new id.',
    inputSchema: {
      fileId: z.string(),
      type: z.enum(NODE_TYPES),
      parentId: z.string().optional().describe('Defaults to the page.'),
      props: PROPS.optional(),
    },
  },
  async ({ fileId, type, parentId, props }) => {
    const { store } = await openFile(fileId);
    const parent = parentId ?? ROOT_ID;
    if (!store.getSnapshot()[parent]) return text(`No parent "${parent}".`);
    const id = store.create(type as NodeType, parent, withSpecs(props ?? {}));
    await settle();
    return text(`Created ${type} ${id} in ${parent}.`);
  },
);

server.registerTool(
  'update_node',
  {
    title: 'Update a node',
    description: 'Changes properties on an existing node.',
    inputSchema: { fileId: z.string(), nodeId: z.string(), props: PROPS },
  },
  async ({ fileId, nodeId, props }) => {
    const { store } = await openFile(fileId);
    const node = store.getSnapshot()[nodeId];
    if (!node) return text(`No node "${nodeId}".`);
    store.update(nodeId, withSpecs(props, node));
    await settle();
    return text(`Updated ${nodeId}.`);
  },
);

server.registerTool(
  'delete_node',
  {
    title: 'Delete a node',
    description: 'Removes a node and everything inside it. Not undoable from here.',
    inputSchema: { fileId: z.string(), nodeId: z.string() },
  },
  async ({ fileId, nodeId }) => {
    const { store } = await openFile(fileId);
    const node = store.getSnapshot()[nodeId];
    if (!node) return text(`No node "${nodeId}".`);
    if (nodeId === ROOT_ID) return text('Refusing to delete the page.');
    store.remove([nodeId]);
    await settle();
    return text(`Deleted "${node.name}".`);
  },
);

server.registerTool(
  'set_variable',
  {
    title: 'Create or update a theme token',
    description: 'Tokens publish as CSS custom properties; reference one as var(--name).',
    inputSchema: {
      fileId: z.string(),
      name: z.string().describe('Without the leading --'),
      value: z.string(),
      type: z.enum(['color', 'number', 'text']).default('color'),
    },
  },
  async ({ fileId, name, value, type }) => {
    const { store } = await openFile(fileId);
    const existing = store.listTokens().find((t) => t.name === name);
    if (existing) store.updateToken(existing.id, { value, type });
    else store.addToken({ name, value, type });
    await settle();
    return text(`--${name}: ${value}`);
  },
);

/** Gives the CRDT a moment to flush to the sync server before we reply. */
function settle(ms = 120): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    closeAll();
    process.exit(0);
  });
}

await server.connect(new StdioServerTransport());
