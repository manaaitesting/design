/**
 * A stand-in for the `server-only` marker package.
 *
 * That package exists to throw when a server module is pulled into a client
 * bundle, which is exactly what it does when a test imports one directly. The
 * tests are the server, so `tsconfig.test.json` points the specifier here.
 */
export {};
