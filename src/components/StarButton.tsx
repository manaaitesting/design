'use client';

import { useTransition } from 'react';
import { setStarredAction } from '../server/actions';
import { Icon } from './ui/Icons';

export function StarButton({ fileId, starred }: { fileId: string; starred?: number }) {
  const [pending, start] = useTransition();
  const isStarred = Boolean(starred);
  return (
    <button
      type="button"
      aria-label={isStarred ? 'Remove from favorites' : 'Add to Starred'}
      aria-pressed={isStarred}
      data-testid="favorite-star-button"
      title={isStarred ? 'Remove from favorites' : 'Add to sidebar'}
      className="star-btn"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start(() => setStarredAction(fileId, !isStarred));
      }}
      style={{
        width: 24,
        height: 24,
        display: 'grid',
        placeItems: 'center',
        border: 0,
        borderRadius: 6,
        background: 'transparent',
        color: isStarred ? '#eab308' : 'rgba(0,0,0,0.32)',
        flex: 'none',
        cursor: 'default',
        position: 'relative',
        zIndex: 2,
        opacity: isStarred ? 1 : undefined,
      }}
    >
      <Icon.Star filled={isStarred} />
    </button>
  );
}
