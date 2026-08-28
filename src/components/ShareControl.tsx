'use client';

import { useActionState, useState } from 'react';
import { shareFileAction } from '../server/actions';

export function ShareControl({ fileId }: { fileId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(shareFileAction, undefined);

  if (!open) {
    return (
      <button type="button" className="btn btn-raised" onClick={() => setOpen(true)}>
        Share
      </button>
    );
  }

  return (
    <form action={action} style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
      <input type="hidden" name="id" value={fileId} />
      <input
        name="email"
        type="email"
        required
        autoFocus
        placeholder="teammate@email.com"
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        style={{
          flex: 1,
          minWidth: 0,
          height: 24,
          padding: '0 8px',
          border: 0,
          borderRadius: 5,
          background: 'var(--color-control)',
          boxShadow: 'var(--shadow-control)',
          outline: 'none',
        }}
      />
      <select
        name="role"
        defaultValue="editor"
        title="What this person may do"
        style={{
          height: 24,
          border: 0,
          borderRadius: 5,
          padding: '0 4px',
          background: 'var(--color-control)',
          boxShadow: 'var(--shadow-control)',
          outline: 'none',
        }}
      >
        <option value="editor">can edit</option>
        <option value="viewer">can view</option>
      </select>
      <button type="submit" className="btn btn-raised" disabled={pending}>
        {pending ? '…' : 'Invite'}
      </button>
      {state?.error && (
        <span role="alert" style={{ color: '#C0392B', alignSelf: 'center' }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
