/**
 * The `?next=` a sign-in wall carries, if it is safe to obey.
 *
 * Only a path on this site. An absolute URL — and the `//host` and `/\host`
 * forms a browser also reads as one — would turn the sign-in form into an open
 * redirect for anyone who can get a link in front of you, which is precisely
 * the situation a shared file link creates.
 */
export function safeNext(value: unknown): string | null {
  const next = typeof value === 'string' ? value : '';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
}
