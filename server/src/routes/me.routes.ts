import { Router } from 'express';
import { getProfile, syncProfile } from '../lib/users.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const meRouter: Router = Router();

/**
 * The signed-in developer's profile.
 *
 * Falls back to creating the row when it is missing so a sign-in whose callback
 * failed part-way still heals on the next request, rather than leaving an
 * account that can authenticate but has nothing to show.
 */
meRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { user } = req as AuthedRequest;
    const profile = (await getProfile(user.id)) ?? (await syncProfile(user));

    res.json({ profile });
  } catch (error) {
    next(error);
  }
});
