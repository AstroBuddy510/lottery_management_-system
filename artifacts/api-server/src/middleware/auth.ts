import { Request, Response, NextFunction } from "express";
import { verifyToken, type SessionClaims } from "../lib/tokens";


/**
 * Kept as the name the routes already import. The claims now also carry
 * `typ`, which is what distinguishes an access token from a refresh token.
 */
export type JwtPayload = SessionClaims;

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const token = authHeader.slice(7);

  // Only an access token opens a session. The refresh token used to be
  // accepted here too - it carried identical claims - which made the real
  // session seven days long and the fifteen-minute access token ornamental.
  const claims = verifyToken(token, "access");
  if (!claims) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.user = claims;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden: insufficient role" });
      return;
    }
    next();
  };
}
