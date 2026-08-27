/**
 * Clipboard for design nodes.
 *
 * The system clipboard is the right home — it lets you paste between files and
 * tabs — but `readText()` needs a permission that is often unavailable, so an
 * in-memory copy always shadows it. Whichever answers, paste works.
 */
let memory = '';

export async function writeNodes(payload: string): Promise<void> {
  memory = payload;
  try {
    await navigator.clipboard.writeText(payload);
  } catch {
    // permission denied or insecure context — the in-memory copy still serves
  }
}

export async function readNodes(): Promise<string> {
  try {
    const text = await navigator.clipboard.readText();
    // only prefer the system clipboard when it actually holds our payload
    if (text.includes('"paperlike"')) return text;
    if (text.trim() && !memory) return text;
  } catch {
    // fall through to memory
  }
  return memory;
}

export function hasNodes(): boolean {
  return memory.includes('"paperlike"');
}
