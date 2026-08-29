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

const GUEST_COOKIE = 'paperlike_guest';

/** Names for the people who arrive by link, so a cursor is not "Anonymous". */
const GUEST_NAMES = ['Visitor', 'Guest', 'Passer-by', 'Onlooker', 'Newcomer', 'Reader'];
const GUEST_COLORS = ['#BDEE63', '#4CC3F0', '#9B7BF0', '#F2637F', '#FFC53D', '#5BC8A0'];

/**
 * Who a link visitor is, for as long as their browser remembers.
 *
 * This is an identity, not an authorisation: it decides the name and colour on
 * a cursor and nothing else. What lets them into the room is the sync token,
 * which the server signs only after checking the file's `link_role` — so a
 * forged guest cookie buys a different avatar and no access at all.
 *
 * Read-only, deliberately. The cookie is minted in `proxy.ts`, because a server
 * component may read cookies but not set them; the fallback here is for the
 * request the proxy did not run on, and it is content to be ephemeral.
 */
export async function guestIdentity(): Promise<User> {
  const existing = (await cookies()).get(GUEST_COOKIE)?.value;
  const id = /^guest-[a-z0-9]{8,}$/.test(existing ?? '')
    ? existing!
    : `guest-${randomBytes(6).toString('hex')}`;
  // stable per id, so the same visitor keeps the same colour across files
  const seed = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    id,
    email: '',
    name: GUEST_NAMES[seed % GUEST_NAMES.length],
    color: GUEST_COLORS[seed % GUEST_COLORS.length],
  };
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
