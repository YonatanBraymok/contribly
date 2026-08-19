import { Router } from 'express';
import { z } from 'zod';
import { kickProfileSync } from '../lib/profile/sync.js';
import { storeGitHubToken, syncProfile } from '../lib/users.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';

export const authRouter: Router = Router();

const sessionSchema = z.object({
  /**
   * GitHub's access token, from the OAuth exchange. Optional because Supabase
   * only returns it on the initial code exchange — a session restored from
   * cookies has no provider token to forward.
   */
  providerToken: z.string().min(1).optional(),
  scopes: z.array(z.string()).default([]),
});

/**
 * Called by the client's /login/callback once a session exists.
 *
 * Three jobs: refresh the profile from the GitHub claims, capture the provider
 * token before it is lost, and start the profile analysis. Supabase hands that
 * token back exactly once, on the response to the code exchange — it is not
 * part of the stored session and there is no way to ask for it again short of
 * re-authenticating.
 *
 * Kicking the sync from here is what makes onboarding feel instant: the
 * analysis runs while the user answers the questionnaire, so by the time they
 * reach the step that shows their detected stack, it is already there.
 */
authRouter.post('/session', requireAuth, async (req, res, next) => {
  try {
    const parsed = sessionSchema.safeParse(req.body ?? {});

    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request body', parsed.error.flatten());
    }

    const { user } = req as AuthedRequest;
    const profile = await syncProfile(user);

    if (parsed.data.providerToken) {
      await storeGitHubToken(user.id, parsed.data.providerToken, parsed.data.scopes);
    }

    // Speculative by design: every reason not to run — a sync already in
    // flight, one finished within the throttle window, no stored token — is
    // decided inside kickProfileSync rather than guessed at here.
    const sync = await kickProfileSync(user.id);

    res.json({
      profile,
      // Lets the caller notice a sign-in that produced no usable GitHub token.
      githubTokenStored: Boolean(parsed.data.providerToken),
      sync,
    });
  } catch (error) {
    next(error);
  }
});
