import type { RequestHandler } from 'express';
import { inBranch, LEGACY_BRANCH } from './branch-context.js';
import { ApiError, type User } from './security.js';

// Accept the old primary branch scope for cached clients and image URLs.
// Any other explicit scope must fail rather than silently writing to the shop.
export const validateShopScope: RequestHandler = (req, _res, next) => {
  const header = req.get('X-Branch-Id');
  const query = req.query.branch_id;
  if ((header !== undefined && header !== LEGACY_BRANCH) ||
      (query !== undefined && query !== LEGACY_BRANCH)) {
    throw new ApiError(403, 'BRANCH_FORBIDDEN');
  }
  if (query !== undefined) {
    const url = new URL(req.url, 'http://local');
    url.searchParams.delete('branch_id');
    req.url = url.pathname + url.search;
  }
  next();
};

export const shopContext: RequestHandler = (_req, res, next) => {
  const user = res.locals.user as User;
  inBranch({ ids: [LEGACY_BRANCH], write: true, master: user.role === 'owner', actorId: user.id, actorRole: user.role }, next);
};
