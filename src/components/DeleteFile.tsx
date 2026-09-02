'use client';

import { useState } from 'react';
import { deleteFileAction } from '../server/actions';
import { SubmitButton } from './SubmitButton';

/**
 * Delete, asked twice.
 *
 * The action behind this is a hard row delete plus an unlink of the document's
 * snapshot on disk: the file, everyone else's access to it, and the version
 * history the editor reads, all gone. There is no trash to fish any of it back
 * out of, and the button sits flush against Duplicate — so the second click is
 * the only thing between a mis-aimed cursor and something nobody can recover.
 */
export function DeleteFile({ fileId, fileName }: { fileId: string; fileName: string }) {
  const [asked, setAsked] = useState(false);

  if (!asked) {
    return (
      <button type="button" className="btn" title="Delete file" onClick={() => setAsked(true)}>
        Delete
      </button>
    );
  }

  return (
    <form
      action={deleteFileAction}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}
    >
      <input type="hidden" name="id" value={fileId} />
      <span style={{ color: 'var(--color-ink-muted)', lineHeight: 1.45 }}>
        Delete “{fileName}”? It goes for everyone it is shared with, and there is no trash.
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <SubmitButton pendingLabel="Deleting…">Delete file</SubmitButton>
        <button type="button" className="btn" onClick={() => setAsked(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
