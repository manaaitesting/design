'use client';

import { useEffect, useRef } from 'react';
import { useDoc, useReadOnly, useSession, useTokenVars } from './Session';
import { useUI } from '../state/ui';
import { setThumbnailAction } from '../server/actions';
import { nodeToPng } from '../export/raster';
import { ROOT_ID } from '../document/types';

/**
 * The picture the file browser shows.
 *
 * It is captured from the canvas rather than rendered anywhere else — the same
 * `foreignObject` path the exporter takes — so a file's card shows the file.
 * Capturing is deliberately lazy: once a while after the document settles, and
 * never while someone is mid-gesture, because a thumbnail is worth nothing and
 * a stutter costs something.
 */

const SETTLE_MS = 6000;
const AT_MOST_EVERY_MS = 120_000;
/** The card is 120px tall; twice that is enough on any display. */
const HEIGHT = 240;

export function Thumbnail() {
  const doc = useDoc();
  const readOnly = useReadOnly();
  const { provider } = useSession();
  const tokenVars = useTokenVars();
  const last = useRef(0);
  const room = provider.roomname;

  useEffect(() => {
    if (readOnly) return;
    const page = doc[useUI.getState().page] ?? doc[ROOT_ID];
    const first = page?.children?.find((id) => doc[id]?.type === 'frame');
    if (!first) return;
    if (Date.now() - last.current < AT_MOST_EVERY_MS) return;

    const timer = setTimeout(async () => {
      const node = doc[first];
      if (!node) return;
      last.current = Date.now();
      try {
        const scale = Math.min(1, HEIGHT / Math.max(node.h, 1));
        const blob = await nodeToPng(first, useUI.getState().viewport.zoom, scale, tokenVars);
        if (blob.size > 380_000) return;
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });
        await setThumbnailAction(room, dataUrl);
      } catch {
        // a thumbnail is never worth surfacing an error for
      }
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [doc, readOnly, room, tokenVars]);

  return null;
}
