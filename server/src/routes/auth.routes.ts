import { Router } from 'express';
import { z } from 'zod';
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
 * Two jobs: refresh the profile from the GitHub claims, and capture the
 * provider token before it is lost. Supabase hands that token back exactly
 * once, on the response to the code exchange — it is not part of the stored
 * session and there is no way to ask for it again short of re-authenticating.
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

    res.json({
      profile,
      // Lets the caller notice a sign-in that produced no usable GitHub token.
      githubTokenStored: Boolean(parsed.data.providerToken),
    });
  } catch (error) {
    next(error);
  }
});
