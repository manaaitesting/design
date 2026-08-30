'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * A submit button that admits it is working.
 *
 * Every button on the file browser posts to a server action and waits out a
 * round trip; New file waits out a database write *and* a navigation into the
 * editor. A button that stays in its resting state through all that reads as a
 * button that did not take the click, and the second click makes a second file.
 *
 * `useFormStatus` reports on the form this sits inside, so one of these going
 * grey never greys the rest of the page.
 */
export function SubmitButton({
  children,
  pendingLabel = 'Working…',
  className = 'btn',
  title,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      title={title}
      disabled={pending}
      style={{ opacity: pending ? 0.6 : 1 }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
