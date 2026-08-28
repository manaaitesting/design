'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { usePresence, useSession } from './Session';
import { useUI } from '../state/ui';
import { readableOn } from '../lib/color';

/**
 * Following someone, and being followed.
 *
 * Figma's observation mode is two features wearing one coat. *Follow* points
 * your viewport at someone else's and keeps it there. *Spotlight* is the other
 * way round: you say "watch me", and everyone else is pulled along. Both run
 * entirely through awareness — nothing about who is looking where belongs in
 * the document.
 *
 * The viewport is published on a throttle. A pan changes it on every frame, and
 * sixty awareness messages a second would drown the room for a number that only
 * has to be roughly current.
 */

const PUBLISH_MS = 90;

export function FollowLayer({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const { provider } = useSession();
  const presence = usePresence();
  const following = useUI((s) => s.following);
  const setFollowing = useUI((s) => s.setFollowing);
  const spotlight = useUI((s) => s.spotlight);
  const last = useRef(0);

  // ── Publish where we are looking ───────────────────────────────────────
  useEffect(() => {
    const publish = () => {
      const now = Date.now();
      if (now - last.current < PUBLISH_MS) return;
      last.current = now;
      const box = containerRef.current?.getBoundingClientRect();
      const { x, y, zoom } = useUI.getState().viewport;
      provider.awareness.setLocalStateField('view', {
        x,
        y,
        zoom,
        w: box?.width ?? window.innerWidth,
        h: box?.height ?? window.innerHeight,
      });
    };
    publish();
    return useUI.subscribe(publish);
  }, [provider, containerRef]);

  useEffect(() => {
    provider.awareness.setLocalStateField('spotlight', spotlight);
  }, [provider, spotlight]);

  useEffect(() => {
    provider.awareness.setLocalStateField('following', following);
  }, [provider, following]);

  // ── Follow someone ─────────────────────────────────────────────────────
  const leader = presence.find((p) => p.clientId === following);

  useEffect(() => {
    if (!leader?.view) return;
    // two people following each other would chase the difference between their
    // windows back and forth for ever
    if (leader.following === provider.awareness.clientID) return;
    const box = containerRef.current?.getBoundingClientRect();
    const width = box?.width ?? window.innerWidth;
    const height = box?.height ?? window.innerHeight;
    const view = leader.view;

    // Their window is not ours. Matching the *centre* at a zoom that fits what
    // they can see is what keeps both people looking at the same thing rather
    // than at the same coordinates.
    const zoom = view.zoom * Math.min(width / view.w, height / view.h);
    const centre = {
      x: (view.w / 2 - view.x) / view.zoom,
      y: (view.h / 2 - view.y) / view.zoom,
    };
    useUI.getState().setViewport({
      zoom,
      x: width / 2 - centre.x * zoom,
      y: height / 2 - centre.y * zoom,
    });
  }, [leader?.view, containerRef, leader, provider]);

  // someone who leaves takes their follower with them
  useEffect(() => {
    if (following !== null && !leader) setFollowing(null);
  }, [following, leader, setFollowing]);

  // ── Being pulled into someone's spotlight ──────────────────────────────
  const presenter = presence.find((p) => p.spotlight);
  useEffect(() => {
    if (presenter && following !== presenter.clientId) setFollowing(presenter.clientId);
    if (!presenter && following !== null) {
      // only drop the follow if it was the spotlight that started it
      const stillThere = presence.some((p) => p.clientId === following);
      if (!stillThere) setFollowing(null);
    }
  }, [presenter, following, presence, setFollowing]);

  if (!leader && !spotlight) return null;

  return (
    <>
      {leader && (
        <div
          className="fig-follow-ring"
          style={{ boxShadow: `inset 0 0 0 2px ${leader.identity.color}` }}
        />
      )}
      <div className="fig-follow-bar">
        {leader && (
          <>
            <span
              className="fig-follow-dot"
              style={{ background: leader.identity.color, color: readableOn(leader.identity.color) }}
            />
            Following {leader.identity.name}
            <button type="button" className="fig-follow-exit" onClick={() => setFollowing(null)}>
              Stop
            </button>
          </>
        )}
        {spotlight && !leader && (
          <>
            <span className="fig-follow-dot" style={{ background: '#F5A623' }} />
            Everyone is watching you
            <button
              type="button"
              className="fig-follow-exit"
              onClick={() => useUI.getState().setSpotlight(false)}
            >
              Stop
            </button>
          </>
        )}
      </div>
    </>
  );
}
