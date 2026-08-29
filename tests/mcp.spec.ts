import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * The MCP surface, driven the way an agent drives it.
 *
 * These tools are the only part of the app with no screen to check them on: a
 * broken one fails silently inside somebody else's agent. So the server is
 * spawned for real, over stdio, against a scratch database and a scratch sync
 * server, and asked to do the things it claims it can do.
 */

const SECRET = 'mcp-test-secret';
const PORT = 11_235;

let sync: ChildProcess;
let client: Client;
let dataDir: string;
let fileId: string;
let cardId: string;
let textId: string;

/** Tool results are content parts; every tool here answers in text. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  return ((result.content as { type: string; text?: string }[]) ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

async function image(name: string, args: Record<string, unknown>): Promise<Buffer> {
  const result = await client.callTool({ name, arguments: args });
  const part = ((result.content as { type: string; data?: string }[]) ?? []).find(
    (entry) => entry.type === 'image',
  );
  expect(part, 'the tool returned no image').toBeTruthy();
  return Buffer.from(part!.data!, 'base64');
}

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlike-mcp-'));
  const env = {
    ...process.env,
    AUTH_SECRET: SECRET,
    DATA_DIR: dataDir,
    SYNC_PORT: String(PORT),
    SYNC_URL: `ws://localhost:${PORT}`,
  };

  sync = spawn('node', ['server/ws.mjs'], { env, stdio: 'pipe' });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sync server never started')), 10_000);
    sync.stdout!.on('data', (chunk: Buffer) => {
      if (!chunk.toString().includes('listening')) return;
      clearTimeout(timer);
      resolve();
    });
  });

  // the file index is the server's own database, so the account goes in first
  process.env.DATA_DIR = dataDir;
  const { createUser } = await import('../src/server/db');
  createUser({ id: 'u1', email: 'agent@example.com', name: 'Agent', color: '#0d99ff', passwordHash: 'x' });

  client = new Client({ name: 'mcp-spec', version: '1' });
  await client.connect(
    new StdioClientTransport({ command: 'npx', args: ['-y', 'tsx', 'server/mcp.ts'], env }),
  );
});

test.afterAll(async () => {
  await client?.close();
  sync?.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the server offers the whole design surface', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  for (const expected of [
    'list_files',
    'get_metadata',
    'get_design_context',
    'get_screenshot',
    'get_variable_defs',
    'get_libraries',
    'search_design_system',
    'get_motion_context',
    'list_shader_fills',
    'get_shader_fill',
    'list_shader_effects',
    'get_shader_effect',
    'get_code_connect_map',
    'add_code_connect_map',
    'download_assets',
    'create_new_file',
    'upload_asset',
    'edit_design',
    'write_html',
    'publish_component',
    'import_component',
    'whoami',
  ]) {
    expect(names, `${expected} is missing`).toContain(expected);
  }
});

test('a file can be built from nothing but tool calls', async () => {
  fileId = /id=(\S+)/.exec(await call('create_new_file', { name: 'Agent file' }))![1];
  expect(await call('list_files')).toContain(fileId);

  await call('set_variable', { fileId, name: 'brand', value: '#2C6BED' });
  cardId = /frame (\S+) in/.exec(
    await call('create_node', {
      fileId,
      type: 'frame',
      props: { name: 'Card', w: 320, h: 200, fill: 'var(--brand)', radius: 16 },
    }),
  )![1];
  textId = /text (\S+) in/.exec(
    await call('create_node', {
      fileId,
      type: 'text',
      parentId: cardId,
      props: { name: 'Title', w: 200, h: 40, text: 'Hello', font: { size: 28, color: '#ffffff' } },
    }),
  )![1];

  const tree = await call('get_metadata', { fileId });
  expect(tree).toContain(`id=${cardId}`);
  expect(tree).toContain(`id=${textId}`);
  // the variable is reported as used because the fill actually references it
  expect(await call('get_variable_defs', { fileId, nodeId: cardId })).toContain('brand: #2C6BED');
});

test('edit_design runs the canvas verbs in order', async () => {
  const log = await call('edit_design', {
    fileId,
    ops: [
      { op: 'auto_layout', nodeId: cardId, on: true, flex: { direction: 'column', gap: 12 } },
      { op: 'create', type: 'ellipse', parentId: cardId, props: { name: 'Dot', w: 40, h: 40, fill: '#fff' } },
      { op: 'create_component', nodeId: cardId },
      { op: 'create_instance', mainId: cardId, x: 400 },
      { op: 'add_interaction', nodeId: textId, trigger: 'click', action: 'url', url: 'https://example.com' },
      { op: 'set_flow_start', nodeId: cardId, name: 'Main' },
      { op: 'delete', nodeIds: ['does-not-exist'] },
    ],
  });
  expect(log).toContain('is now a main component');
  expect(log).toContain('no node does-not-exist — skipped');

  const tree = await call('get_metadata', { fileId });
  expect(tree.match(/"Card"/g)!.length).toBe(2); // the main and its instance
  expect(tree).toContain('flex:column');

  const motion = await call('get_motion_context', { fileId, nodeId: cardId });
  expect(motion).toContain('On click → Open link https://example.com');
  expect(motion).toContain('flow start: Main');
});

test('a whole screen lands in one edit_design call', async () => {
  // The point of refs. Without them this is one round trip per node — the
  // difference between three tool calls and a hundred — so the test is really
  // asserting the call count, by doing all of it in a single call.
  const log = await call('edit_design', {
    fileId,
    ops: [
      { op: 'add_page', ref: 'screen', name: 'Signup' },
      { op: 'set_variable', ref: 'accent', name: 'accent', value: '#111827' },
      {
        op: 'create',
        ref: 'form',
        type: 'frame',
        parentId: '@screen',
        props: { name: 'Form', w: 360, h: 280, fill: '#ffffff', radius: 12 },
      },
      {
        op: 'create',
        ref: 'heading',
        type: 'text',
        parentId: '@form',
        props: { name: 'Heading', w: 300, h: 32, text: 'Create account', font: { size: 24, color: 'var(--accent)' } },
      },
      {
        op: 'create',
        ref: 'button',
        type: 'frame',
        parentId: '@form',
        props: { name: 'Button', w: 300, h: 44, fill: 'var(--accent)', radius: 8 },
      },
      { op: 'auto_layout', nodeId: '@form', on: true, flex: { direction: 'column', gap: 16, padding: [24, 24, 24, 24] } },
      { op: 'create_component', ref: 'main', nodeId: '@button' },
      { op: 'create_instance', ref: 'copy', mainId: '@main', parentId: '@form' },
      { op: 'rename', nodeId: '@copy', name: 'Button copy' },
      { op: 'add_interaction', nodeId: '@button', trigger: 'click', action: 'navigate', destination: '@form' },
      { op: 'update', nodeId: '@nothing-bound-this', props: { name: 'nope' } },
    ],
  });

  // every ref resolved, and the one that never bound is reported rather than
  // silently written to the document as a literal id
  expect(log).toContain('nothing named @nothing-bound-this yet — skipped');
  expect(log).toContain('refs:');

  const pageId = /@screen = (\S+)/.exec(log)![1];
  const formId = /@form = (\S+)/.exec(log)![1];
  const buttonId = /@button = (\S+)/.exec(log)![1];

  const tree = await call('get_metadata', { fileId, nodeId: pageId });
  expect(tree).toContain(`id=${formId}`);
  expect(tree).toContain('flex:column');
  // the heading, the button, and the instance made from the button
  expect(tree).toContain('"Heading"');
  expect(tree).toContain('"Button copy"');
  // the variable defined in the same batch is the one the heading paints with
  expect(await call('get_variable_defs', { fileId, nodeId: formId })).toContain('accent: #111827');
  expect(await call('get_motion_context', { fileId, nodeId: buttonId })).toContain('On click');

  // and reading back is one call for several nodes, not one call each
  const context = await call('get_design_context', { fileId, nodeIds: [formId, buttonId], format: 'json' });
  expect(context).toContain(`(${formId})`);
  expect(context).toContain(`(${buttonId})`);

  // depth stops a big tree short rather than dumping all of it
  expect(await call('get_metadata', { fileId, nodeId: pageId, depth: 1 })).toContain('more inside');
});

test('a screen arrives as HTML and becomes real layers', async () => {
  // The whole point: this canvas is HTML and CSS, so the cheapest way to build
  // in it is to send HTML. One call, no round trip per layer.
  const log = await call('write_html', {
    fileId,
    width: 480,
    css: '.card { display: flex; flex-direction: column; gap: 12px; padding: 20px; background: #101828; border-radius: 14px; width: 320px; box-shadow: 0 8px 24px rgba(0,0,0,0.25); }',
    html: `<div class="card" data-ref="card" data-name="Pricing card">
             <h2 data-ref="title" style="margin:0;font:600 24px Inter;color:#ffffff">Pro</h2>
             <p data-ref="blurb" style="margin:0;font:400 14px Inter;color:#98a2b3">Everything, forever.</p>
             <div data-ref="cta" style="height:40px;background:#635bff;border-radius:8px"></div>
           </div>`,
  });

  expect(log).toContain('Built 4 layer(s)');
  const cardId = /card = (\S+)/.exec(log)![1];
  const titleId = /title = (\S+)/.exec(log)![1];
  const ctaId = /cta = (\S+)/.exec(log)![1];

  const tree = await call('get_metadata', { fileId, nodeId: cardId });
  // display:flex became a real auto layout, not a stack of absolute boxes
  expect(tree).toContain('flex:column');
  expect(tree).toContain('"Pricing card"');
  expect(tree).toContain(`id=${titleId}`);

  const title = JSON.parse(await call('get_node', { fileId, nodeId: titleId }));
  expect(title.type).toBe('text');
  expect(title.text).toBe('Pro');
  expect(title.font.size).toBe(24);
  expect(title.font.weight).toBe(600);
  expect(title.font.color).toBe('#ffffff');

  const card = JSON.parse(await call('get_node', { fileId, nodeId: cardId }));
  expect(card.fill).toBe('#101828');
  expect(card.radius).toBe(14);
  expect(card.w).toBe(320);
  expect(card.flex.gap).toBe(12);
  expect(card.flex.padding).toEqual([20, 20, 20, 20]);
  // the shadow came across as an effect, not as a lost declaration
  expect(card.effects?.[0]?.type).toBe('drop-shadow');

  const cta = JSON.parse(await call('get_node', { fileId, nodeId: ctaId }));
  expect(cta.fill).toBe('#635bff');
  expect(cta.h).toBe(40);

  // and it round-trips: the export of what we built says the same thing
  const code = await call('get_design_context', { fileId, nodeId: cardId, format: 'html' });
  expect(code).toContain('Everything, forever.');
});

test('write_html is an edit_design op too, so a build is still one call', async () => {
  const log = await call('edit_design', {
    fileId,
    ops: [
      { op: 'add_page', ref: 'page', name: 'Imported' },
      {
        op: 'write_html',
        ref: 'hero',
        parentId: '@page',
        html: '<section data-name="Hero" style="display:flex;gap:8px;padding:16px;background:#fff"><span data-ref="lead">Ship it</span></section>',
      },
      { op: 'rename', nodeId: '@hero', name: 'Hero section' },
      { op: 'update', nodeId: '@lead', props: { name: 'Lead line' } },
    ],
  });

  expect(log).toContain('built 2 layer(s)');
  const pageId = /@page = (\S+)/.exec(log)![1];
  const tree = await call('get_metadata', { fileId, nodeId: pageId });
  // the op's own ref named the outermost layer; the markup's data-ref named the
  // one inside it, and both were addressable by later ops in the same call
  expect(tree).toContain('"Hero section"');
  expect(tree).toContain('"Lead line"');
});

test('the design system is searchable and publishable', async () => {
  expect(await call('search_design_system', { fileId, query: 'card' })).toContain(`component  Card  id=${cardId}`);
  const published = await call('publish_component', { fileId, nodeId: cardId });
  expect(published).toContain('v1');
  expect(await call('get_libraries', { fileId })).toContain('Published from this file (1)');
});

test('Code Connect survives the round trip', async () => {
  await call('add_code_connect_map', {
    fileId,
    nodeId: cardId,
    componentName: 'Card',
    source: 'src/ui/Card.tsx',
  });
  const map = await call('get_code_connect_map', { fileId });
  expect(map).toContain('→  Card  src/ui/Card.tsx  [React]');
  // the mapping travels with the code, so an agent asking for the component
  // learns it already exists without having to ask a second question
  expect(await call('get_design_context', { fileId, nodeId: cardId })).toContain(
    'is already built: Card in src/ui/Card.tsx [React] — use it',
  );
  await call('add_code_connect_map', {
    fileId,
    nodeId: cardId,
    componentName: 'Card',
    source: 'src/ui/Card.tsx',
    remove: true,
  });
  expect(await call('get_code_connect_map', { fileId })).toContain('No Code Connect mappings');
});

test('a node renders to a real picture, at the size it says', async () => {
  const png = await image('get_screenshot', { fileId, nodeId: cardId, maxDimension: 160 });
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  // 320×200 capped to a 160px long edge
  expect(png.readUInt32BE(16)).toBe(160);
  expect(png.readUInt32BE(20)).toBe(100);

  const out = path.join(dataDir, 'assets');
  const written = await call('download_assets', { fileId, nodeId: cardId, dir: out });
  expect(written).toContain('export');
  expect(fs.readdirSync(out).some((file) => file.endsWith('.png'))).toBe(true);
  expect(fs.readdirSync(out).some((file) => file.endsWith('.svg'))).toBe(true);
});

test('shaders and effects describe themselves', async () => {
  expect(await call('list_shader_fills')).toContain('mesh');
  expect(await call('get_shader_fill', { id: 'mesh' })).toContain('#version 300 es');
  expect(await call('list_shader_effects')).toContain('drop-shadow');
  expect(await call('get_shader_effect', { id: 'glass' })).toContain('"refraction"');
});
