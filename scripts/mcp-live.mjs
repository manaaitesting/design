import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'live-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: 'npx', args: ['-y', 'tsx', 'server/mcp.ts'], cwd: process.cwd(), env: { ...process.env },
}));
const call = async (name, args) =>
  (await client.callTool({ name, arguments: args })).content.map((c) => c.text).join('\n');

// build a small card entirely through MCP, the way an agent would
const card = (await call('create_node', {
  fileId: 'demofile0', type: 'frame',
  props: {
    name: 'Made by an agent', x: 520, y: 0, w: 260, h: 160, fill: '#FFFFFF', radius: 12,
    flex: { mode: 'flex', direction: 'column', gap: 10, padding: [20, 20, 20, 20], align: 'stretch', justify: 'start', wrap: false },
  },
})).match(/frame (\w+)/)[1];

await call('create_node', {
  fileId: 'demofile0', type: 'text', parentId: card,
  props: { name: 'Heading', text: 'Written over MCP', wMode: 'fill', hMode: 'fit' },
});
await call('create_node', {
  fileId: 'demofile0', type: 'rect', parentId: card,
  props: { name: 'Swatch', wMode: 'fill', hMode: 'fixed', h: 60, radius: 8, fill: 'var(--brand)' },
});

console.log(await call('get_metadata', { fileId: 'demofile0', nodeId: card }));
await client.close();
process.exit(0);
