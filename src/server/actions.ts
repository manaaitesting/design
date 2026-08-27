'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { currentUser, endSession, hashPassword, startSession, verifyPassword } from './auth';
import {
  createFile,
  createUser,
  deleteFile,
  findUserByEmail,
  renameFile,
  shareFile,
} from './db';
import { newId } from '../lib/id';

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

export async function shareFileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect('/signin');
  const error = shareFile(String(form.get('id') ?? ''), user.id, String(form.get('email') ?? '').trim());
  revalidatePath('/files');
  return error ? { error } : { error: undefined };
}
