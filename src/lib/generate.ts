/**
 * Placeholder generators for the Create image / Create SVG tools.
 *
 * These run locally and are deterministic — no model is called. They exist so
 * the tool is wired end to end; swapping in a real endpoint means replacing the
 * body of these two functions and nothing else.
 */

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const PALETTES = [
  ['#BDEE63', '#27C4A6', '#1064A8'],
  ['#F2637F', '#9B7BF0', '#4CC3F0'],
  ['#F5A623', '#EF6C3E', '#6C2BD9'],
  ['#E568C8', '#7ED321', '#4CC3F0'],
  ['#0B1026', '#3B2A63', '#F5A05A'],
];

export function generateImageFill(prompt: string): string {
  const seed = hash(prompt || 'paper');
  const [a, b, c] = PALETTES[seed % PALETTES.length];
  const angleA = seed % 90;
  const angleB = (seed >> 3) % 90;
  return [
    `radial-gradient(at ${20 + (seed % 30)}% ${15 + (seed % 25)}%, ${a} 0px, transparent 55%)`,
    `radial-gradient(at ${60 + (angleA % 25)}% ${20 + (angleB % 30)}%, ${b} 0px, transparent 50%)`,
    `radial-gradient(at ${30 + (angleB % 40)}% ${75 + (seed % 15)}%, ${c} 0px, transparent 55%)`,
    b,
  ].join(', ');
}

export function generateSvg(prompt: string): string {
  const seed = hash(prompt || 'mark');
  const [a, b] = PALETTES[seed % PALETTES.length];
  const sides = 3 + (seed % 5);
  const points = Array.from({ length: sides }, (_, i) => {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const radius = 38 + ((seed >> i) % 12);
    return `${(50 + Math.cos(angle) * radius).toFixed(1)},${(50 + Math.sin(angle) * radius).toFixed(1)}`;
  }).join(' ');

  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/>` +
    `</linearGradient></defs>` +
    `<polygon points='${points}' fill='url(%23g)'/></svg>`;

  return `url("data:image/svg+xml,${svg.replace(/#/g, '%23')}")`;
}

export const ASPECTS: Record<string, [number, number]> = {
  '1:1': [320, 320],
  '4:3': [360, 270],
  '16:9': [416, 234],
  '3:4': [270, 360],
  '9:16': [234, 416],
};
