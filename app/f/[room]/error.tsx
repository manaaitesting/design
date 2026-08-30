'use client';

import { ErrorCard } from '../../../src/components/ErrorCard';

/**
 * A throw anywhere in the editor's tree used to unmount it to a white screen.
 * The document itself is on the server, so nothing said here is lost — which
 * is worth saying, because a canvas that vanishes reads as work that vanished.
 */
export default function EditorError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorCard
      title="The editor stopped"
      action={
        <button type="button" className="btn btn-raised" onClick={reset}>
          Reload the file
        </button>
      }
    >
      Something in this file could not be drawn. The document is kept on the server, so reloading
      picks it up where it was.
    </ErrorCard>
  );
}
