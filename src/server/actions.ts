'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  canEdit,
  currentUser,
  endSession,
  hashPassword,
  roleOf,
  startSession,
  verifyPassword,
} from './auth';
import {
  createFile,
  createUser,
  deleteFile,
  duplicateFile,
  findUserByEmail,
  getFileFor,
  getLibraryComponent,
  listLibrary,
  publishComponent,
  renameFile,
  setThumbnail,
  shareFile,
  unpublishComponent,
} from './db';
import { newId } from '../lib/id';
import {
  compareVersion,
  listVersions,
  restoreVersion,
  type Version,
  type VersionDiff,
} from './history';

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
  redirect('/files');
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
  redirect('/files');
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

export async function deleteFileAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  deleteFile(String(form.get('id') ?? ''), user.id);
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

// ── Version history ──────────────────────────────────────────────────────
//
// The sync server keeps snapshots on disk; these put them behind the editor.
// Both check membership first — a room id is not authorisation.

export async function listVersionsAction(fileId: string): Promise<Version[]> {
  const user = await currentUser();
  if (!user) return [];
  if (!getFileFor(fileId, user.id)) return [];
  return listVersions(fileId);
}

export async function compareVersionAction(
  fileId: string,
  stamp: string,
): Promise<VersionDiff | null> {
  const user = await currentUser();
  if (!user) return null;
  if (!getFileFor(fileId, user.id)) return null;
  return compareVersion(fileId, stamp);
}

export async function restoreVersionAction(
  fileId: string,
  stamp: string,
): Promise<{ restored?: number; error?: string }> {
  const user = await currentUser();
  if (!user) return { error: 'Sign in first.' };
  const file = getFileFor(fileId, user.id);
  if (!file) return { error: 'You do not have access to that file.' };
  // restoring writes to the document, so it is an editor's move
  if (!canEdit(roleOf(file.role))) return { error: 'You have view-only access to this file.' };

  try {
    return { restored: await restoreVersion(fileId, stamp) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not restore that version.' };
  }
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
