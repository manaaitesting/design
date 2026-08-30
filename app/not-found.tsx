import { ErrorCard } from '../src/components/ErrorCard';

/**
 * Where `notFound()` in the file route lands.
 *
 * A signed-in visitor gets this for a deleted file, a mistyped id and a share
 * that was revoked alike — `openRoom` deliberately answers `not-found` rather
 * than `forbidden`, so that knowing a room id cannot confirm the room exists.
 * That decision is what makes this copy matter: the page has to cover "typo"
 * and "you were removed" at once without saying which.
 */
export default function NotFound() {
  return (
    <ErrorCard title="That file is not here">
      It may have been deleted, or its link may have been turned off. If a teammate sent it to you,
      ask them to share it again.
    </ErrorCard>
  );
}
