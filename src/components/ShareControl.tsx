'use client';

import { useActionState, useState, useTransition } from 'react';
import { setLinkRoleAction, shareFileAction } from '../server/actions';

const FIELD: React.CSSProperties = {
  height: 24,
  border: 0,
  borderRadius: 5,
  padding: '0 6px',
  background: 'var(--color-control)',
  boxShadow: 'var(--shadow-control)',
  outline: 'none',
};

/**
 * Sharing, both ways round.
 *
 * Inviting by email is the strong form — it names a person and survives the
 * link being passed on. But it cannot reach someone who has no account yet,
 * which is most of the people a design needs to be seen by, so the link is the
 * other half: one switch saying what anyone holding it may do, and the link
 * itself to hand over.
 */
export function ShareControl({
  fileId,
  linkRole = null,
}: {
  fileId: string;
  /** what anyone with the link may do — null is "it is private" */
  linkRole?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(shareFileAction, undefined);
  const [saving, startSaving] = useTransition();
  const [copied, setCopied] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-raised" onClick={() => setOpen(true)}>
        Share
        {/* the dot is the only thing on the card that says a file is reachable
            by anyone with the link, so it is worth the four pixels */}
        {linkRole && (
          <span
            aria-label="Anyone with the link can open this"
            title="Anyone with the link can open this"
            style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--color-select)' }}
          />
        )}
      </button>
    );
  }

  const copyLink = async () => {
    await navigator.clipboard?.writeText(`${window.location.origin}/f/${fileId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
      <form action={action} style={{ display: 'flex', gap: 6, minWidth: 0 }}>
        <input type="hidden" name="id" value={fileId} />
        <input
          name="email"
          type="email"
          required
          autoFocus
          placeholder="teammate@email.com"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          style={{ ...FIELD, flex: 1, minWidth: 0, padding: '0 8px' }}
        />
        <select name="role" defaultValue="editor" title="What this person may do" style={FIELD}>
          <option value="editor">can edit</option>
          <option value="viewer">can view</option>
        </select>
        <button type="submit" className="btn btn-raised" disabled={pending}>
          {pending ? '…' : 'Invite'}
        </button>
      </form>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
        <select
          aria-label="Who can open the link"
          value={linkRole ?? ''}
          disabled={saving}
          onChange={(event) => {
            const next = event.target.value as '' | 'editor' | 'viewer';
            startSaving(() => setLinkRoleAction(fileId, next));
          }}
          style={{ ...FIELD, flex: 1, minWidth: 0 }}
        >
          <option value="">Only invited people</option>
          <option value="viewer">Anyone with the link can view</option>
          <option value="editor">Anyone with the link can edit</option>
        </select>
        <button type="button" className="btn" onClick={copyLink} title="Copy the file's link">
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      {state?.error && (
        <span role="alert" style={{ color: '#C0392B' }}>
          {state.error}
        </span>
      )}
    </div>
  );
}
