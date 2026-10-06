import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./jwt-secret";

/**
 * Minting and checking session tokens, in one place.
 *
 * Two problems lived in the old shape. The access token and the refresh
 * token carried identical claims, so nothing stopped the seven-day refresh
 * token being presented as a session token - the real session length was
 * seven days, and the fifteen-minute access token was decoration. And
 * /auth/refresh re-minted from whatever the old token claimed, without ever
 * asking the database, so a token could be rolled forward for ever and a
 * demotion recorded in users.role was never noticed: the role the holder
 * started with was the role they kept.
 *
 * The `typ` claim fixes the first by making the two kinds of token
 * structurally different. The refresh route fixes the second by reloading the
 * account and minting the role it finds there.
 *
 * Tokens issued before this existed carry no `typ` and are refused, so
 * everyone signs in once when it ships. That is the point: a grace period
 * that accepts the old shape keeps the hole open for the length of the
 * grace period.
 */

export type TokenType = "access" | "refresh";

export const ACCESS_TOKEN_EXPIRY = "15m";
export const REFRESH_TOKEN_EXPIRY = "7d";

export interface SessionClaims {
  userId: string;
  role: string;
  phone: string;
  typ: TokenType;
  /** Issued-at, in seconds. Present on anything jwt signed. */
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export function mintTokens(payload: {
  userId: string;
  role: string;
  phone: string;
}): TokenPair {
  return {
    accessToken: jwt.sign({ ...payload, typ: "access" satisfies TokenType }, JWT_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    }),
    refreshToken: jwt.sign({ ...payload, typ: "refresh" satisfies TokenType }, JWT_SECRET, {
      expiresIn: REFRESH_TOKEN_EXPIRY,
    }),
  };
}

/**
 * Verify a token AND that it is the kind being asked for.
 *
 * Returns null rather than throwing, so callers cannot accidentally treat a
 * thrown-and-caught failure as a pass. A token with no `typ` is one minted
 * before this change and is refused.
 */
export function verifyToken(token: string, expected: TokenType): SessionClaims | null {
  try {
    const claims = jwt.verify(token, JWT_SECRET) as SessionClaims;
    if (claims.typ !== expected) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Was this token issued before the account's sessions were revoked?
 *
 * Both sides are compared in whole seconds, because iat only has
 * second resolution while the revocation timestamp has milliseconds. Mixing
 * the two is how signing out and straight back in produces a session that
 * dies at its first refresh: the new token's iat rounds down below a
 * revocation stamped a few hundred milliseconds earlier, and the login looks
 * like it worked right up until it quietly does not.
 *
 * Rounding this way lets a token minted in the same second as the logout, but
 * a fraction before it, survive. That sub-second window is worth far less
 * than a sign-in that works.
 */
export function issuedBeforeRevocation(
  claims: SessionClaims,
  revokedAt: Date | null | undefined,
): boolean {
  if (!revokedAt) return false;
  if (typeof claims.iat !== "number") return true;
  return claims.iat < Math.floor(revokedAt.getTime() / 1000);
}
