import { Router } from 'express';
import { DEFAULT_LIMIT, recommendFor } from '../lib/recommendations.js';
import { getProfile, syncProfile } from '../lib/users.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const recommendationsRouter: Router = Router();

/**
 * Repositories worth the signed-in developer's next weekend.
 *
 * Computed per request rather than stored. The query is one indexed array
 * overlap over a corpus of a few thousand rows, and a cached recommendation
 * that ignores a stack the user corrected two minutes ago is worse than no
 * cache at all.
 */
recommendationsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { user } = req as AuthedRequest;
    const requested = Number(req.query.limit);
    const limit = Number.isFinite(requested) ? requested : DEFAULT_LIMIT;

    // Same self-healing fallback as GET /me: a sign-in whose callback failed
    // part-way should still see a working page.
    const profile = (await getProfile(user.id)) ?? (await syncProfile(user));

    res.json(await recommendFor(profile, limit));
  } catch (error) {
    next(error);
  }
});
