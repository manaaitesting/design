const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, collision-resistant, and readable in the layer tree during debugging. */
export function newId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
