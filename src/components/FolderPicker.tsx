'use client';

import { useTransition } from 'react';
import { moveFileAction } from '../server/actions';

/**
 * Which folder a file is filed under.
 *
 * A select rather than a drag: the dashboard is a wrapping grid, so a drop
 * target would have to be the folder row above it, which is off-screen the
 * moment you have enough files to want folders at all.
 */
export function FolderPicker({
  fileId,
  folderId,
  folders,
}: {
  fileId: string;
  folderId: string | null | undefined;
  folders: { id: string; name: string }[];
}) {
  const [saving, startSaving] = useTransition();

  return (
    <select
      aria-label="Folder"
      title="Move to folder"
      value={folderId ?? ''}
      disabled={saving}
      onChange={(event) => {
        const next = event.target.value;
        startSaving(() => moveFileAction(fileId, next));
      }}
      className="btn"
      style={{
        maxWidth: 132,
        background: 'var(--color-control)',
        boxShadow: 'var(--shadow-control)',
        outline: 'none',
      }}
    >
      <option value="">No folder</option>
      {folders.map((folder) => (
        <option key={folder.id} value={folder.id}>
          {folder.name}
        </option>
      ))}
    </select>
  );
}
