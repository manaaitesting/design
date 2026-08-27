/** Pick readable label text for an arbitrary presence colour. */
export function readableOn(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '#111';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? '#1A1A1A' : '#FFFFFF';
}
