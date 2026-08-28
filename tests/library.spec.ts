import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The shared library.
 *
 * This one runs without a browser, against a scratch database: publishing is a
 * row, and the behaviour worth pinning is what happens on the *second* publish
 * — a new revision of the same component rather than a second component, which
 * is the difference between an update being offered and a duplicate appearing.
 */

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlike-lib-'));
process.env.DATA_DIR = scratch;

// imported after DATA_DIR is set, so the database lands in the scratch dir
const db = await import('../src/server/db');

test.beforeAll(() => {
  db.createUser({
    id: 'u1',
    email: 'lib@example.com',
    name: 'Lib',
    color: '#000000',
    passwordHash: 'x:y',
  });
  db.createUser({
    id: 'u2',
    email: 'other@example.com',
    name: 'Other',
    color: '#111111',
    passwordHash: 'x:y',
  });
  db.createFile('fileA', 'Design system', 'u1');
  db.createFile('fileB', 'Product', 'u1');
  db.createFile('fileC', 'Someone else', 'u2');
});

test.afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('publishing twice is a new revision, not a second component', () => {
  const first = db.publishComponent('fileA', 'node1', 'Button', '{"paperlike":1,"nodes":[]}');
  expect(first.version).toBe(1);

  const second = db.publishComponent('fileA', 'node1', 'Button', '{"paperlike":1,"nodes":[1]}');
  expect(second.id).toBe(first.id);
  expect(second.version).toBe(2);

  const library = db.listLibrary('u1');
  expect(library.filter((entry) => entry.node_id === 'node1')).toHaveLength(1);
  expect(library[0].version).toBe(2);
  // the payload is the one just published, not the one it replaced
  expect(db.getLibraryComponent(first.id)?.payload).toContain('[1]');
});

test('the library only shows what you have access to', () => {
  db.publishComponent('fileC', 'node9', 'Not yours', '{"paperlike":1,"nodes":[]}');
  expect(db.listLibrary('u1').some((entry) => entry.name === 'Not yours')).toBe(false);
  expect(db.listLibrary('u2').some((entry) => entry.name === 'Not yours')).toBe(true);
});

test('a component says which file it came from', () => {
  db.publishComponent('fileA', 'node2', 'Card', '{"paperlike":1,"nodes":[]}');
  const entry = db.listLibrary('u1').find((row) => row.name === 'Card');
  expect(entry?.file_name).toBe('Design system');
});

test('unpublishing takes it off the shelf', () => {
  db.publishComponent('fileB', 'node3', 'Chip', '{"paperlike":1,"nodes":[]}');
  expect(db.listLibrary('u1').some((entry) => entry.name === 'Chip')).toBe(true);
  db.unpublishComponent('fileB', 'node3');
  expect(db.listLibrary('u1').some((entry) => entry.name === 'Chip')).toBe(false);
});
