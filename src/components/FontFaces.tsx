'use client';

import { useCustomFonts } from './Session';
import { fontFaceCss } from '../lib/fonts';

/**
 * The faces uploaded into this document, declared for the page.
 *
 * A `<style>` rather than injected rules: React owns it, it updates when the
 * document does, and it disappears with the editor instead of leaking into
 * whatever the browser navigates to next.
 */
export function FontFaces() {
  const fonts = useCustomFonts();
  if (!fonts.length) return null;
  return <style>{fontFaceCss(fonts)}</style>;
}
