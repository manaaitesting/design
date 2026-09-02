'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  canEdit,
  currentUser,
  endSession,
  guestIdentity,
  hashPassword,
  issueSyncToken,
  roleOf,
  startSession,
  verifyPassword,
} from './auth';
import fs from 'node:fs';
import path from 'node:path';
import { openRoom } from './queries';
import {
  createFile,
  createUser,
  deleteFile,
  duplicateFile,
  findUserByEmail,
  getFileByLink,
  getFileFor,
  getLibraryComponent,
  listLibrary,
  listMembers,
  publishComponent,
  renameFile,
  restoreFile,
  setStarred,
  setThumbnail,
  createFolder,
  deleteFolder,
  moveFileToFolder,
  renameFolder,
  setLinkRole,
  shareFile,
  SNAPSHOT_DIR,
  trashFile,
  unpublishComponent,
} from './db';
import { newId } from '../lib/id';
import { safeNext } from '../lib/next';

const COLORS = ['#BDEE63', '#5B8DEF', '#F2637F', '#F5A623', '#9B7BF0', '#27C4A6', '#EF6C3E', '#4CC3F0'];
const ADJECTIVES = ['Refined', 'Quiet', 'Amber', 'Northern', 'Folded', 'Bright', 'Soft', 'Open'];
const NOUNS = ['mountain', 'harbour', 'meridian', 'signal', 'orchard', 'lantern', 'current', 'atlas'];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export type FormState = { error?: string } | undefined;

// ── Accounts ─────────────────────────────────────────────────────────────

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const name = String(form.get('name') ?? '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (!name) return { error: 'Enter your name.' };
  if (findUserByEmail(email)) return { error: 'That email already has an account.' };

  const id = newId();
  createUser({ id, email, name, color: pick(COLORS), passwordHash: hashPassword(password) });
  await startSession(id);
  // the file link that sent them here, if there was one — see `safeNext`
  redirect(safeNext(form.get('next')) ?? '/files');
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');

  const user = findUserByEmail(email);
  // same message either way, so this can't be used to enumerate accounts
  if (!user || !verifyPassword(password, user.password_hash)) {
    return { error: 'Email or password is incorrect.' };
  }
  await startSession(user.id);
  redirect(safeNext(form.get('next')) ?? '/files');
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect('/signin');
}

// ── Files ────────────────────────────────────────────────────────────────

export async function newFile(): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  const id = newId();
  createFile(id, `${pick(ADJECTIVES)} ${pick(NOUNS)}`, user.id);
  redirect(`/f/${id}`);
}

export async function renameFileAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  const id = String(form.get('id') ?? '');
  const name = String(form.get('name') ?? '').trim();
  if (id && name) renameFile(id, user.id, name);
  revalidatePath('/files');
}

/** Deletes for good. Only the Trash view offers this; the file menu goes through `trashFileAction`. */
export async function deleteFileAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  deleteFile(String(form.get('id') ?? ''), user.id);
  revalidatePath('/files');
}

export async function trashFileAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  trashFile(String(form.get('id') ?? ''), user.id);
  revalidatePath('/files');
}

export async function restoreFileAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  restoreFile(String(form.get('id') ?? ''), user.id);
  revalidatePath('/files');
}

/** Copies a file — content, name and thumbnail — into a new one you own. */
export async function duplicateFileAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  duplicateFile(String(form.get('id') ?? ''), user.id, newId());
  revalidatePath('/files');
}

/**
 * The file menu's Duplicate: the same copy, but the caller gets the new id so
 * it can open the copy rather than send you back to the dashboard for it.
 */
export async function duplicateAndOpenAction(fileId: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return null;
  const id = duplicateFile(fileId, user.id, newId());
  revalidatePath('/files');
  return id;
}

/** "Add to sidebar" / "Remove from sidebar" in the file menu. */
export async function setStarredAction(fileId: string, on: boolean): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  setStarred(fileId, user.id, on);
  revalidatePath('/files');
}

// ── Version history ──────────────────────────────────────────────────────
//
// The sync server keeps a rolling set of document snapshots on disk — one a
// minute while a file is being edited, plus the state before any wipe. That is
// already a version history; these actions are how the editor reads it, and
// how a person adds a named entry of their own.

export interface FileVersion {
  /** the on-disk stamp, which is also the handle for reading it back */
  stamp: string;
  /** when it was written, in ms */
  at: number;
  /** a name the person who saved it gave it, or null for an automatic one */
  name: string | null;
  /** an automatic snapshot the server pinned because the next save wiped the document */
  kept: boolean;
  bytes: number;
}

/** A snapshot file's stamp is an ISO time with the punctuation made path-safe. */
function stampToTime(stamp: string): number {
  const iso = stamp.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d\d\d)Z$/, 'T$1:$2:$3.$4Z');
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : time;
}

/** The suffix a named snapshot carries after its stamp. */
const NAMED = '__named__';

/** Anyone who can open the file may look at its history; a link visitor included. */
async function canSeeFile(fileId: string): Promise<boolean> {
  const user = await currentUser();
  const file = user ? getFileFor(fileId, user.id) : undefined;
  return Boolean(file ?? getFileByLink(fileId));
}

export async function listVersionsAction(fileId: string): Promise<FileVersion[]> {
  if (!fileId || !(await canSeeFile(fileId))) return [];
  const prefix = `${encodeURIComponent(fileId)}__`;
  let names: string[];
  try {
    names = fs.readdirSync(SNAPSHOT_DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.bin'));
  } catch {
    return [];
  }
  const versions: FileVersion[] = [];
  for (const file of names) {
    const rest = file.slice(prefix.length, -4);
    const named = rest.indexOf(NAMED);
    const kept = rest.endsWith('__keep');
    const stamp = named >= 0 ? rest.slice(0, named) : kept ? rest.slice(0, -'__keep'.length) : rest;
    let bytes = 0;
    try {
      bytes = fs.statSync(path.join(SNAPSHOT_DIR, file)).size;
    } catch {
      continue;
    }
    versions.push({
      stamp,
      at: stampToTime(stamp),
      name: named >= 0 ? decodeURIComponent(rest.slice(named + NAMED.length)) : null,
      kept,
      bytes,
    });
  }
  return versions.sort((a, b) => b.at - a.at);
}

/** The snapshot's bytes, base64-encoded — the client turns them into a document. */
export async function readVersionAction(fileId: string, stamp: string): Promise<string | null> {
  if (!fileId || !stamp || !(await canSeeFile(fileId))) return null;
  // the stamp is a path segment written by us; anything else is not one
  if (!/^[0-9TZ-]+$/.test(stamp)) return null;
  const prefix = `${encodeURIComponent(fileId)}__${stamp}`;
  try {
    const match = fs
      .readdirSync(SNAPSHOT_DIR)
      .find((f) => f.startsWith(prefix) && f.endsWith('.bin') && f.slice(prefix.length).match(/^(__keep|__named__.*)?\.bin$/));
    if (!match) return null;
    return fs.readFileSync(path.join(SNAPSHOT_DIR, match)).toString('base64');
  } catch {
    return null;
  }
}

/**
 * A named version, written by the person editing rather than the timer.
 *
 * The Next.js process holds no live document — the sync server does — so the
 * client sends the encoded state it already has. Named snapshots carry their
 * name in the filename and are never rotated: the point of naming one is that
 * it is still there next month.
 */
export async function saveVersionAction(fileId: string, name: string, base64: string): Promise<FileVersion | null> {
  const user = await currentUser();
  if (!user) return null;
  const file = getFileFor(fileId, user.id);
  if (!file || !canEdit(roleOf(file.role))) return null;
  const label = name.trim().slice(0, 80);
  if (!label || !base64 || base64.length > 40_000_000) return null;
  const bytes = Buffer.from(base64, 'base64');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SNAPSHOT_DIR, `${encodeURIComponent(fileId)}__${stamp}${NAMED}${encodeURIComponent(label)}.bin`),
      bytes,
    );
  } catch {
    return null;
  }
  return { stamp, at: stampToTime(stamp), name: label, kept: false, bytes: bytes.length };
}

/**
 * A picture of the file, captured by the editor.
 *
 * Capped hard: a thumbnail is a thumbnail, and a database row is not where a
 * full-size render belongs.
 */
export async function setThumbnailAction(fileId: string, dataUrl: string): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  if (!dataUrl.startsWith('data:image/') || dataUrl.length > 400_000) return;
  setThumbnail(fileId, user.id, dataUrl);
}

export async function shareFileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  const role = String(form.get('role') ?? 'editor') === 'viewer' ? 'viewer' : 'editor';
  const error = shareFile(
    String(form.get('id') ?? ''),
    user.id,
    String(form.get('email') ?? '').trim(),
    role,
  );
  revalidatePath('/files');
  return error ? { error } : { error: undefined };
}

/**
 * Turns the public link on or off.
 *
 * `''` is off rather than a third role, because the select that drives this is
 * one control with three states and the empty option is the honest spelling of
 * "nobody".
 */
export async function setLinkRoleAction(fileId: string, role: '' | 'editor' | 'viewer'): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  setLinkRole(fileId, user.id, role === '' ? null : role);
  revalidatePath('/files');
}

/**
 * A fresh handshake token for a room you are still allowed into.
 *
 * The one baked into the page at render time lives an hour, which is shorter
 * than a working afternoon, so the session asks for another when the sync
 * server refuses the old one. `null` is the honest answer to "your access has
 * gone" — the session stops there rather than retrying against a door that is
 * now shut.
 */
export async function refreshSyncTokenAction(room: string): Promise<string | null> {
  const user = await currentUser();
  const access = openRoom(room, user?.id ?? null);
  if (!access.ok) return null;
  const identity = user ?? (await guestIdentity());
  return issueSyncToken(identity.id, room, access.role);
}

// ── Folders ──────────────────────────────────────────────────────────────
//
// A folder is a way of looking at your own file list, so every one of these is
// scoped to the signed-in user in the query itself rather than checked here.

export async function newFolderAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  const name = String(form.get('name') ?? '').trim();
  if (name) createFolder(newId(), name.slice(0, 60), user.id);
  revalidatePath('/files');
}

export async function renameFolderAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  const id = String(form.get('id') ?? '');
  const name = String(form.get('name') ?? '').trim();
  if (id && name) renameFolder(id, user.id, name.slice(0, 60));
  revalidatePath('/files');
}

export async function deleteFolderAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  const id = String(form.get('id') ?? '');
  if (id) deleteFolder(id, user.id);
  revalidatePath('/files');
  // the folder being looked at has just stopped existing
  redirect('/files');
}

export async function moveFileAction(fileId: string, folderId: string): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  moveFileToFolder(fileId, user.id, folderId || null);
  revalidatePath('/files');
}

/**
 * Who is in this file, for the comment composer's @-picker.
 *
 * Presence only knows who is here *now*, and a mention is most often for
 * someone who is not — so the picker needs the membership, not the room.
 */
export async function listMembersAction(
  fileId: string,
): Promise<{ id: string; name: string; color: string }[]> {
  const user = await currentUser();
  if (!user) return [];
  if (!getFileFor(fileId, user.id)) return [];
  return listMembers(fileId).map((member) => ({
    id: member.id,
    name: member.name,
    color: member.color,
  }));
}

// ── The shared library ───────────────────────────────────────────────────
//
// Publishing a component makes it available to every file its author can see.
// The payload is the same one the clipboard carries, so importing is a paste —
// no second serialisation format, and nothing to keep in step.

export interface LibraryEntry {
  id: string;
  name: string;
  version: number;
  fileId: string;
  fileName: string;
  updatedAt: number;
}

export async function publishComponentAction(
  fileId: string,
  nodeId: string,
  name: string,
  payload: string,
): Promise<{ id?: string; version?: number; error?: string }> {
  const user = await currentUser();
  if (!user) return { error: 'Sign in first.' };
  const file = getFileFor(fileId, user.id);
  if (!file) return { error: 'You do not have access to that file.' };
  if (!canEdit(roleOf(file.role))) return { error: 'You have view-only access to this file.' };
  if (payload.length > 2_000_000) return { error: 'That component is too large to publish.' };

  return publishComponent(fileId, nodeId, name, payload);
}

export async function unpublishComponentAction(fileId: string, nodeId: string): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  const file = getFileFor(fileId, user.id);
  if (!file || !canEdit(roleOf(file.role))) return;
  unpublishComponent(fileId, nodeId);
}

export async function listLibraryAction(): Promise<LibraryEntry[]> {
  const user = await currentUser();
  if (!user) return [];
  return listLibrary(user.id).map((entry) => ({
    id: entry.id,
    name: entry.name,
    version: entry.version,
    fileId: entry.file_id,
    fileName: entry.file_name,
    updatedAt: entry.updated_at,
  }));
}

/** The payload for one library component, checked against membership. */
export async function fetchLibraryComponentAction(
  id: string,
): Promise<{ payload?: string; version?: number; name?: string; error?: string }> {
  const user = await currentUser();
  if (!user) return { error: 'Sign in first.' };
  const entry = getLibraryComponent(id);
  if (!entry) return { error: 'That component is no longer published.' };
  if (!getFileFor(entry.file_id, user.id)) return { error: 'You do not have access to it.' };
  return { payload: entry.payload, version: entry.version, name: entry.name };
}
