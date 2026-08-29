import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Gives a link visitor an identity before the page renders.
 *
 * Someone arriving at `/f/<id>` on a publicly shared link has no account, and
 * their cursor still needs a stable name and colour — a visitor whose id
 * changed on every reload would show up as a crowd of one person. That id has
 * to be minted somewhere, and it cannot be minted during the render: a server
 * component may read cookies but not set them.
 *
 * So it is minted here, and only here. The cookie carries no authority
 * whatsoever — what lets a visitor into a room is the sync token, which the
 * server signs only after checking the file's `link_role`. Forging this cookie
 * buys a different avatar and nothing else.
 */

const GUEST_COOKIE = 'paperlike_guest';
const SESSION_COOKIE = 'paperlike_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function proxy(request: NextRequest) {
  // a signed-in visitor already has an identity, and a returning guest already
  // has this cookie — neither needs a new one
  if (request.cookies.has(SESSION_COOKIE) || request.cookies.has(GUEST_COOKIE)) {
    return NextResponse.next();
  }

  const id = `guest-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  // Set on the request as well as the response: the render happens now, and
  // reading it back from the response is not something a server component can
  // do. Forwarding the modified headers is what makes this request see it.
  request.cookies.set(GUEST_COOKIE, id);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set({
    name: GUEST_COOKIE,
    value: id,
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export const config = {
  // only the file route needs it; nothing else has anonymous visitors
  matcher: '/f/:room*',
};
