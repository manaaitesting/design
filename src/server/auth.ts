import 'server-only';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { findUserById, type User } from './db';

const COOKIE = 'paperlike_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) {
    throw new Error('AUTH_SECRET is not set — copy .env.example to .env.local and fill it in.');
  }
  return value;
}

// ── Passwords ────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const derived = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  // constant-time to keep the comparison from leaking the hash
  return derived.length === expectedBuffer.length && timingSafeEqual(derived, expectedBuffer);
}

// ── Session cookie ───────────────────────────────────────────────────────

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function seal(userId: string): string {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

function unseal(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expires, signature] = parts;
  const expected = sign(`${userId}.${expires}`);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  if (Number(expires) < Date.now()) return null;
  return userId;
}

export async function startSession(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, seal(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user, or null. Safe to call from any server component. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const userId = unseal(token);
  return userId ? (findUserById(userId) ?? null) : null;
}

// ── Sync-server handshake ────────────────────────────────────────────────

/** What a member may do with a file. Anything unrecognised is read-only. */
export type Role = 'owner' | 'editor' | 'viewer';

export function roleOf(stored: string | undefined): Role {
  return stored === 'owner' || stored === 'editor' ? stored : 'viewer';
}

export function canEdit(role: Role): boolean {
  return role === 'owner' || role === 'editor';
}

/**
 * Short-lived proof that this user may open this file, and in what capacity.
 *
 * The sync server is a separate process with no access to cookies or the
 * database, so it verifies this HMAC instead. Without it, knowing a room id
 * would be enough to join any document — and without the role inside the
 * signature, a viewer could simply ask the socket to accept their edits.
 */
export function issueSyncToken(
  userId: string,
  fileId: string,
  role: Role,
  ttlMs = 60 * 60 * 1000,
): string {
  const expires = Date.now() + ttlMs;
  const payload = `${userId}.${fileId}.${role}.${expires}`;
  return `${payload}.${sign(payload)}`;
}
