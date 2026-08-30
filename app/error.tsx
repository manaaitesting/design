'use client';

import { ErrorCard } from '../src/components/ErrorCard';

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorCard
      title="Something went wrong"
      action={
        <button type="button" className="btn btn-raised" onClick={reset}>
          Try again
        </button>
      }
    >
      That page could not be loaded. Trying again often works; if it does not, your files are all
      still where you left them.
    </ErrorCard>
  );
}
