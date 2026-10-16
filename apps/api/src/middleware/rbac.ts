import { Request, Response, NextFunction } from 'express';

export type Role = 'viewer' | 'analyst' | 'approver' | 'admin';

const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  analyst: 1,
  approver: 2,
  admin: 3,
};

export interface AuthedRequest extends Request {
  user?: { id: string; role: Role };
}

function readRole(req: Request): Role {
  const raw = (req.header('x-user-role') || process.env.DEFAULT_USER_ROLE || 'viewer').toLowerCase();
  if (raw in ROLE_RANK) return raw as Role;
  return 'viewer';
}

export function attachUser(req: AuthedRequest, _res: Response, next: NextFunction): void {
  req.user = {
    id: req.header('x-user-id') || 'anonymous',
    role: readRole(req),
  };
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const role = req.user?.role ?? readRole(req);
    const minRank = Math.min(...roles.map((r) => ROLE_RANK[r]));
    if (ROLE_RANK[role] >= minRank) {
      next();
      return;
    }
    res.status(403).json({
      error: 'Forbidden',
      details: `Requires one of roles: ${roles.join(', ')}; current role: ${role}`,
    });
  };
}

export function actorOf(req: AuthedRequest): string {
  const header = req.header('x-user-id');
  return header || req.user?.id || 'system';
}
