export interface Identity {
  id: string;
  name: string;
  color: string;
}

/**
 * Presence identity.
 *
 * This now comes from the signed-in account — the server passes it into
 * `SessionProvider`, and everything downstream (cursors, avatars, selection
 * halos) reads it. Nothing in the editor mints identities any more.
 */

export function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
