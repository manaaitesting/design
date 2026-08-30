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
import { assetsIn, closeRenderer, decodeDataUrl, renderNode, svgOfShape, writeAsset } from './mcp-render';
import { readHtml, type NodeSpec } from './mcp-html';
import {
  codeConnectFor,
  createFile,
  getLibraryComponent,
  listAllFiles,
  listAllLibrary,
  listAllUsers,
  listLibraryForFile,
  mapCodeConnect,
  publishComponent,
  unmapCodeConnect,
} from '../src/server/db';
import { toHtml, toJson, toReact } from '../src/export/toCode';
import { toTailwind } from '../src/export/tailwind';
import { newId } from '../src/lib/id';
import {
  ROOT_ID,
  type InteractionAction,
  type NodeType,
  type SceneNode,
} from '../src/document/types';
import { DEFAULT_FONT } from '../src/document/defaults';
import {
  EFFECT_LABEL,
  EFFECT_MENU,
  EFFECT_PRESETS,
  effectsOf,
  newEffect,
  splitColor,
} from '../src/document/effects';
import { SHADERS, SHADER_BY_ID, SHADER_CATEGORIES, compose, defaultParams } from '../src/webgl/shaders';
import {
  DEFAULT_TRANSITION,
  describe,
  easingCss,
  flowsOn,
  interactionsOf,
  newInteraction,
} from '../src/document/prototype';
import { hasMotion, motionCss as timelineCss, motionOf } from '../src/document/motion';
import { defaultModes, publish, resolveToken } from '../src/document/variables';
import type {
  BooleanOp,
  Doc,
  Effect,
  EffectType,
  FlexSpec,
  PropType,
  StyleSlot,
  TransitionSpec,
} from '../src/document/types';

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
      '`get_design_context` on the node you care about — it takes several node',
      'ids at once, so one call reads every component you need rather than one',
      'call each. `get_screenshot` draws a node headlessly when you need to look',
      'at it, and `download_assets` writes it and its images out to disk.',
      '',
      'Before generating anything, check `get_code_connect_map`: a node that is',
      'already implemented should be reused, not rebuilt. `search_design_system`',
      'and `get_variable_defs` say which components and variables the design is',
      'made of, and `get_motion_context` says how it behaves.',
      '',
      'BUILD FROM HTML. `write_html` is the fastest way to make anything here:',
      'send the markup and the CSS and it lays them out in a real browser, reads',
      'the computed styles back, and writes real layers — a flex container becomes',
      'an auto layout, an element of pure text becomes a text layer. A screen is',
      'one call. Put `data-ref` on an element to get its id back.',
      '',
      'BUILD IN ONE CALL. `edit_design` takes a list of operations and runs them',
      'in order, and any op that creates something can be given a `ref` that later',
      'ops name as "@ref" wherever an id goes. So a screen — its frame, its',
      'twenty layers, its auto layout, its variables, its component and its',
      'prototype links — is a single `edit_design` call, not fifty. Never loop',
      '`create_node`: it exists for the one-off tweak, and using it to build is',
      'the difference between three tool calls and a hundred.',
      '',
      'Every edit lands on the live document, so open canvases show it at once.',
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
      'The node tree for a file: ids, types, names, sizes and layout mode. Cheap — use it to find the node you want before asking for its context. `depth` stops it short on a large file; the rows it cut say how many children are still down there.',
    inputSchema: {
      fileId: z.string().describe('File id, e.g. "demofile0" — the last path segment of /f/<id>'),
      nodeId: z.string().optional().describe('Subtree root. Defaults to the page.'),
      depth: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('How many levels to walk. Omit for the whole tree.'),
    },
  },
  async ({ fileId, nodeId, depth }) => {
    const { store } = await openFile(fileId);
    const doc = store.getSnapshot();
    const root = nodeId ?? ROOT_ID;
    if (!doc[root]) return text(`No node "${root}" in ${fileId}.`);
    return text(outline(doc, root, 0, [], depth).join('\n'));
  },
);

server.registerTool(
  'get_design_context',
  {
    title: 'Get design as code',
    description:
      'The node as production code. `react` returns a component plus its stylesheet, `tailwind` the same component with utility classes instead, `html` a self-contained file, `json` the raw scene graph. This is generated from the same style function the canvas renders with, so it is exact. Pass `nodeIds` to read several nodes in one call rather than one call each.',
    inputSchema: {
      fileId: z.string(),
      nodeId: z.string().optional().describe('Node to export. Use get_metadata to find it.'),
      nodeIds: z
        .array(z.string())
        .optional()
        .describe('Several nodes, each rendered in turn. Use instead of nodeId.'),
      format: z.enum(['react', 'html', 'tailwind', 'json']).default('react'),
    },
  },
  async ({ fileId, nodeId, nodeIds, format }) => {
    const { store } = await openFile(fileId);
    const doc = store.getSnapshot();
    const wanted = nodeIds?.length ? nodeIds : nodeId ? [nodeId] : [];
    if (!wanted.length) return text('Pass nodeId, or nodeIds for several at once.');
    const tokens = store.listTokens();
    const collections = store.listCollections();
    const fonts = store.listFonts();

    const one = (nodeId: string): string => {
      if (!doc[nodeId]) return `No node "${nodeId}" in ${fileId}.`;

    // A node someone has already built should be used, not generated again —
    // so the mapping arrives with the code rather than in a tool call the agent
    // has to think to make.
      const mapped = codeConnectFor(fileId, subtreeIds(nodeId, doc));
      const preamble = mapped.length
        ? `${mapped
            .map(
              (row) =>
                `// ${doc[row.node_id]?.name ?? row.node_id} (${row.node_id}) is already built: ${row.component_name} in ${row.source} [${row.label}] — use it`,
            )
            .join('\n')}\n\n`
        : '';

      if (format === 'json') return toJson(nodeId, doc);
      if (format === 'html') return preamble + toHtml(nodeId, doc, tokens, collections, fonts);
      if (format === 'tailwind') {
        const tw = toTailwind(nodeId, doc, tokens, collections, fonts);
        return `${preamble}${tw.markup}${tw.css.trim() ? `\n/* ── stylesheet ── */\n\n${tw.css}` : ''}`;
      }
      const { markup, css } = toReact(nodeId, doc, tokens, collections, fonts);
      return `${preamble}${markup}\n/* ── stylesheet ── */\n\n${css}`;
    };

    // one node reads exactly as it always did; several are labelled so the
    // agent can tell which block belongs to which id
    if (wanted.length === 1) return text(one(wanted[0]));
    return text(
      wanted
        .map((id) => `/* ── ${doc[id]?.name ?? id} (${id}) ── */\n\n${one(id)}`)
        .join('\n\n'),
    );
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

// ── Reading: pictures, assets and the design system ──────────────────────

/** Everything the exporters need from a file, gathered once. */
async function contextOf(fileId: string) {
  const { store } = await openFile(fileId);
  return {
    store,
    render: {
      doc: store.getSnapshot(),
      tokens: store.listTokens(),
      collections: store.listCollections(),
      fonts: store.listFonts(),
    },
  };
}

server.registerTool(
  'get_screenshot',
  {
    title: 'Render a node',
    description:
      'A PNG of the node, rendered headlessly from the same HTML export the canvas produces — so it is the design, not an approximation. `maxDimension` caps the longer edge (default 1024); raise it to inspect detail, lower it for a thumbnail.',
    inputSchema: {
      fileId: z.string(),
      nodeId: z.string(),
      maxDimension: z.number().int().min(16).max(8192).default(1024),
      contentsOnly: z
        .boolean()
        .default(false)
        .describe('Drop the layer\'s own background, border and shadow; keep what is inside it.'),
    },
  },
  async ({ fileId, nodeId, maxDimension, contentsOnly }) => {
    const { render } = await contextOf(fileId);
    if (!render.doc[nodeId]) return text(`No node "${nodeId}" in ${fileId}.`);
    const shot = await renderNode(nodeId, render, { maxDimension, contentsOnly });
    return {
      content: [
        { type: 'image' as const, data: shot.data.toString('base64'), mimeType: 'image/png' },
        {
          type: 'text' as const,
          text: JSON.stringify({
            width: shot.width,
            height: shot.height,
            original_width: shot.originalWidth,
            original_height: shot.originalHeight,
            scale: Number(shot.scale.toFixed(3)),
          }),
        },
      ],
    };
  },
);

server.registerTool(
  'download_assets',
  {
    title: 'Export a node and its assets',
    description:
      'Writes three things to disk for one node: a render of the node itself, the source images used as fills anywhere inside it, and an SVG for each vector layer. Returns the paths.',
    inputSchema: {
      fileId: z.string(),
      nodeId: z.string(),
      dir: z.string().optional().describe('Where to write. Defaults to .data/exports/<file>/<node>.'),
      format: z.enum(['png', 'jpeg', 'svg']).default('png').describe('Format of the node render.'),
      scale: z.number().min(0.1).max(4).default(1),
    },
  },
  async ({ fileId, nodeId, dir, format, scale }) => {
    const { render } = await contextOf(fileId);
    const node = render.doc[nodeId];
    if (!node) return text(`No node "${nodeId}" in ${fileId}.`);

    const target = dir ?? path.resolve(process.cwd(), '.data', 'exports', fileId, nodeId);
    const assets: string[] = [];

    const shot = await renderNode(nodeId, render, { format, scale, maxDimension: 8192 });
    const main = writeAsset(target, `${safeName(node.name)}.${format === 'jpeg' ? 'jpg' : format}`, shot.data);
    assets.push(`export      ${main.file}  ${shot.width}×${shot.height}  ${main.bytes} bytes`);

    const { images, vectors } = assetsIn(nodeId, render.doc);
    for (const image of images) {
      const decoded = image.src ? decodeDataUrl(image.src) : null;
      if (!decoded) {
        assets.push(`raw image   ${image.name} → ${image.src?.slice(0, 120)} (remote; not downloaded)`);
        continue;
      }
      const written = writeAsset(target, `${safeName(image.name)}-${image.id}.${decoded.format}`, decoded.data);
      assets.push(`raw image   ${written.file}  ${written.bytes} bytes`);
    }
    for (const vector of vectors) {
      const svg = svgOfShape(vector);
      if (!svg) continue;
      const written = writeAsset(target, `${safeName(vector.name)}-${vector.id}.svg`, svg);
      assets.push(`svg         ${written.file}  ${written.bytes} bytes`);
    }

    return text(assets.join('\n'));
  },
);

/** Filenames come from layer names, which can be anything at all. */
function safeName(name: string): string {
  return (name || 'layer').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'layer';
}

server.registerTool(
  'get_variable_defs',
  {
    title: 'Get the variables a node uses',
    description:
      'The design variables referenced anywhere in a subtree, resolved to their values — the set a developer has to have on hand to build this node. Use get_variables for the whole file.',
    inputSchema: {
      fileId: z.string(),
      nodeId: z.string().optional().describe('Defaults to the page.'),
    },
  },
  async ({ fileId, nodeId }) => {
    const { store } = await openFile(fileId);
    const doc = store.getSnapshot();
    const root = nodeId ?? ROOT_ID;
    if (!doc[root]) return text(`No node "${root}" in ${fileId}.`);

    const tokens = store.listTokens();
    const byId = new Map(tokens.map((token) => [token.id, token]));
    const modes = defaultModes(store.listCollections());
    const used = new Set<string>();

    const walk = (id: string): void => {
      const node = doc[id];
      if (!node) return;
      for (const match of JSON.stringify(node).matchAll(/var\(--([a-zA-Z0-9_-]+)\)/g)) used.add(match[1]);
      for (const tokenId of Object.values(node.vars ?? {})) {
        const token = tokenId ? byId.get(tokenId) : null;
        if (token) used.add(token.name);
      }
      for (const child of node.children) walk(child);
    };
    walk(root);

    const hits = tokens.filter((token) => used.has(token.name));
    if (!hits.length) return text(`Nothing under "${root}" references a variable.`);
    return text(
      hits
        .map((token) => `${token.name}: ${publish(token, resolveToken(token, modes, byId))}   (${token.type})`)
        .join('\n'),
    );
  },
);

server.registerTool(
  'get_libraries',
  {
    title: 'Get the libraries in play',
    description:
      'Two lists: what this file publishes and what it has already imported, then everything else published in the workspace that it could import. Component ids from here go to create_instance in edit_design.',
    inputSchema: { fileId: z.string() },
  },
  async ({ fileId }) => {
    const { store } = await openFile(fileId);
    const doc = store.getSnapshot();
    const published = listLibraryForFile(fileId);
    const mine = Object.values(doc).filter((node) => node.isComponent && !node.libraryId);
    const imported = Object.values(doc).filter((node) => node.libraryId);
    const elsewhere = listAllLibrary().filter((entry) => entry.file_id !== fileId);

    const lines = [
      `Main components in this file (${mine.length}):`,
      ...mine.map((node) => `  ${node.name}  id=${node.id}${node.isComponentSet ? '  [variant set]' : ''}`),
      '',
      `Published from this file (${published.length}):`,
      ...published.map((entry) => `  ${entry.name}  library=${entry.id}  v${entry.version}  node=${entry.node_id}`),
      '',
      `Imported into this file (${imported.length}):`,
      ...imported.map((node) => `  ${node.name}  id=${node.id}  from=${node.libraryId}  v${node.libraryVersion ?? '?'}`),
      '',
      `Available to add (${elsewhere.length}):`,
      ...elsewhere.map((entry) => `  ${entry.name}  library=${entry.id}  v${entry.version}  in "${entry.file_name}"`),
    ];
    return text(lines.join('\n'));
  },
);

server.registerTool(
  'search_design_system',
  {
    title: 'Search components, styles and variables',
    description:
      'Finds design system assets by name across the file and the shared library. One intent per query — search again rather than combining alternatives.',
    inputSchema: {
      query: z.string(),
      fileId: z.string(),
      includeComponents: z.boolean().default(true),
      includeStyles: z.boolean().default(true),
      includeVariables: z.boolean().default(true),
    },
  },
  async ({ query, fileId, includeComponents, includeStyles, includeVariables }) => {
    const { store } = await openFile(fileId);
    const doc = store.getSnapshot();
    const needle = query.trim().toLowerCase();
    const hit = (value: string | undefined) => (value ?? '').toLowerCase().includes(needle);
    const found: string[] = [];

    if (includeComponents) {
      for (const node of Object.values(doc)) {
        if (!node.isComponent || !hit(node.name)) continue;
        found.push(`component  ${node.name}  id=${node.id}  ${Math.round(node.w)}×${Math.round(node.h)}`);
      }
      for (const entry of listAllLibrary()) {
        if (!hit(entry.name)) continue;
        found.push(`library    ${entry.name}  library=${entry.id}  v${entry.version}  in "${entry.file_name}"`);
      }
    }
    if (includeStyles) {
      for (const style of store.listStyles()) {
        if (!hit(style.name)) continue;
        found.push(`style      ${style.name}  id=${style.id}  (${style.kind})`);
      }
    }
    if (includeVariables) {
      const tokens = store.listTokens();
      const byId = new Map(tokens.map((token) => [token.id, token]));
      const modes = defaultModes(store.listCollections());
      for (const token of tokens) {
        if (!hit(token.name) && !hit(token.description)) continue;
        found.push(
          `variable   ${token.name} = ${publish(token, resolveToken(token, modes, byId))}  id=${token.id}  (${token.type})`,
        );
      }
    }

    return text(found.length ? found.join('\n') : `Nothing matching "${query}".`);
  },
);

/** The frame's timeline, as the CSS an implementation would actually run. */
function timelineBlock(frame: SceneNode, doc: Doc): string {
  const spec = motionOf(frame);
  if (!spec) return '';
  const rows = spec.tracks
    .filter((track) => track.keys.length)
    .map((track) => {
      const layer = doc[track.node];
      const keys = track.keys
        .map((key) => `${key.at}ms ${JSON.stringify(key.value)} (${key.easing})`)
        .join(', ');
      return `  "${layer?.name ?? track.node}" (${track.node}) ${track.property}: ${keys}`;
    });
  if (!rows.length) return '';
  return [
    `frame "${frame.name}" (${frame.id}) — timeline, ${spec.duration}ms${spec.loop ? ', looping' : ''}`,
    ...rows,
    indent(
      timelineCss(spec, doc, {
        selector: (id) => `.${cssName(doc[id]?.name ?? 'layer')}`,
        playing: true,
      }),
    ),
  ].join('\n');
}

const TRAVEL: Record<string, [number, number]> = {
  left: [-100, 0],
  right: [100, 0],
  top: [0, -100],
  bottom: [0, 100],
};

/** A transition, as the CSS that would play it. */
function motionCss(transition: TransitionSpec, name: string): string {
  const easing = easingCss(transition);
  const ms = `${transition.duration}ms`;
  if (transition.type === 'instant') return `/* ${name}: instant — no animation */`;
  if (transition.type === 'dissolve') {
    return `@keyframes ${name} { from { opacity: 0 } to { opacity: 1 } }\n.${name} { animation: ${name} ${ms} ${easing} both }`;
  }
  if (transition.type === 'smart-animate') {
    return `.${name} { transition: all ${ms} ${easing} }`;
  }
  const [dx, dy] = TRAVEL[transition.direction] ?? TRAVEL.left;
  // move-out and slide-out animate the frame leaving, so the keyframes run the
  // other way: from where it sits to off the edge
  const leaves = transition.type === 'move-out' || transition.type === 'slide-out';
  const frame = leaves
    ? `from { transform: none } to { transform: translate(${-dx}%, ${-dy}%) }`
    : `from { transform: translate(${dx}%, ${dy}%) } to { transform: none }`;
  return (
    `@keyframes ${name} { ${frame} }\n` +
    `.${name} { animation: ${name} ${ms} ${easing} both }`
  );
}

server.registerTool(
  'get_motion_context',
  {
    title: 'Get prototype behaviour',
    description:
      'What a node does: its interactions, their triggers and destinations, the CSS that plays each transition, and the timeline of any frame that animates on its own — its tracks, keyframes and the @keyframes they compile to. Call it after get_design_context to build a screen that behaves like the prototype.',
    inputSchema: {
      fileId: z.string(),
      nodeId: z.string(),
      recursive: z.boolean().default(true).describe('Include everything inside the node.'),
    },
  },
  async ({ fileId, nodeId, recursive }) => {
    const { store } = await openFile(fileId);
    const doc = store.getSnapshot();
    const node = doc[nodeId];
    if (!node) return text(`No node "${nodeId}" in ${fileId}.`);

    const targets: SceneNode[] = [];
    // frames that animate on their own, which is a different question from
    // what a click does — see `src/document/motion.ts`
    const timelines: SceneNode[] = [];
    const walk = (id: string): void => {
      const current = doc[id];
      if (!current) return;
      if (interactionsOf(current).length || current.flowStart) targets.push(current);
      if (hasMotion(current)) timelines.push(current);
      if (recursive) for (const child of current.children) walk(child);
    };
    walk(nodeId);

    if (!targets.length && !timelines.length) {
      return text(`Nothing under "${node.name}" is interactive, and nothing animates.`);
    }

    const blocks = targets.map((target) => {
      const header = target.flowStart
        ? `${target.type} "${target.name}" (${target.id}) — flow start: ${target.flowStart}`
        : `${target.type} "${target.name}" (${target.id})`;
      const rows = interactionsOf(target).map((interaction, index) => {
        const to = interaction.destination ? ` (${interaction.destination})` : '';
        return [
          `  ${describe(interaction, doc)}${to}`,
          indent(motionCss(interaction.transition, `${cssName(target.name)}-${index + 1}`)),
        ].join('\n');
      });
      return [header, ...rows].join('\n');
    });

    for (const frame of timelines) {
      const block = timelineBlock(frame, doc);
      if (block) blocks.push(block);
    }

    const flows = flowsOn(doc, pageOf(nodeId, doc));
    const trailer = flows.length
      ? `\nFlows on this page: ${flows.map((flow) => `${flow.name} → "${doc[flow.id]?.name ?? '?'}" (${flow.id})`).join(', ')}`
      : '';
    return text(blocks.join('\n\n') + trailer);
  },
);

/** Which page a node is on — flows are a page-level thing. */
function pageOf(id: string, doc: Doc): string {
  let current = doc[id];
  while (current?.parent && doc[current.parent]) current = doc[current.parent];
  return current?.id ?? ROOT_ID;
}

const indent = (value: string) => value.split('\n').map((line) => `  ${line}`).join('\n');
const cssName = (name: string) =>
  (name || 'layer').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layer';

server.registerTool(
  'list_shader_fills',
  {
    title: 'List shader fills',
    description:
      'The shader generators a layer can be filled with — they draw pixels from nothing, no input raster. Use the id with get_shader_fill for the source, or set `shader` on a node.',
    inputSchema: {},
  },
  async () =>
    text(
      SHADER_CATEGORIES.map((category) =>
        [
          category,
          ...SHADERS.filter((shader) => shader.category === category).map(
            (shader) =>
              `  ${shader.id}  "${shader.name}"  params: ${shader.params.map((p) => p.key).join(', ')}`,
          ),
        ].join('\n'),
      ).join('\n\n'),
    ),
);

server.registerTool(
  'get_shader_fill',
  {
    title: 'Read a shader fill',
    description:
      'A shader fill\'s parameters and its compiled GLSL — the exact program the canvas and the HTML export both run.',
    inputSchema: { id: z.string().describe('From list_shader_fills.') },
  },
  async ({ id }) => {
    const def = SHADER_BY_ID.get(id);
    if (!def) return text(`No shader "${id}". Try list_shader_fills.`);
    const params = def.params
      .map((param) => `  ${param.key}  ${param.type}  default ${param.value}${param.min !== undefined ? `  [${param.min}…${param.max}]` : ''}  "${param.label}"`)
      .join('\n');
    return text(`${def.name}  (${def.category})\n\nparams:\n${params}\n\n${compose(def)}`);
  },
);

server.registerTool(
  'list_shader_effects',
  {
    title: 'List effects',
    description:
      'What can go in a layer\'s Effects list, and the ready-made stacks. Every entry is valid as `type` in the `effects` array of create_node / update_node.',
    inputSchema: {},
  },
  async () =>
    text(
      [
        'Effect types:',
        ...EFFECT_MENU.map((entry) => `  ${entry.type}  "${EFFECT_LABEL[entry.type]}"`),
        '',
        'Presets (each replaces the layer\'s effects):',
        ...EFFECT_PRESETS.map((preset) => `  ${preset.name}`),
        '',
        'A `shader` effect takes any id from list_shader_fills and composites it over the layer.',
      ].join('\n'),
    ),
);

server.registerTool(
  'get_shader_effect',
  {
    title: 'Read an effect',
    description:
      'The fields one effect type uses and what they default to, or the stack behind a preset — ready to paste into an `effects` array.',
    inputSchema: { id: z.string().describe('An effect type, or a preset name from list_shader_effects.') },
  },
  async ({ id }) => {
    const preset = EFFECT_PRESETS.find((entry) => entry.name.toLowerCase() === id.toLowerCase());
    if (preset) return text(JSON.stringify(preset.effects(), null, 2));
    const known = EFFECT_MENU.some((entry) => entry.type === id);
    if (!known) return text(`No effect "${id}". Try list_shader_effects.`);
    return text(
      `${EFFECT_LABEL[id as EffectType]}\n\n${JSON.stringify(newEffect(id as EffectType), null, 2)}`,
    );
  },
);

server.registerTool(
  'get_code_connect_map',
  {
    title: 'Get the code this design already has',
    description:
      'Which nodes are already implemented, and where. Read it before generating anything: a mapped node should be used, not rebuilt.',
    inputSchema: {
      fileId: z.string(),
      nodeId: z.string().optional().describe('Limits the answer to this subtree. Defaults to the whole file.'),
      label: z.string().optional().describe('Only mappings for this framework, e.g. "React".'),
    },
  },
  async ({ fileId, nodeId, label }) => {
    const { store } = await openFile(fileId);
    const doc = store.getSnapshot();
    const scope = nodeId ? subtreeIds(nodeId, doc) : undefined;
    const rows = codeConnectFor(fileId, scope).filter((row) => !label || row.label === label);
    if (!rows.length) return text('No Code Connect mappings yet. Add one with add_code_connect_map.');
    return text(
      rows
        .map(
          (row) =>
            `${row.node_id}  "${doc[row.node_id]?.name ?? '(gone)'}"  →  ${row.component_name}  ${row.source}  [${row.label}]`,
        )
        .join('\n'),
    );
  },
);

function subtreeIds(rootId: string, doc: Doc): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    const node = doc[id];
    if (!node) return;
    out.push(id);
    for (const child of node.children) walk(child);
  };
  walk(rootId);
  return out;
}

server.registerTool(
  'whoami',
  {
    title: 'Who this server is',
    description:
      'The identity the agent edits as, where the document sync and the file index live, and who else is in the workspace. Start here when a file will not open.',
    inputSchema: {},
  },
  async () => {
    const files = listAllFiles();
    const people = listAllUsers();
    return text(
      [
        `agent:   mcp-agent (editor)`,
        `sync:    ${process.env.SYNC_URL ?? 'ws://localhost:1234'}`,
        `data:    ${process.env.DATA_DIR ?? path.resolve(process.cwd(), '.data')}`,
        `signing: ${process.env.AUTH_SECRET ? 'AUTH_SECRET is set' : 'AUTH_SECRET missing — no file will open'}`,
        `files:   ${files.length}`,
        'people:',
        ...people.map((person) => `  ${person.name} <${person.email}>  id=${person.id}`),
      ].join('\n'),
    );
  },
);

// ── Writing ──────────────────────────────────────────────────────────────

const NODE_TYPES = [
  'frame',
  'section',
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
        dash: z.number().optional().describe('dash length, in px'),
        gap: z.number().optional().describe('gap between dashes; defaults to the dash'),
        cap: z.enum(['butt', 'round', 'square']).optional().describe('vector paths only'),
        join: z.enum(['miter', 'round', 'bevel']).optional().describe('vector paths only'),
        miterAngle: z
          .number()
          .optional()
          .describe('degrees below which a mitred join bevels instead; Figma defaults to 28.96'),
        sides: z
          .array(z.number())
          .length(4)
          .nullable()
          .optional()
          .describe('individual stroke widths [top, right, bottom, left]; null means all four'),
      })
      .nullable()
      .optional()
      .describe('null removes the border. Partial patches merge.'),
    link: z
      .string()
      .nullable()
      .optional()
      .describe(
        'A hyperlink on the layer — Figma\'s ⌘K. It exports as an <a href> and a click follows it while presenting.',
      ),
    scroll: z
      .enum(['none', 'vertical', 'horizontal', 'both'])
      .optional()
      .describe('Frames: how this one scrolls while the prototype plays.'),
    scrollBehavior: z
      .enum(['scrolls', 'fixed', 'sticky'])
      .optional()
      .describe('A layer inside a scrolling frame: goes with the content, stays put, or sticks.'),
    exportBackground: z
      .boolean()
      .optional()
      .describe('Figma\'s "Show in exports": false leaves this layer\'s own fill out of an export.'),
    prototypeDevice: z
      .enum(['none', 'phone', 'phone-large', 'tablet', 'laptop', 'desktop', 'watch'])
      .optional()
      .describe('Pages only: the device the prototype plays inside.'),
    prototypeBackground: z
      .string()
      .optional()
      .describe('Pages only: the colour behind the prototype while it plays.'),
    thumbnailOf: z
      .string()
      .optional()
      .describe('Pages only: which frame stands for the file in the browser.'),
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
    shader: z
      .object({
        id: z.string().describe('A fill id from list_shader_fills, e.g. "mesh".'),
        params: z
          .record(z.string(), z.union([z.number(), z.string()]))
          .optional()
          .describe('Uniform values. Anything left out keeps the fill\'s own default.'),
      })
      .nullable()
      .optional()
      .describe(
        'The GPU fill this layer draws. Shader nodes need one — without it the layer paints nothing. Also valid on a frame, where it sits under the paints.',
      ),
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

  // A shader carries every uniform it has, not just the ones that were named:
  // an unset uniform reads as 0 in the renderer, which is black, not "default".
  if (out.shader) {
    const spec = out.shader as { id: string; params?: Record<string, number | string> };
    const def = SHADER_BY_ID.get(spec.id);
    if (!def) throw new Error(`No shader fill "${spec.id}". Try list_shader_fills.`);
    out.shader = { id: spec.id, params: { ...defaultParams(def), ...(spec.params ?? {}) } };
  }
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

/**
 * Writes a spec tree into the document, depth first.
 *
 * `data-ref` on the source markup comes back out here as a name → id mapping,
 * so an agent that built a screen from HTML can address the pieces of it
 * afterwards without reading the tree back.
 */
function writeSpecs(
  store: Awaited<ReturnType<typeof openFile>>['store'],
  specs: NodeSpec[],
  parentId: string,
  refs: Map<string, string> = new Map(),
): { count: number; top: string[]; refs: Map<string, string> } {
  let count = 0;
  const top: string[] = [];
  for (const spec of specs) {
    const id = store.create(spec.type as NodeType, parentId, withSpecs(spec.props));
    top.push(id);
    count += 1;
    if (spec.ref) refs.set(spec.ref, id);
    if (spec.children.length) count += writeSpecs(store, spec.children, id, refs).count;
  }
  return { count, top, refs };
}

server.registerTool(
  'write_html',
  {
    title: 'Build from HTML',
    description: [
      'Turns HTML and CSS into real layers — the fastest way to build anything here.',
      '',
      'This canvas *is* HTML and CSS: a node maps onto a declaration block, so the',
      'markup is laid out in a real browser and read back through',
      '`getComputedStyle`. The cascade, shorthands, inheritance, em, %, flexbox and',
      'the default stylesheet are all resolved before anything is written, which is',
      'why the result matches what you wrote rather than approximating it.',
      '',
      'A flex container becomes an auto layout and its children flow; everything',
      'else keeps absolute positions. An element whose content is only text becomes',
      'a text layer, an <img> becomes an image layer, and background, border,',
      'radius, opacity, overflow and every box-shadow come across.',
      '',
      'Put `data-ref="name"` on any element and the reply gives you the id it',
      'became, so you can edit it afterwards without reading the tree back.',
      '',
      'Prefer this over a run of `create_node` calls: a screen is one call here.',
    ].join('\n'),
    inputSchema: {
      fileId: z.string(),
      html: z.string().describe('A fragment — the body of what you want, not a whole document.'),
      css: z.string().optional().describe('A stylesheet the markup refers to.'),
      parentId: z.string().optional().describe('Defaults to the page.'),
      width: z
        .number()
        .int()
        .min(1)
        .max(4096)
        .optional()
        .describe('Layout width, in px. The web is width-driven; height follows. Default 1440.'),
      x: z.number().optional().describe('Where the top-level layers land on the page.'),
      y: z.number().optional(),
    },
  },
  async ({ fileId, html, css, parentId, width, x, y }) => {
    const { store } = await openFile(fileId);
    const parent = parentId ?? ROOT_ID;
    if (!store.getSnapshot()[parent]) return text(`No parent "${parent}".`);

    const specs = await readHtml(html, { width, ...(css ? { css } : {}) });
    if (!specs.length) return text('That markup laid out to nothing — every element was empty or hidden.');

    // the offset applies to the top level only; everything below is placed by
    // its parent, either by layout or by its own measured position
    if (x !== undefined || y !== undefined) {
      for (const spec of specs) {
        spec.props.x = (spec.props.x as number ?? 0) + (x ?? 0);
        spec.props.y = (spec.props.y as number ?? 0) + (y ?? 0);
      }
    }

    const { count, refs } = writeSpecs(store, specs, parent);
    await settle();
    return text(
      [
        `Built ${count} layer(s) in ${parent}.`,
        ...(refs.size ? ['', 'refs:', ...[...refs].map(([name, id]) => `  ${name} = ${id}`)] : []),
      ].join('\n'),
    );
  },
);

server.registerTool(
  'create_node',
  {
    title: 'Create a node',
    description:
      'Adds ONE node to a file, for a one-off addition. Building anything with more ' +
      'than a couple of layers goes through `edit_design` in a single call instead — ' +
      'its ops can point at each other by ref, so the whole tree lands in one round trip.',
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
    description:
      'Changes properties on ONE existing node. To change several, send one `edit_design` ' +
      'call with an `update` op each — same result, one round trip.',
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
    description:
      'Tokens publish as CSS custom properties; reference one as var(--name). ' +
      'Defining a whole theme goes through `edit_design` with a `set_variable` op each, in one call.',
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

// ── Writing: files, assets, the library, and everything the canvas can do ──

server.registerTool(
  'create_new_file',
  {
    title: 'Create a design file',
    description:
      'A new, empty file, owned by one of the workspace accounts. Returns the id to pass to every other tool, and the URL to open it at.',
    inputSchema: {
      name: z.string().describe('What the file is called.'),
      ownerEmail: z
        .string()
        .optional()
        .describe('Whose file it is. Defaults to the only account, when there is only one.'),
    },
  },
  async ({ name, ownerEmail }) => {
    const people = listAllUsers();
    if (!people.length) return text('No accounts yet — sign up in the app first.');
    const owner = ownerEmail
      ? people.find((person) => person.email.toLowerCase() === ownerEmail.toLowerCase())
      : people.length === 1
        ? people[0]
        : undefined;
    if (!owner) {
      return text(
        ownerEmail
          ? `No account for "${ownerEmail}".`
          : `Several accounts here — say which one owns it: ${people.map((p) => p.email).join(', ')}`,
      );
    }

    const id = newId();
    createFile(id, name, owner.id);
    // joining it is what gives the document a page to hang nodes off
    await openFile(id);
    await settle();
    return text(`Created "${name}"  id=${id}  owner=${owner.email}\nOpen at /f/${id}`);
  },
);

server.registerTool(
  'upload_asset',
  {
    title: 'Put an image in a file',
    description:
      'Reads an image off disk and places it as an image layer, or swaps the picture on one that is already there. A remote URL is kept as a reference instead of being downloaded.',
    inputSchema: {
      fileId: z.string(),
      source: z.string().describe('A local path, an http(s) URL, or a data: URL.'),
      nodeId: z.string().optional().describe('Replace this layer\'s image instead of adding one.'),
      parentId: z.string().optional().describe('Where the new layer goes. Defaults to the page.'),
      x: z.number().optional(),
      y: z.number().optional(),
      w: z.number().optional().describe('Defaults to the image\'s own width.'),
      h: z.number().optional(),
    },
  },
  async ({ fileId, source, nodeId, parentId, x, y, w, h }) => {
    const { store } = await openFile(fileId);
    let src = source;
    let size: { width: number; height: number } | null = null;

    if (!/^(https?|data):/.test(source)) {
      const file = path.resolve(source);
      if (!fs.existsSync(file)) return text(`No file at ${file}.`);
      const bytes = fs.readFileSync(file);
      const mime = MIME[path.extname(file).toLowerCase()];
      if (!mime) return text(`${path.extname(file)} is not an image this canvas can show.`);
      src = `data:${mime};base64,${bytes.toString('base64')}`;
      size = imageSize(bytes);
    } else if (source.startsWith('data:')) {
      const decoded = decodeDataUrl(source);
      if (decoded) size = imageSize(decoded.data);
    }

    if (nodeId) {
      if (!store.getSnapshot()[nodeId]) return text(`No node "${nodeId}".`);
      store.update(nodeId, { src, ...(w ? { w } : {}), ...(h ? { h } : {}) });
      await settle();
      return text(`Replaced the image on ${nodeId}.`);
    }

    const parent = parentId ?? ROOT_ID;
    if (!store.getSnapshot()[parent]) return text(`No parent "${parent}".`);
    const id = store.create('image', parent, {
      src,
      name: path.basename(source).slice(0, 60),
      x: x ?? 0,
      y: y ?? 0,
      w: w ?? size?.width ?? 400,
      h: h ?? size?.height ?? 300,
    });
    await settle();
    return text(`Created image ${id}${size ? ` at ${size.width}×${size.height}` : ''} in ${parent}.`);
  },
);

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

/**
 * How big a picture is, from its header.
 *
 * Enough of each format to read the dimensions, because an image dropped in at
 * the wrong aspect ratio is worse than one dropped in at a default size.
 */
function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes.toString('ascii', 1, 4) === 'PNG') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 10 && bytes.toString('ascii', 0, 3) === 'GIF') {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      const length = bytes.readUInt16BE(at + 2);
      // SOF0…SOF15, minus the four that are not frame headers
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      }
      at += 2 + length;
    }
  }
  return null;
}

server.registerTool(
  'publish_component',
  {
    title: 'Publish a component to the library',
    description:
      'Shares a main component with every file in the workspace. Re-publishing bumps its version, and files that imported it are told there is a newer one.',
    inputSchema: {
      fileId: z.string(),
      nodeId: z.string().describe('A main component — make one with edit_design create_component.'),
      name: z.string().optional().describe('Defaults to the layer\'s name.'),
    },
  },
  async ({ fileId, nodeId, name }) => {
    const { store } = await openFile(fileId);
    const node = store.getSnapshot()[nodeId];
    if (!node) return text(`No node "${nodeId}".`);
    if (!node.isComponent) return text(`"${node.name}" is not a main component yet.`);
    const { id, version } = publishComponent(fileId, nodeId, name ?? node.name, store.serialize([nodeId]));
    return text(`Published "${name ?? node.name}"  library=${id}  v${version}`);
  },
);

server.registerTool(
  'import_component',
  {
    title: 'Import a published component',
    description:
      'Brings a library component into a file as a main component that keeps following the original. Instance it with edit_design create_instance.',
    inputSchema: {
      fileId: z.string(),
      libraryId: z.string().describe('From get_libraries or search_design_system.'),
      parentId: z.string().optional().describe('Defaults to the page.'),
      x: z.number().optional(),
      y: z.number().optional(),
    },
  },
  async ({ fileId, libraryId, parentId, x, y }) => {
    const entry = getLibraryComponent(libraryId);
    if (!entry) return text(`No library component "${libraryId}".`);
    const { store } = await openFile(fileId);
    const parent = parentId ?? ROOT_ID;
    if (!store.getSnapshot()[parent]) return text(`No parent "${parent}".`);
    const id = store.importComponent(
      entry.payload,
      parent,
      { id: entry.id, version: entry.version },
      { x: x ?? 0, y: y ?? 0 },
    );
    await settle();
    return id ? text(`Imported "${entry.name}" as ${id}.`) : text('That payload had nothing in it.');
  },
);

server.registerTool(
  'add_code_connect_map',
  {
    title: 'Point a node at its component',
    description:
      'Records that this node is already built, and where. get_design_context and get_code_connect_map both surface it afterwards, so the next agent reuses the component instead of writing a second one.',
    inputSchema: {
      fileId: z.string(),
      nodeId: z.string(),
      componentName: z.string().describe('What the component is called in the code.'),
      source: z.string().describe('Where it lives — a path or a URL.'),
      label: z
        .string()
        .default('React')
        .describe('The framework this mapping is for: React, Vue, Svelte, SwiftUI, …'),
      remove: z.boolean().default(false).describe('Delete the mapping instead of adding it.'),
    },
  },
  async ({ fileId, nodeId, componentName, source, label, remove }) => {
    const { store } = await openFile(fileId);
    const node = store.getSnapshot()[nodeId];
    if (!node) return text(`No node "${nodeId}" in ${fileId}.`);
    if (remove) {
      const gone = unmapCodeConnect(fileId, nodeId, label);
      return text(gone ? `Unmapped ${nodeId} [${label}].` : `Nothing mapped for ${nodeId} [${label}].`);
    }
    mapCodeConnect({
      file_id: fileId,
      node_id: nodeId,
      label,
      component_name: componentName,
      source,
    });
    return text(`"${node.name}" (${nodeId}) → ${componentName} at ${source}  [${label}]`);
  },
);

// ── Editing: the canvas's own verbs ──────────────────────────────────────

const OPS = [
  'create',
  'update',
  'delete',
  'reparent',
  'reorder',
  'duplicate',
  'group',
  'ungroup',
  'section',
  'mask',
  'boolean',
  'flatten',
  'outline_stroke',
  'align',
  'distribute',
  'tidy',
  'resize_to_fit',
  'auto_layout',
  'scale',
  'create_component',
  'create_instance',
  'swap_instance',
  'detach_instance',
  'reset_instance',
  'add_component_prop',
  'set_prop_value',
  'combine_variants',
  'add_interaction',
  'set_flow_start',
  'set_motion',
  'set_keyframe',
  'clear_motion',
  'create_style',
  'apply_style',
  'add_page',
  'set_variable',
  'rename',
  'write_html',
] as const;

const OP = z.object({
  op: z.enum(OPS),
  ref: z
    .string()
    .optional()
    .describe(
      'A local name for whatever this op creates — a node, a page, a style, a component prop. ' +
        'Any later op in the same batch can point at it by writing "@name" wherever an id goes, ' +
        'so a whole tree is built in one call instead of one call per node.',
    ),
  nodeId: z.string().optional().describe('The one node the op acts on. May be "@ref".'),
  nodeIds: z.array(z.string()).optional().describe('The several nodes the op acts on. May be "@ref".'),
  parentId: z.string().optional(),
  index: z.number().int().optional().describe('reparent: where among its new siblings.'),
  type: z.enum(NODE_TYPES).optional().describe('create'),
  props: PROPS.optional().describe('create / update'),
  name: z
    .string()
    .optional()
    .describe('add_page · create_style · set_flow_start · add_component_prop · set_variable · rename'),
  where: z.enum(['front', 'back']).optional().describe('reorder'),
  edge: z
    .enum(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'])
    .optional()
    .describe('align'),
  axis: z.enum(['horizontal', 'vertical']).optional().describe('distribute'),
  boolean: z.enum(['union', 'subtract', 'intersect', 'exclude']).optional().describe('boolean'),
  on: z.boolean().optional().describe('auto_layout: on or off'),
  factor: z.number().optional().describe('scale'),
  offset: z.number().optional().describe('duplicate: how far the copy sits from the original'),
  x: z.number().optional(),
  y: z.number().optional(),
  mainId: z.string().optional().describe('create_instance · swap_instance'),
  instanceId: z.string().optional().describe('set_prop_value'),
  propId: z.string().optional().describe('set_prop_value'),
  propType: z.enum(['boolean', 'text', 'instance', 'variant']).optional().describe('add_component_prop'),
  options: z.array(z.string()).optional().describe('add_component_prop: the variant values'),
  value: z
    .string()
    .optional()
    .describe(
      'add_component_prop default · set_prop_value · set_keyframe (a number as text, or a colour)',
    ),
  frameId: z.string().optional().describe('set_motion · set_keyframe · clear_motion: the frame whose timeline it is. May be "@ref".'),
  property: z
    .enum([
      'x',
      'y',
      'w',
      'h',
      'rotation',
      'opacity',
      'radius',
      'fill',
      'strokeWidth',
      'strokeColor',
      'blur',
    ])
    .optional()
    .describe('set_keyframe: which property of the layer the track drives'),
  at: z.number().optional().describe('set_keyframe: ms from the start of the timeline'),
  easing: z
    .enum([
      'linear',
      'ease-in',
      'ease-out',
      'ease-in-out',
      'ease-in-back',
      'ease-out-back',
      'ease-in-out-back',
      'gentle',
      'quick',
      'bouncy',
      'slow',
    ])
    .optional()
    .describe('set_keyframe: how the curve leaves this key toward the next one'),
  duration: z.number().optional().describe('set_motion: how long the timeline runs, in ms'),
  loop: z.boolean().optional().describe('set_motion: whether it repeats'),
  trigger: z
    .enum([
      'none',
      'click',
      'drag',
      'hover',
      'press',
      'key',
      'mouse-enter',
      'mouse-leave',
      'mouse-down',
      'mouse-up',
      'delay',
    ])
    .optional()
    .describe('add_interaction'),
  action: z
    .enum([
      'navigate',
      'change-to',
      'back',
      'url',
      'open-overlay',
      'close-overlay',
      'swap-overlay',
      'scroll-to',
      'set-variable',
      'set-mode',
      'none',
    ])
    .optional()
    .describe('add_interaction'),
  destination: z.string().optional().describe('add_interaction: the frame to go to'),
  branches: z
    .array(
      z.object({
        condition: z
          .string()
          .optional()
          .describe('omit on the last branch to make it the else'),
        actions: z.array(
          z.object({
            action: z.string(),
            destination: z.string().optional(),
            url: z.string().optional(),
            variable: z.string().optional(),
            value: z.string().optional(),
          }),
        ),
      }),
    )
    .optional()
    .describe('add_interaction: the branches of a conditional, in order'),
  animation: z
    .string()
    .optional()
    .describe('add_interaction: the layer whose video play-pause / set-playhead acts on'),
  behavior: z
    .enum(['toggle', 'play', 'pause'])
    .optional()
    .describe('add_interaction: what play-pause does'),
  timestamp: z
    .number()
    .optional()
    .describe('add_interaction: seconds, for set-playhead'),
  resetVideo: z
    .boolean()
    .optional()
    .describe('add_interaction: arrive with the destination\'s videos back at the start'),
  resetScroll: z
    .boolean()
    .optional()
    .describe('add_interaction: arrive at the top rather than where you had scrolled to'),
  resetComponentState: z
    .boolean()
    .optional()
    .describe('add_interaction: arrive with the destination\'s instances back on their design-time variant'),
  url: z.string().optional().describe('add_interaction: the address to open'),
  transition: z
    .object({
      type: z
        .enum([
          'instant',
          'dissolve',
          'smart-animate',
          'move',
          'move-out',
          'push',
          'slide',
          'slide-out',
        ])
        .optional(),
      direction: z.enum(['left', 'right', 'top', 'bottom']).optional(),
      duration: z.number().optional().describe('ms'),
      easing: z
        .enum([
          'linear',
          'ease-in',
          'ease-out',
          'ease-in-out',
          'ease-in-back',
          'ease-out-back',
          'ease-in-out-back',
          'custom-bezier',
          'gentle',
          'quick',
          'bouncy',
          'slow',
          'custom-spring',
        ])
        .optional(),
      bezier: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional()
        .describe('control points, when easing is custom-bezier'),
      spring: z
        .object({ stiffness: z.number(), damping: z.number(), mass: z.number() })
        .optional()
        .describe('parameters, when easing is custom-spring'),
    })
    .optional()
    .describe('add_interaction'),
  varType: z
    .enum(['color', 'number', 'text'])
    .optional()
    .describe('set_variable: defaults to color'),
  html: z.string().optional().describe('write_html: the markup to build'),
  css: z.string().optional().describe('write_html: a stylesheet the markup refers to'),
  width: z.number().optional().describe('write_html: layout width in px, default 1440'),
  slot: z.enum(['fill', 'stroke', 'text', 'effect']).optional().describe('create_style · apply_style'),
  styleId: z.string().optional().describe('apply_style'),
  flex: z
    .object({
      direction: z.enum(['row', 'column']).optional(),
      gap: z.number().optional(),
      padding: z.array(z.number()).length(4).optional(),
      align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
      justify: z.enum(['start', 'center', 'end', 'between']).optional(),
      wrap: z.boolean().optional(),
    })
    .optional()
    .describe('auto_layout: what to start the layout at'),
});

server.registerTool(
  'edit_design',
  {
    title: 'Edit the design',
    description: [
      'Everything the canvas can do to a document, as a list of operations run in order.',
      '',
      'THIS IS THE ONE TOOL TO BUILD WITH. Send the whole design as a single call —',
      'a hundred ops in one `ops` array, not a hundred calls. Ops see each other:',
      'give a creating op a `ref` and any later op can name it as "@ref" wherever an',
      'id goes, so a frame and everything inside it lands in one round trip:',
      '',
      '  [{ op: "create", ref: "card",  type: "frame", props: { w: 320, h: 200 } },',
      '   { op: "create", ref: "title", type: "text",  parentId: "@card", props: { text: "Hi" } },',
      '   { op: "auto_layout", nodeId: "@card", on: true, flex: { direction: "column", gap: 12 } },',
      '   { op: "create_component", nodeId: "@card" }]',
      '',
      'A ref binds the id the op produced — a node for `create` / `group` / `boolean`,',
      'a page for `add_page`, a style for `create_style`, a prop for `add_component_prop`.',
      'An unresolved "@name" is an error, not a node id, and skips only that op.',
      '',
      'Each op names the nodes it acts on and carries only the fields it needs:',
      '',
      '  create           type, parentId, props        ungroup          nodeIds',
      '  update           nodeId, props                section          nodeIds',
      '  delete           nodeIds                      mask             nodeIds',
      '  reparent         nodeId, parentId, index      boolean          nodeIds, boolean',
      '  reorder          nodeIds, where               flatten          nodeIds',
      '  duplicate        nodeIds, offset              outline_stroke   nodeIds',
      '  group            nodeIds                      scale            nodeIds, factor',
      '  align            nodeIds, edge                tidy             nodeIds',
      '  distribute       nodeIds, axis                resize_to_fit    nodeIds',
      '  auto_layout      nodeId, on, flex             add_page         name',
      '  set_variable     name, value, varType         rename           nodeId, name',
      '  write_html       html, css, width, parentId    (a whole subtree in one op)',
      '',
      '  create_component nodeId                       add_component_prop mainId, name, propType, value, options',
      '  create_instance  mainId, parentId, x, y       set_prop_value     instanceId, propId, value',
      '  swap_instance    nodeId, mainId               combine_variants   nodeIds',
      '  detach_instance  nodeId                       create_style       nodeId, slot, name',
      '  reset_instance   nodeId                       apply_style        nodeIds, styleId, slot',
      '',
      '  add_interaction  nodeId, trigger, action, destination, url, transition',
      '  set_flow_start   nodeId, name (null clears it)',
      '  set_motion       frameId, duration, loop — the frame\'s timeline',
      '  set_keyframe     frameId, nodeId, property, at, value, easing',
      '  clear_motion     frameId',
      '',
      'Every change lands on the live document, so open canvases show it immediately.',
      'The reply is the log of what each op did, plus the ids every ref bound to.',
    ].join('\n'),
    inputSchema: { fileId: z.string(), ops: z.array(OP).min(1) },
  },
  async ({ fileId, ops: raw }) => {
    const { store } = await openFile(fileId);
    const log: string[] = [];
    const has = (id?: string) => Boolean(id && store.getSnapshot()[id]);

    /**
     * What each op's `ref` bound to.
     *
     * This is the whole reason a design arrives in one call rather than fifty:
     * an op can create a frame under the name "card", and every op after it in
     * the same array can say parentId "@card" without the agent having to make
     * a round trip to learn the id first.
     */
    const refs = new Map<string, string>();
    /** Names used before anything bound them — reported, never passed through. */
    let dangling: string[] = [];
    const deref = <T extends string | undefined>(value: T): T => {
      if (typeof value !== 'string' || !value.startsWith('@')) return value;
      const bound = refs.get(value.slice(1));
      if (bound) return bound as T;
      dangling.push(value);
      return value;
    };

    for (const [index, source] of raw.entries()) {
      const step = `${index + 1}. ${source.op}`;
      dangling = [];
      const op = {
        ...source,
        nodeId: deref(source.nodeId),
        parentId: deref(source.parentId),
        mainId: deref(source.mainId),
        instanceId: deref(source.instanceId),
        destination: deref(source.destination),
        styleId: deref(source.styleId),
        propId: deref(source.propId),
        animation: deref(source.animation),
        frameId: deref(source.frameId),
        nodeIds: source.nodeIds?.map(deref),
        branches: source.branches?.map((branch) => ({
          ...branch,
          actions: branch.actions.map((action) => ({
            ...action,
            destination: deref(action.destination),
          })),
        })),
      };
      if (dangling.length) {
        log.push(`${step}: nothing named ${[...new Set(dangling)].join(', ')} yet — skipped`);
        continue;
      }

      /** Records what this op made, under the name the op asked for. */
      const bind = (id: string | null | undefined): string | null | undefined => {
        if (id && op.ref) refs.set(op.ref, id);
        return id;
      };

      const many = op.nodeIds ?? (op.nodeId ? [op.nodeId] : []);
      const missing = many.filter((id) => !has(id));
      if (missing.length) {
        log.push(`${step}: no node ${missing.join(', ')} — skipped`);
        continue;
      }

      switch (op.op) {
        case 'create': {
          const parent = op.parentId ?? ROOT_ID;
          if (!has(parent)) { log.push(`${step}: no parent "${parent}" — skipped`); break; }
          const id = bind(store.create((op.type ?? 'frame') as NodeType, parent, withSpecs(op.props ?? {})));
          log.push(`${step}: created ${op.type ?? 'frame'} ${id}${op.ref ? ` as @${op.ref}` : ''}`);
          break;
        }
        case 'update': {
          if (!op.nodeId || !op.props) { log.push(`${step}: needs nodeId and props`); break; }
          store.update(op.nodeId, withSpecs(op.props, store.getSnapshot()[op.nodeId]));
          log.push(`${step}: updated ${op.nodeId}`);
          break;
        }
        case 'delete':
          store.remove(many.filter((id) => id !== ROOT_ID));
          log.push(`${step}: removed ${many.length} layer(s)`);
          break;
        case 'reparent': {
          if (!op.nodeId || !has(op.parentId)) { log.push(`${step}: needs nodeId and a real parentId`); break; }
          store.reparent(op.nodeId, op.parentId!, op.index);
          log.push(`${step}: moved ${op.nodeId} into ${op.parentId}`);
          break;
        }
        case 'reorder':
          store.reorder(many, op.where ?? 'front');
          log.push(`${step}: brought ${many.length} to ${op.where ?? 'front'}`);
          break;
        case 'duplicate': {
          const made = store.duplicate(many, op.offset ?? 20);
          bind(made[0]);
          log.push(`${step}: ${made.join(', ') || 'nothing to copy'}`);
          break;
        }
        case 'group': {
          const id = bind(store.group(many));
          log.push(`${step}: ${id ?? 'needs two or more layers with the same parent'}`);
          break;
        }
        case 'ungroup': {
          const freed = store.ungroup(many);
          log.push(`${step}: released ${freed.length} layer(s)`);
          break;
        }
        case 'section': {
          const id = bind(store.wrapInSection(many));
          log.push(`${step}: ${id ?? 'nothing to wrap'}`);
          break;
        }
        case 'mask':
          store.toggleMask(many);
          log.push(`${step}: toggled the mask on ${many[0]}`);
          break;
        case 'boolean': {
          const id = bind(store.booleanGroup(many, (op.boolean ?? 'union') as BooleanOp));
          log.push(`${step}: ${id ?? 'needs two or more shapes'}`);
          break;
        }
        case 'flatten': {
          const id = bind(store.flatten(many));
          log.push(`${step}: ${id ?? 'nothing to flatten'}`);
          break;
        }
        case 'outline_stroke': {
          const made = store.outlineStroke(many);
          bind(made[0]);
          log.push(`${step}: ${made.length} outline(s)`);
          break;
        }
        case 'align':
          store.align(many, op.edge ?? 'left');
          log.push(`${step}: ${op.edge ?? 'left'}`);
          break;
        case 'distribute':
          store.distribute(many, op.axis ?? 'horizontal');
          log.push(`${step}: ${op.axis ?? 'horizontal'}`);
          break;
        case 'tidy':
          store.tidyUp(many);
          log.push(`${step}: tidied ${many.length}`);
          break;
        case 'resize_to_fit':
          store.resizeToFit(many);
          log.push(`${step}: resized ${many.length} to fit`);
          break;
        case 'auto_layout': {
          if (!op.nodeId) { log.push(`${step}: needs nodeId`); break; }
          store.setAutoLayout(op.nodeId, op.on ?? true, { seed: op.flex as Partial<FlexSpec> });
          log.push(`${step}: ${op.on === false ? 'off' : 'on'} for ${op.nodeId}`);
          break;
        }
        case 'scale':
          store.scaleNodes(many, op.factor ?? 1);
          log.push(`${step}: ×${op.factor ?? 1}`);
          break;
        case 'create_component': {
          if (!op.nodeId) { log.push(`${step}: needs nodeId`); break; }
          const made = store.createComponent(op.nodeId);
          if (made) bind(op.nodeId);
          log.push(`${step}: ${made ? `${op.nodeId} is now a main component` : 'that layer cannot be a component'}`);
          break;
        }
        case 'create_instance': {
          if (!has(op.mainId)) { log.push(`${step}: no main component "${op.mainId}"`); break; }
          const parent = op.parentId ?? ROOT_ID;
          const id = bind(store.createInstance(op.mainId!, parent, { x: op.x ?? 0, y: op.y ?? 0 }));
          log.push(`${step}: ${id ?? 'that node is not a main component'}`);
          break;
        }
        case 'swap_instance': {
          if (!op.nodeId || !has(op.mainId)) { log.push(`${step}: needs nodeId and mainId`); break; }
          log.push(`${step}: ${bind(store.swapInstance(op.nodeId, op.mainId!)) ?? 'could not swap'}`);
          break;
        }
        case 'detach_instance':
          store.detachInstance(op.nodeId!);
          log.push(`${step}: detached ${op.nodeId}`);
          break;
        case 'reset_instance':
          store.resetInstance(op.nodeId!);
          log.push(`${step}: reset ${op.nodeId}`);
          break;
        case 'add_component_prop': {
          if (!has(op.mainId) || !op.name) { log.push(`${step}: needs mainId and name`); break; }
          const id = bind(store.addComponentProp(op.mainId!, {
            name: op.name,
            type: (op.propType ?? 'text') as PropType,
            value: op.value ?? '',
            ...(op.options ? { options: op.options } : {}),
          }));
          log.push(`${step}: ${id ? `prop ${id}${op.ref ? ` as @${op.ref}` : ''}` : 'that node is not a component'}`);
          break;
        }
        case 'set_prop_value': {
          if (!has(op.instanceId) || !op.propId) { log.push(`${step}: needs instanceId and propId`); break; }
          const id = store.setPropValue(op.instanceId!, op.propId, op.value ?? '');
          log.push(`${step}: ${id ?? 'nothing changed'}`);
          break;
        }
        case 'combine_variants': {
          const id = bind(store.combineAsVariants(many));
          log.push(`${step}: ${id ?? 'needs two or more components'}`);
          break;
        }
        case 'add_interaction': {
          if (!op.nodeId) { log.push(`${step}: needs nodeId`); break; }
          const id = store.addInteraction(op.nodeId, {
            ...(op.trigger ? { trigger: op.trigger } : {}),
            ...(op.action ? { action: op.action } : {}),
            ...(op.destination ? { destination: op.destination } : {}),
            ...(op.url ? { url: op.url } : {}),
            ...(op.transition
              ? { transition: { ...DEFAULT_TRANSITION, ...op.transition } }
              : {}),
            ...(op.branches
              ? {
                  branches: op.branches.map((branch) => ({
                    id: newId(),
                    ...(branch.condition !== undefined ? { condition: branch.condition } : {}),
                    actions: branch.actions.map((step) =>
                      newInteraction({
                        trigger: 'none',
                        action: step.action as InteractionAction,
                        ...(step.destination ? { destination: step.destination } : {}),
                        ...(step.url ? { url: step.url } : {}),
                        ...(step.variable ? { variable: step.variable } : {}),
                        ...(step.value !== undefined ? { value: step.value } : {}),
                      }),
                    ),
                  })),
                }
              : {}),
            ...(op.animation ? { animation: op.animation } : {}),
            ...(op.behavior ? { behavior: op.behavior } : {}),
            ...(op.timestamp !== undefined ? { timestamp: op.timestamp } : {}),
            ...(op.resetVideo !== undefined ? { resetVideo: op.resetVideo } : {}),
            ...(op.resetScroll !== undefined ? { resetScroll: op.resetScroll } : {}),
            ...(op.resetComponentState !== undefined
              ? { resetComponentState: op.resetComponentState }
              : {}),
          });
          log.push(`${step}: ${id ?? 'no such layer'}`);
          break;
        }
        case 'set_motion': {
          const frame = op.frameId ?? op.nodeId;
          if (!frame) { log.push(`${step}: needs frameId`); break; }
          store.ensureMotion(frame, {
            ...(op.duration !== undefined ? { duration: Math.round(op.duration) } : {}),
            ...(op.loop !== undefined ? { loop: op.loop } : {}),
          });
          const spec = motionOf(store.getSnapshot()[frame]);
          log.push(`${step}: ${spec ? `${spec.duration}ms${spec.loop ? ', looping' : ''}` : 'no such frame'}`);
          break;
        }
        case 'set_keyframe': {
          const frame = op.frameId;
          if (!frame || !op.nodeId || !op.property || op.value === undefined) {
            log.push(`${step}: needs frameId, nodeId, property and value`);
            break;
          }
          // a number arrives as text, as every value on this op does; a colour
          // stays text, which is what the track holds anyway
          const raw =
            op.property === 'fill' || op.property === 'strokeColor' ? op.value : Number(op.value);
          if (typeof raw === 'number' && !Number.isFinite(raw)) {
            log.push(`${step}: "${op.value}" is not a number`);
            break;
          }
          const id = store.setKeyframe(frame, op.nodeId, op.property, op.at ?? 0, raw, {
            ...(op.easing ? { easing: op.easing } : {}),
          });
          log.push(`${step}: ${id ? `${op.property} at ${op.at ?? 0}ms` : 'no such frame or layer'}`);
          break;
        }
        case 'clear_motion': {
          const frame = op.frameId ?? op.nodeId;
          if (!frame) { log.push(`${step}: needs frameId`); break; }
          store.clearMotion(frame);
          log.push(`${step}: cleared`);
          break;
        }
        case 'set_flow_start':
          store.setFlowStart(op.nodeId!, op.name ?? null);
          log.push(`${step}: ${op.name ? `"${op.name}"` : 'cleared'}`);
          break;
        case 'create_style': {
          if (!op.nodeId || !op.name) { log.push(`${step}: needs nodeId, slot and name`); break; }
          const id = bind(store.createStyleFrom(op.nodeId, (op.slot ?? 'fill') as StyleSlot, op.name));
          log.push(`${step}: ${id ?? 'that layer has nothing in that slot'}`);
          break;
        }
        case 'apply_style': {
          if (!op.styleId) { log.push(`${step}: needs styleId`); break; }
          store.applyStyle(many, op.styleId, op.slot as StyleSlot | undefined);
          log.push(`${step}: applied to ${many.length}`);
          break;
        }
        case 'add_page': {
          const id = bind(store.addPage(op.name));
          log.push(`${step}: page ${id}${op.ref ? ` as @${op.ref}` : ''}`);
          break;
        }
        // Tokens belong in the same batch as the layers that reference them:
        // a design that defines --brand and paints with var(--brand) is one
        // call, not two.
        case 'set_variable': {
          if (!op.name) { log.push(`${step}: needs a name`); break; }
          const existing = store.listTokens().find((t) => t.name === op.name);
          if (existing) {
            store.updateToken(existing.id, { value: op.value ?? '', type: op.varType ?? existing.type });
            bind(existing.id);
          } else {
            bind(store.addToken({ name: op.name, value: op.value ?? '', type: op.varType ?? 'color' }));
          }
          log.push(`${step}: --${op.name}: ${op.value ?? ''}`);
          break;
        }
        case 'rename': {
          if (!op.nodeId || !op.name) { log.push(`${step}: needs nodeId and name`); break; }
          store.update(op.nodeId, { name: op.name });
          log.push(`${step}: ${op.nodeId} is now "${op.name}"`);
          break;
        }
        // The one op that is worth more than the rest of the list put together:
        // a subtree arrives as markup rather than as a node per call, and its
        // `data-ref`s join the same ref table the other ops use.
        case 'write_html': {
          if (!op.html) { log.push(`${step}: needs html`); break; }
          const parent = op.parentId ?? ROOT_ID;
          if (!has(parent)) { log.push(`${step}: no parent "${parent}" — skipped`); break; }
          const specs = await readHtml(op.html, {
            ...(op.width ? { width: op.width } : {}),
            ...(op.css ? { css: op.css } : {}),
          });
          if (op.x !== undefined || op.y !== undefined) {
            for (const spec of specs) {
              spec.props.x = ((spec.props.x as number) ?? 0) + (op.x ?? 0);
              spec.props.y = ((spec.props.y as number) ?? 0) + (op.y ?? 0);
            }
          }
          const built = writeSpecs(store, specs, parent, refs);
          // the op's own ref names the outermost layer it made; the markup's
          // `data-ref`s have already gone into the same table
          bind(built.top[0]);
          log.push(`${step}: built ${built.count} layer(s) in ${parent}`);
          break;
        }
        default:
          log.push(`${step}: not a known operation`);
      }
    }

    await settle();
    if (refs.size) {
      log.push('', 'refs:');
      for (const [name, id] of refs) log.push(`  @${name} = ${id}`);
    }
    return text(log.join('\n'));
  },
);

/** Gives the CRDT a moment to flush to the sync server before we reply. */
function settle(ms = 120): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    closeAll();
    void closeRenderer().finally(() => process.exit(0));
  });
}

await server.connect(new StdioServerTransport());
