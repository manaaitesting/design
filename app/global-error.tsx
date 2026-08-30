'use client';

import './globals.css';
import { ErrorCard } from '../src/components/ErrorCard';

/**
 * The layout itself failed, so this replaces it — html and body included, and
 * the stylesheet with them, since nothing above this point is left to load it.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <ErrorCard
          title="Paperlike could not start"
          action={
            <button type="button" className="btn btn-raised" onClick={reset}>
              Try again
            </button>
          }
        >
          Something failed before the app could draw anything. Reloading is worth a try.
        </ErrorCard>
      </body>
    </html>
  );
}
