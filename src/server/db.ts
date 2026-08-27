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

const DATA_DIR = path.resolve(process.cwd(), '.data');
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

    CREATE INDEX IF NOT EXISTS files_owner ON files(owner_id);
    CREATE INDEX IF NOT EXISTS members_user ON file_members(user_id);
  `);
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

// ── Files ────────────────────────────────────────────────────────────────

export function createFile(id: string, name: string, ownerId: string): void {
  const now = Date.now();
  const database = db();
  database.prepare('INSERT INTO files (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, ownerId, now, now);
  database.prepare('INSERT INTO file_members (file_id, user_id, role) VALUES (?, ?, ?)')
    .run(id, ownerId, 'owner');
}

/** Files the user owns or has been invited to, most recently touched first. */
export function listFiles(userId: string): FileRow[] {
  return db()
    .prepare(
      `SELECT f.id, f.name, f.owner_id, f.created_at, f.updated_at, m.role, u.name AS owner_name
         FROM files f
         JOIN file_members m ON m.file_id = f.id AND m.user_id = ?
         JOIN users u ON u.id = f.owner_id
        ORDER BY f.updated_at DESC`,
    )
    .all(userId) as unknown as FileRow[];
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
      `SELECT f.id, f.name, f.owner_id, f.created_at, f.updated_at, m.role, u.name AS owner_name
         FROM files f
         JOIN file_members m ON m.file_id = f.id AND m.user_id = ?
         JOIN users u ON u.id = f.owner_id
        WHERE f.id = ?`,
    )
    .get(userId, fileId) as unknown as FileRow | undefined;
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

export function shareFile(fileId: string, ownerId: string, email: string): string | null {
  const file = db().prepare('SELECT id FROM files WHERE id = ? AND owner_id = ?').get(fileId, ownerId);
  if (!file) return 'You can only share files you own.';
  const invitee = findUserByEmail(email);
  if (!invitee) return 'No account with that email yet.';
  if (invitee.id === ownerId) return 'You already own this file.';
  db().prepare('INSERT OR REPLACE INTO file_members (file_id, user_id, role) VALUES (?, ?, ?)')
    .run(fileId, invitee.id, 'editor');
  return null;
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
