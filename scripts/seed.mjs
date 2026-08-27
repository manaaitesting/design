/**
 * Creates two demo accounts and a file shared between them, so multiplayer can
 * be exercised without inventing accounts by hand.
 *
 * Development convenience only — never run this against a real deployment.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEV_PASSWORD = 'paperlike-demo';
const DATA_DIR = path.resolve(process.cwd(), '.data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'paperlike.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    color TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS file_members (
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL, PRIMARY KEY (file_id, user_id));
`);

function hash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const people = [
  { id: 'demoada00', email: 'ada@example.com', name: 'Ada', color: '#BDEE63' },
  { id: 'demogrc00', email: 'grace@example.com', name: 'Grace', color: '#9B7BF0' },
];

const now = Date.now();
for (const person of people) {
  db.prepare(
    `INSERT INTO users (id, email, name, color, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, color = excluded.color`,
  ).run(person.id, person.email, person.name, person.color, hash(DEV_PASSWORD), now);
}

const fileId = 'demofile0';
db.prepare(
  `INSERT INTO files (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
).run(fileId, 'Vinyl Sundays', people[0].id, now, now);

for (const [index, person] of people.entries()) {
  db.prepare('INSERT OR REPLACE INTO file_members (file_id, user_id, role) VALUES (?, ?, ?)')
    .run(fileId, person.id, index === 0 ? 'owner' : 'editor');
}

// A scratch file for the Playwright suite. The tests rebuild it from scratch
// and delete as they go, so they must never run against the demo document.
const testFileId = 'testfile00';
db.prepare(
  `INSERT INTO files (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
).run(testFileId, 'Playwright Scratch', people[0].id, now, now);
for (const person of people) {
  db.prepare('INSERT OR REPLACE INTO file_members (file_id, user_id, role) VALUES (?, ?, ?)')
    .run(testFileId, person.id, 'editor');
}

console.log('Seeded demo accounts — password for both is:', DEV_PASSWORD);
for (const person of people) console.log(`  ${person.email}  (${person.name})`);
console.log(`Shared file: /f/${fileId}`);
console.log(`Test scratch file: /f/${testFileId}`);
