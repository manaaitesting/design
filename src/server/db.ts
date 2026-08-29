import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Storage for accounts and the file index.
 *
 * Uses Node's built-in SQLite so the whole platform runs with `pnpm install`
 * and nothing else — no native build step, no database server. Document
 * *content* does not live here; that is the CRDT, owned by the sync server.
 */

// Overridable so a test can point at a scratch directory, the same way the
// sync server and the history reader can.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), '.data');
fs.mkdirSync(DATA_DIR, { recursive: true });

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) return instance;
  instance = new DatabaseSync(path.join(DATA_DIR, 'paperlike.db'));
  instance.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      color         TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_members (
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role    TEXT NOT NULL,
      PRIMARY KEY (file_id, user_id)
    );

    -- Published components: the shared library.
    --
    -- A published component is stored as the same clipboard payload a copy
    -- produces, because that payload already knows how to become layers in any
    -- document. The version column is what tells a consuming file that the
    -- original has moved on since it imported.
    CREATE TABLE IF NOT EXISTS library_components (
      id         TEXT PRIMARY KEY,
      file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      node_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      payload    TEXT NOT NULL,
      version    INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (file_id, node_id)
    );

    -- Folders.
    --
    -- Flat, and owned by one person. A folder is a way of looking at your own
    -- file list, not a permission boundary: a file shared with you stays
    -- visible whatever folder its owner filed it under, which is why the
    -- folder lives beside the file rather than deciding who may see it.
    CREATE TABLE IF NOT EXISTS folders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS folders_owner ON folders(owner_id);
    CREATE INDEX IF NOT EXISTS files_owner ON files(owner_id);
    CREATE INDEX IF NOT EXISTS members_user ON file_members(user_id);
    CREATE INDEX IF NOT EXISTS library_file ON library_components(file_id);

    -- Code Connect: which node is which component in the codebase.
    --
    -- The mapping belongs beside the file index rather than in the document,
    -- because it describes the repository, not the design: a file opened on a
    -- machine without the code is still a valid file, just without the links.
    CREATE TABLE IF NOT EXISTS code_connect (
      file_id        TEXT NOT NULL,
      node_id        TEXT NOT NULL,
      label          TEXT NOT NULL,
      component_name TEXT NOT NULL,
      source         TEXT NOT NULL,
      template       TEXT,
      updated_at     INTEGER NOT NULL,
      PRIMARY KEY (file_id, node_id, label)
    );
  `);
  // A file browser with no pictures in it is a list of filenames. The column is
  // added after the fact so an existing database keeps working untouched.
  const columns = instance.prepare('PRAGMA table_info(files)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'thumbnail')) {
    instance.exec('ALTER TABLE files ADD COLUMN thumbnail TEXT');
  }
  // What anyone holding the link may do: nothing (the column is null, and the
  // file is invisible without a membership row), look, or edit. Sharing by
  // email cannot reach someone with no account yet; a link can.
  if (!columns.some((column) => column.name === 'link_role')) {
    instance.exec('ALTER TABLE files ADD COLUMN link_role TEXT');
  }
  // Which folder the file is filed under, for its owner. Added by ALTER, so it
  // carries no foreign key — `deleteFolder` empties it by hand instead.
  if (!columns.some((column) => column.name === 'folder_id')) {
    instance.exec('ALTER TABLE files ADD COLUMN folder_id TEXT');
  }
  return instance;
}

export interface User {
  id: string;
  email: string;
  name: string;
  color: string;
}

export interface FileRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
  updated_at: number;
  role: string;
  owner_name: string;
  /** a small PNG of the first artboard, captured by the editor */
  thumbnail?: string | null;
  /** what anyone with the link may do: null is "nothing — it is private" */
  link_role?: string | null;
  /** the owner's folder, or null for the top level */
  folder_id?: string | null;
}

export interface Folder {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
}

// ── Users ────────────────────────────────────────────────────────────────

export function findUserByEmail(email: string) {
  return db()
    .prepare('SELECT id, email, name, color, password_hash FROM users WHERE email = ?')
    .get(email.toLowerCase()) as (User & { password_hash: string }) | undefined;
}

export function findUserById(id: string): User | undefined {
  return db().prepare('SELECT id, email, name, color FROM users WHERE id = ?').get(id) as User | undefined;
}

export function createUser(user: User & { passwordHash: string }): void {
  db()
    .prepare('INSERT INTO users (id, email, name, color, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id, user.email.toLowerCase(), user.name, user.color, user.passwordHash, Date.now());
}

/** Everyone with an account — the MCP server has no session to ask. */
export function listAllUsers(): User[] {
  return db().prepare('SELECT id, email, name, color FROM users ORDER BY created_at').all() as unknown as User[];
}

// ── Files ────────────────────────────────────────────────────────────────

export function createFile(id: string, name: string, ownerId: string): void {
  const now = Date.now();
  const database = db();
  database.prepare('INSERT INTO files (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, ownerId, now, now);
  database.prepare('INSERT INTO file_members (file_id, user_id, role) VALUES (?, ?, ?)')
    .run(id, ownerId, 'owner');
}

export interface FileQuery {
  /** substring of the name, case-insensitively */
  q?: string;
  /** a folder id, or 'none' for the files in no folder at all */
  folder?: string;
  sort?: 'recent' | 'name' | 'created';
}

/**
 * Files the user owns or has been invited to.
 *
 * Filtering happens here rather than in the page because the list is the thing
 * that grows: a dashboard that fetches four hundred rows to show six is the
 * same bug whether or not anyone has noticed it yet.
 */
export function listFiles(userId: string, query: FileQuery = {}): FileRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [userId];

  if (query.q?.trim()) {
    // LIKE is already case-insensitive for ASCII in SQLite; the ESCAPE keeps a
    // name containing % or _ from turning into a wildcard search
    where.push("f.name LIKE ? ESCAPE '\\'");
    params.push(`%${query.q.trim().replace(/[%_\\]/g, (char) => `\\${char}`)}%`);
  }
  if (query.folder === 'none') where.push('f.folder_id IS NULL');
  else if (query.folder) {
    where.push('f.folder_id = ?');
    params.push(query.folder);
  }

  const order =
    query.sort === 'name'
      ? 'f.name COLLATE NOCASE ASC'
      : query.sort === 'created'
        ? 'f.created_at DESC'
        : 'f.updated_at DESC';

  return db()
    .prepare(
      `SELECT f.id, f.name, f.owner_id, f.created_at, f.updated_at, f.thumbnail, f.link_role,
              f.folder_id, m.role, u.name AS owner_name
         FROM files f
         JOIN file_members m ON m.file_id = f.id AND m.user_id = ?
         JOIN users u ON u.id = f.owner_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${order}`,
    )
    .all(...params) as unknown as FileRow[];
}

// ── Folders ──────────────────────────────────────────────────────────────

export function listFolders(userId: string): (Folder & { count: number })[] {
  return db()
    .prepare(
      `SELECT d.id, d.name, d.owner_id, d.created_at,
              (SELECT COUNT(*) FROM files f
                 JOIN file_members m ON m.file_id = f.id AND m.user_id = d.owner_id
                WHERE f.folder_id = d.id) AS count
         FROM folders d
        WHERE d.owner_id = ?
        ORDER BY d.name COLLATE NOCASE ASC`,
    )
    .all(userId) as unknown as (Folder & { count: number })[];
}

export function createFolder(id: string, name: string, ownerId: string): void {
  db()
    .prepare('INSERT INTO folders (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, ownerId, Date.now());
}

export function renameFolder(id: string, ownerId: string, name: string): void {
  db().prepare('UPDATE folders SET name = ? WHERE id = ? AND owner_id = ?').run(name, id, ownerId);
}

/** Deleting a folder empties it; it never takes the files down with it. */
export function deleteFolder(id: string, ownerId: string): void {
  const database = db();
  const owned = database.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!owned) return;
  database.prepare('UPDATE files SET folder_id = NULL WHERE folder_id = ?').run(id);
  database.prepare('DELETE FROM folders WHERE id = ?').run(id);
}

/** Files it into a folder, or out of every folder with null. */
export function moveFileToFolder(fileId: string, userId: string, folderId: string | null): void {
  // only a member may file it, and only into a folder they own
  if (!getFileFor(fileId, userId)) return;
  if (folderId) {
    const owned = db()
      .prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ?')
      .get(folderId, userId);
    if (!owned) return;
  }
  db().prepare('UPDATE files SET folder_id = ? WHERE id = ?').run(folderId, fileId);
}

/** Every file in the workspace — used by the MCP server, which has no session. */
export function listAllFiles(): FileRow[] {
  return db()
    .prepare(
      `SELECT f.id, f.name, f.owner_id, f.created_at, f.updated_at, 'owner' AS role, u.name AS owner_name
         FROM files f JOIN users u ON u.id = f.owner_id
        ORDER BY f.updated_at DESC`,
    )
    .all() as unknown as FileRow[];
}

export function getFileFor(fileId: string, userId: string): FileRow | undefined {
  return db()
    .prepare(
      `SELECT f.id, f.name, f.owner_id, f.created_at, f.updated_at, f.link_role, m.role, u.name AS owner_name
         FROM files f
         JOIN file_members m ON m.file_id = f.id AND m.user_id = ?
         JOIN users u ON u.id = f.owner_id
        WHERE f.id = ?`,
    )
    .get(userId, fileId) as unknown as FileRow | undefined;
}

/**
 * The file as anyone holding the link sees it, or undefined when the link
 * grants nothing.
 *
 * `role` comes back as the *link's* role, so the caller can treat a link
 * visitor exactly like a member — the sync token is signed with it either way,
 * and the sync server drops a viewer's writes without knowing the difference.
 */
export function getFileByLink(fileId: string): FileRow | undefined {
  const row = db()
    .prepare(
      `SELECT f.id, f.name, f.owner_id, f.created_at, f.updated_at, f.link_role,
              f.link_role AS role, u.name AS owner_name
         FROM files f JOIN users u ON u.id = f.owner_id
        WHERE f.id = ? AND f.link_role IS NOT NULL`,
    )
    .get(fileId) as unknown as FileRow | undefined;
  return row;
}

/** Turns link sharing on at a role, or off with null. The owner's call. */
export function setLinkRole(
  fileId: string,
  ownerId: string,
  role: 'editor' | 'viewer' | null,
): boolean {
  const result = db()
    .prepare('UPDATE files SET link_role = ? WHERE id = ? AND owner_id = ?')
    .run(role, fileId, ownerId);
  return result.changes > 0;
}

/**
 * Copies a file, content and all.
 *
 * The document lives in the sync server's `.bin`, so duplicating a file is a
 * row plus a file copy — and the copy belongs to whoever asked for it, not to
 * whoever owned the original.
 */
export function duplicateFile(fileId: string, userId: string, newId: string): string | null {
  const source = getFileFor(fileId, userId);
  if (!source) return null;
  createFile(newId, `${source.name} copy`, userId);

  const from = path.join(DATA_DIR, `${encodeURIComponent(fileId)}.bin`);
  const to = path.join(DATA_DIR, `${encodeURIComponent(newId)}.bin`);
  try {
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  } catch {
    // an unreadable snapshot leaves an empty file rather than no file at all
  }
  if (source.thumbnail) {
    db().prepare('UPDATE files SET thumbnail = ? WHERE id = ?').run(source.thumbnail, newId);
  }
  return newId;
}

export function setThumbnail(fileId: string, userId: string, thumbnail: string): void {
  if (!getFileFor(fileId, userId)) return;
  db().prepare('UPDATE files SET thumbnail = ? WHERE id = ?').run(thumbnail, fileId);
}

export function renameFile(fileId: string, ownerId: string, name: string): void {
  db().prepare('UPDATE files SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .run(name, Date.now(), fileId, ownerId);
}

export function touchFile(fileId: string): void {
  db().prepare('UPDATE files SET updated_at = ? WHERE id = ?').run(Date.now(), fileId);
}

export function deleteFile(fileId: string, ownerId: string): boolean {
  const result = db().prepare('DELETE FROM files WHERE id = ? AND owner_id = ?').run(fileId, ownerId);
  if (result.changes > 0) {
    // the CRDT snapshot is the sync server's, but an orphaned file is dead weight
    const snapshot = path.join(DATA_DIR, `${encodeURIComponent(fileId)}.bin`);
    fs.rmSync(snapshot, { force: true });
    return true;
  }
  return false;
}

export function shareFile(
  fileId: string,
  ownerId: string,
  email: string,
  role: 'editor' | 'viewer' = 'editor',
): string | null {
  const file = db().prepare('SELECT id FROM files WHERE id = ? AND owner_id = ?').get(fileId, ownerId);
  if (!file) return 'You can only share files you own.';
  const invitee = findUserByEmail(email);
  if (!invitee) return 'No account with that email yet.';
  if (invitee.id === ownerId) return 'You already own this file.';
  db().prepare('INSERT OR REPLACE INTO file_members (file_id, user_id, role) VALUES (?, ?, ?)')
    .run(fileId, invitee.id, role === 'viewer' ? 'viewer' : 'editor');
  return null;
}

// ── The shared library ───────────────────────────────────────────────────

export interface LibraryComponent {
  id: string;
  file_id: string;
  node_id: string;
  name: string;
  payload: string;
  version: number;
  updated_at: number;
  /** the file it was published from, for the panel to say where it came from */
  file_name: string;
}

/**
 * Publishes a component, or re-publishes it.
 *
 * Re-publishing bumps the version rather than making a second entry: a file
 * that already imported this component is watching that number, and a new row
 * would look like a different component.
 */
export function publishComponent(
  fileId: string,
  nodeId: string,
  name: string,
  payload: string,
): { id: string; version: number } {
  const database = db();
  const existing = database
    .prepare('SELECT id, version FROM library_components WHERE file_id = ? AND node_id = ?')
    .get(fileId, nodeId) as { id: string; version: number } | undefined;

  if (existing) {
    const version = existing.version + 1;
    database
      .prepare(
        'UPDATE library_components SET name = ?, payload = ?, version = ?, updated_at = ? WHERE id = ?',
      )
      .run(name, payload, version, Date.now(), existing.id);
    return { id: existing.id, version };
  }

  const id = `lib_${fileId}_${nodeId}`;
  database
    .prepare(
      'INSERT INTO library_components (id, file_id, node_id, name, payload, version, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
    )
    .run(id, fileId, nodeId, name, payload, Date.now());
  return { id, version: 1 };
}

export function unpublishComponent(fileId: string, nodeId: string): void {
  db().prepare('DELETE FROM library_components WHERE file_id = ? AND node_id = ?').run(fileId, nodeId);
}

/** Everything published from a file this user is a member of. */
export function listLibrary(userId: string): LibraryComponent[] {
  return db()
    .prepare(
      `SELECT c.*, f.name AS file_name
         FROM library_components c
         JOIN files f ON f.id = c.file_id
         JOIN file_members m ON m.file_id = c.file_id AND m.user_id = ?
        ORDER BY f.name, c.name`,
    )
    .all(userId) as unknown as LibraryComponent[];
}

/** What one file has published — the library it is, rather than the ones it uses. */
export function listLibraryForFile(fileId: string): LibraryComponent[] {
  return db()
    .prepare(
      `SELECT c.*, f.name AS file_name
         FROM library_components c JOIN files f ON f.id = c.file_id
        WHERE c.file_id = ? ORDER BY c.name`,
    )
    .all(fileId) as unknown as LibraryComponent[];
}

/** Everything published anywhere in the workspace — what a file could add. */
export function listAllLibrary(): LibraryComponent[] {
  return db()
    .prepare(
      `SELECT c.*, f.name AS file_name
         FROM library_components c JOIN files f ON f.id = c.file_id
        ORDER BY f.name, c.name`,
    )
    .all() as unknown as LibraryComponent[];
}

export function getLibraryComponent(id: string): LibraryComponent | undefined {
  return db()
    .prepare(
      `SELECT c.*, f.name AS file_name
         FROM library_components c JOIN files f ON f.id = c.file_id
        WHERE c.id = ?`,
    )
    .get(id) as unknown as LibraryComponent | undefined;
}

export function listMembers(fileId: string): User[] {
  return db()
    .prepare(
      `SELECT u.id, u.email, u.name, u.color
         FROM file_members m JOIN users u ON u.id = m.user_id
        WHERE m.file_id = ? ORDER BY m.role DESC, u.name`,
    )
    .all(fileId) as unknown as User[];
}

// ── Code Connect ─────────────────────────────────────────────────────────

export interface CodeConnectRow {
  file_id: string;
  node_id: string;
  label: string;
  component_name: string;
  source: string;
  template?: string | null;
  updated_at: number;
}

/**
 * Points a node at the component that implements it.
 *
 * One row per label, so the same node can be a React component here and a
 * SwiftUI view there, exactly as Figma's Code Connect allows.
 */
export function mapCodeConnect(entry: Omit<CodeConnectRow, 'updated_at'>): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO code_connect
         (file_id, node_id, label, component_name, source, template, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.file_id,
      entry.node_id,
      entry.label,
      entry.component_name,
      entry.source,
      entry.template ?? null,
      Date.now(),
    );
}

/** Every mapping in a file, or just the ones for the nodes asked about. */
export function codeConnectFor(fileId: string, nodeIds?: string[]): CodeConnectRow[] {
  if (!nodeIds?.length) {
    return db()
      .prepare('SELECT * FROM code_connect WHERE file_id = ? ORDER BY node_id, label')
      .all(fileId) as unknown as CodeConnectRow[];
  }
  const holes = nodeIds.map(() => '?').join(', ');
  return db()
    .prepare(
      `SELECT * FROM code_connect WHERE file_id = ? AND node_id IN (${holes}) ORDER BY node_id, label`,
    )
    .all(fileId, ...nodeIds) as unknown as CodeConnectRow[];
}

export function unmapCodeConnect(fileId: string, nodeId: string, label?: string): number {
  const result = label
    ? db()
        .prepare('DELETE FROM code_connect WHERE file_id = ? AND node_id = ? AND label = ?')
        .run(fileId, nodeId, label)
    : db().prepare('DELETE FROM code_connect WHERE file_id = ? AND node_id = ?').run(fileId, nodeId);
  return Number(result.changes);
}
