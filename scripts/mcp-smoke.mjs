import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', 'tsx', 'server/mcp.ts'],
  cwd: process.cwd(),
  env: { ...process.env },
});
const client = new Client({ name: 'audit', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return r.content.map((c) => c.text).join('\n');
};

console.log('\n--- list_files ---');
const files = await call('list_files');
console.log(files.slice(0, 300));

const fileId = (files.match(/^(\S+)/m) || [])[1] || 'demofile0';
console.log('\n--- get_metadata', fileId, '---');
console.log((await call('get_metadata', { fileId })).slice(0, 700));

console.log('\n--- get_variables ---');
console.log((await call('get_variables', { fileId })).slice(0, 300));

const meta = await call('get_metadata', { fileId });
const coverId = (meta.match(/"Cover" id=(\w+)/) || [])[1];
if (coverId) {
  console.log('\n--- get_design_context (react) on Cover ---');
  console.log((await call('get_design_context', { fileId, nodeId: coverId, format: 'react' })).slice(0, 600));
}

console.log('\n--- create_node ---');
const created = await call('create_node', {
  fileId, type: 'rect',
  props: { name: 'From MCP', x: 520, y: 60, w: 160, h: 90, fill: '#BDEE63', radius: 12 },
});
console.log(created);
const newId = (created.match(/rect (\w+)/) || [])[1];

console.log('\n--- update_node ---');
console.log(await call('update_node', { fileId, nodeId: newId, props: { fill: '#F2637F', name: 'Renamed by MCP' } }));

console.log('\n--- verify via get_node ---');
const node = JSON.parse(await call('get_node', { fileId, nodeId: newId }));
console.log('name:', node.name, '| fill:', node.fill, '| box:', node.w + 'x' + node.h);

console.log('\n--- delete_node ---');
console.log(await call('delete_node', { fileId, nodeId: newId }));

await client.close();
process.exit(0);
