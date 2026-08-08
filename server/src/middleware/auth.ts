import type { NextFunction, Request, Response } from 'express';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase.js';
import { HttpError } from './errors.js';

/**
 * The GitHub claims Supabase copies onto the user from the OAuth grant. Every
 * field is optional: GitHub only returns what the granted scopes allow, and a
 * user with no public email will not have one here.
 */
export interface GitHubIdentity {
  username?: string;
  githubId?: number;
  avatarUrl?: string;
}

export interface AuthenticatedUser extends GitHubIdentity {
  id: string;
  email?: string;
}

/** A request that has passed through `requireAuth`. */
export interface AuthedRequest extends Request {
  user: AuthenticatedUser;
}

function readBearerToken(req: Request): string {
  const header = req.get('authorization');

  if (!header?.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'Missing bearer token');
  }

  const token = header.slice('bearer '.length).trim();

  if (!token) {
    throw new HttpError(401, 'Missing bearer token');
  }

  return token;
}

/**
 * Rejects the request unless it carries a valid Supabase session JWT.
 *
 * Verification goes through Supabase rather than checking the signature here.
 * That costs a round trip per request, but it honours revocation — a signed-out
 * or banned user stops working immediately, where a locally-verified signature
 * would keep passing until the token expired. Worth revisiting with the JWKS
 * endpoint once there is a hot path that cannot afford the hop.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!isSupabaseConfigured()) {
      throw new HttpError(503, 'Authentication is unavailable: Supabase is not configured');
    }

    const token = readBearerToken(req);
    const { data, error } = await getSupabase().auth.getUser(token);

    if (error || !data.user) {
      throw new HttpError(401, 'Invalid or expired session');
    }

    const metadata = data.user.user_metadata ?? {};
    const rawGithubId = metadata.provider_id ?? metadata.sub;
    const githubId = Number(rawGithubId);

    (req as AuthedRequest).user = {
      id: data.user.id,
      email: data.user.email,
      username: metadata.user_name ?? metadata.preferred_username,
      githubId: Number.isSafeInteger(githubId) && githubId > 0 ? githubId : undefined,
      avatarUrl: metadata.avatar_url,
    };

    next();
  } catch (error) {
    next(error);
  }
}
