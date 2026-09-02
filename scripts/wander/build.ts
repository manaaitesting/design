import fs from 'node:fs';
import path from 'node:path';
import { readHtml } from '../../server/mcp-html';
import { closeRenderer } from '../../server/mcp-render';
import { closeAll, openFile } from '../../server/mcp-doc';
import { writeSpecs } from '../../src/lib/html-import';

const envFile = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const [fileId, only] = process.argv.slice(2);
const screens = JSON.parse(fs.readFileSync(path.join('scripts/wander/screens.json'), 'utf8')) as {
  name: string; x: number; y: number; width: number; html: string; css: string;
}[];
const { store } = await openFile(fileId);
for (const screen of screens) {
  if (only && !screen.name.startsWith(only)) continue;
  // a rebuild replaces the screen of the same name rather than stacking one on it
  const doc = store.getSnapshot();
  const stale = doc.root.children.filter((id) => doc[id]?.name === screen.name);
  if (stale.length) store.remove(stale);
  const specs = await readHtml(screen.html, { width: screen.width, css: screen.css });
  const root = specs[0];
  root.props.name = screen.name;
  root.props.x = screen.x;
  root.props.y = screen.y;
  root.props.clip = true;
  const { count, top } = writeSpecs(store, specs, 'root');
  console.log(`${screen.name}: ${count} layers, root ${top[0]}`);
}
store.commit();
await new Promise((r) => setTimeout(r, 1000));
await closeRenderer();
closeAll();
process.exit(0);
