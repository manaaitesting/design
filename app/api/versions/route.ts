import fs from 'node:fs';
import path from 'node:path';
import { canEdit, currentUser, roleOf } from '../../../src/server/auth';
import { getFileByLink, getFileFor, SNAPSHOT_DIR } from '../../../src/server/db';

/**
 * A version's bytes, in and out.
 *
 * The snapshot of a real design is hundreds of kilobytes to a few megabytes,
 * and a server action's arguments are not built for that: past a certain size
 * the framework refuses the payload ("Maximum array nesting exceeded") and a
 * named version silently fails to save. A route handler takes the bytes as
 * the request body, which has no such ceiling, and hands them back the same
 * way. `listVersionsAction` stays a server action — a list is small.
 */

const NAMED = '__named__';
const MAX_BYTES = 40 * 1024 * 1024;

async function canSee(fileId: string): Promise<boolean> {
  const user = await currentUser();
  const file = user ? getFileFor(fileId, user.id) : undefined;
  return Boolean(file ?? getFileByLink(fileId));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fileId = url.searchParams.get('file') ?? '';
  const stamp = url.searchParams.get('stamp') ?? '';
  if (!fileId || !stamp || !(await canSee(fileId))) return new Response(null, { status: 404 });
  // the stamp is a path segment written by us; anything else is not one
  if (!/^[0-9TZ-]+$/.test(stamp)) return new Response(null, { status: 400 });
  const prefix = `${encodeURIComponent(fileId)}__${stamp}`;
  try {
    const match = fs
      .readdirSync(SNAPSHOT_DIR)
      .find((f) => f.startsWith(prefix) && f.endsWith('.bin') && f.slice(prefix.length).match(/^(__keep|__named__.*)?\.bin$/));
    if (!match) return new Response(null, { status: 404 });
    const bytes = fs.readFileSync(path.join(SNAPSHOT_DIR, match));
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const url = new URL(request.url);
  const fileId = url.searchParams.get('file') ?? '';
  const label = (url.searchParams.get('name') ?? '').trim().slice(0, 80);
  const file = fileId ? getFileFor(fileId, user.id) : undefined;
  if (!file || !canEdit(roleOf(file.role))) return Response.json({ error: 'Not your file to version.' }, { status: 403 });
  if (!label) return Response.json({ error: 'Name the version.' }, { status: 400 });
  const bytes = Buffer.from(await request.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return Response.json({ error: 'That snapshot is empty or too large.' }, { status: 413 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SNAPSHOT_DIR, `${encodeURIComponent(fileId)}__${stamp}${NAMED}${encodeURIComponent(label)}.bin`),
      bytes,
    );
  } catch {
    return Response.json({ error: 'Could not write the version.' }, { status: 500 });
  }
  const iso = stamp.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d\d\d)Z$/, 'T$1:$2:$3.$4Z');
  return Response.json({ stamp, at: Date.parse(iso) || Date.now(), name: label, kept: false, bytes: bytes.length });
}
