import 'server-only';

import { canEdit, roleOf, type Role } from './auth';
import {
  getFileByLink,
  getFileFor,
  listFiles,
  listFolders,
  listMembers,
  touchFile,
  type FileQuery,
  type FileRow,
  type Folder,
  type User,
} from './db';

/**
 * What each page needs, answered in one call.
 *
 * The route components used to reach into `db.ts` and assemble this themselves,
 * which put real decisions — which of three ways into a file wins, and what a
 * failure means — inside a React component, where nothing can test them without
 * a browser. This is the seam between the two: routes ask a page-shaped
 * question, and the answer is a plain object they render.
 *
 * `db.ts` still owns every statement. Nothing here writes SQL; it composes.
 */

// ── The file browser ─────────────────────────────────────────────────────

export interface FilesPage {
  folders: (Folder & { count: number })[];
  files: (FileRow & { members: User[] })[];
  /** how many files the account has in total, ignoring the current filter */
  total: number;
  /**
   * Folders as plain objects. Rows come back from node:sqlite with a null
   * prototype and a client component may only be handed plain ones, so the
   * picker gets a copy rather than the query result.
   */
  folderOptions: { id: string; name: string }[];
  current?: Folder & { count: number };
  /** how many files are pinned to the sidebar, and how many sit in the trash */
  starred: number;
  trashed: number;
}

export function filesPage(userId: string, query: FileQuery): FilesPage {
  const folders = listFolders(userId);
  return {
    folders,
    // the avatars on a card are part of the card, so they are fetched with it
    files: listFiles(userId, query).map((file) => ({ ...file, members: listMembers(file.id) })),
    total: listFiles(userId).length,
    folderOptions: folders.map((entry) => ({ id: entry.id, name: entry.name })),
    current: folders.find((entry) => entry.id === query.folder),
    starred: listFiles(userId, { starred: true }).length,
    trashed: listFiles(userId, { trash: true }).length,
  };
}

// ── Opening a file ───────────────────────────────────────────────────────

export type RoomAccess =
  | {
      ok: true;
      file: FileRow;
      role: Role;
      tabs: { id: string; name: string; owned: boolean }[];
      /** the viewer's own folders, for the file menu's "Move file…" — empty for a guest */
      folders: { id: string; name: string }[];
    }
  /** no way in, but signing in might make one */
  | { ok: false; reason: 'sign-in' }
  /** no way in, and no account would change that */
  | { ok: false; reason: 'not-found' };

/**
 * The three ways into a file, in order of authority.
 *
 * A membership row is the strongest claim and wins even over a more generous
 * link — an editor invited by email is not demoted because the link is
 * view-only. Failing that, the file's `link_role` lets anyone through, signed
 * in or not. If neither applies the file is invisible, and the caller is told
 * `not-found` rather than `forbidden`: knowing a room id should not confirm
 * that the room exists.
 *
 * Recording the visit belongs here rather than in the route, because it is part
 * of the same decision — a viewer never writes, so their visit does not count
 * as activity either.
 */
export function openRoom(room: string, userId: string | null): RoomAccess {
  const member = userId ? getFileFor(room, userId) : undefined;
  const file = member ?? getFileByLink(room);
  if (!file) return { ok: false, reason: userId ? 'not-found' : 'sign-in' };

  const role = roleOf(file.role);
  if (canEdit(role)) touchFile(room);

  // The tab strip names files the browser only knows by id, and a file that has
  // left this list has left your account — its tab goes with it. A link visitor
  // has no file browser to tab between, so they get the canvas and nothing else.
  const tabs = userId
    ? listFiles(userId).map((row) => ({
        id: row.id,
        name: row.name,
        owned: row.owner_id === userId,
      }))
    : [];
  const folders = userId ? listFolders(userId).map((row) => ({ id: row.id, name: row.name })) : [];

  return { ok: true, file, role, tabs, folders };
}
