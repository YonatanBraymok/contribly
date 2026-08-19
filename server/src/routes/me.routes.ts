import { Router } from 'express';
import { z } from 'zod';
import { kickProfileSync, recoverStaleSync } from '../lib/profile/sync.js';
import { matchTopic } from '../lib/profile/taxonomy.js';
import {
  getAnalysis,
  getProfile,
  syncProfile,
  updatePreferences,
  type PreferencesUpdate,
} from '../lib/users.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';

export const meRouter: Router = Router();

/** Mirrors public.complexity_level. */
const COMPLEXITY_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'] as const;

/**
 * Validated here rather than by a check constraint, so adding a goal is a
 * deploy and not a migration.
 */
const CONTRIBUTION_GOALS = [
  'learn-new-tech',
  'deepen-stack',
  'first-contribution',
  'give-back',
] as const;

/**
 * Free-text lists are shown back to the user and will eventually be embedded,
 * so they are bounded on both axes. Without the caps, a scripted client could
 * park unbounded text in a column that the dashboard renders.
 */
const shortTextList = (maxItems: number) =>
  z.array(z.string().trim().min(1).max(60)).max(maxItems);

const preferencesSchema = z
  .object({
    tech_stack: shortTextList(30).optional(),
    learning_goals: shortTextList(10).optional(),
    preferred_languages: shortTextList(15).optional(),
    contribution_goals: z.array(z.enum(CONTRIBUTION_GOALS)).max(4).optional(),
    weekly_hours: z.number().int().min(1).max(80).nullable().optional(),
    difficulty_preference: z.enum(COMPLEXITY_LEVELS).nullable().optional(),
    complete_onboarding: z.boolean().optional(),
  })
  .strict();

/**
 * Rewrites a hand-typed technology to the name the rest of the system uses.
 *
 * Someone editing their stack types "nextjs" or "react"; ingestion stores
 * "Next.js" and "React", because both sides are canonicalised through the same
 * taxonomy. Normalising on the way in keeps `tech_stack` in one vocabulary,
 * which matters for how it reads back on the dashboard and for the profile text
 * the embedding phase will eventually assemble from it.
 *
 * Anything the taxonomy does not recognise is kept exactly as typed — a stack
 * editor that quietly discards what you wrote is worse than one that stores an
 * unusual spelling. Matching stays case-insensitive in the database regardless,
 * so an unrecognised "typescript" still finds TypeScript repositories.
 */
function canonicalise(values: string[]): string[] {
  return values.map((value) => matchTopic(value) ?? value);
}

/** Case-insensitive de-duplication, keeping the first spelling seen. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

/**
 * The signed-in developer's profile.
 *
 * Falls back to creating the row when it is missing so a sign-in whose callback
 * failed part-way still heals on the next request, rather than leaving an
 * account that can authenticate but has nothing to show.
 *
 * Doubles as the recovery point for abandoned syncs. This is the one route
 * every signed-in user hits, which makes it the natural place to notice that a
 * 'running' row belongs to a process that no longer exists.
 */
meRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { user } = req as AuthedRequest;
    let profile = (await getProfile(user.id)) ?? (await syncProfile(user));

    if (await recoverStaleSync(user.id, profile.sync_status, profile.sync_started_at)) {
      profile = (await getProfile(user.id)) ?? profile;
    }

    res.json({ profile });
  } catch (error) {
    next(error);
  }
});

/**
 * Starts a profile sync.
 *
 * Always 202: the work happens in the background and the caller polls GET /me.
 * `outcome` says whether anything actually started, so a UI can tell "we are
 * analysing you now" from "we did that an hour ago".
 */
meRouter.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const { user } = req as AuthedRequest;
    const force = req.query.force === '1' || req.query.force === 'true';

    const outcome = await kickProfileSync(user.id, { force });
    const profile = await getProfile(user.id);

    res.status(202).json({
      outcome,
      sync_status: profile?.sync_status ?? 'pending',
      last_synced_at: profile?.last_synced_at ?? null,
    });
  } catch (error) {
    next(error);
  }
});

/** The full derivation — every number the dashboard needs to show its work. */
meRouter.get('/analysis', requireAuth, async (req, res, next) => {
  try {
    const { user } = req as AuthedRequest;

    res.json({ analysis: await getAnalysis(user.id) });
  } catch (error) {
    next(error);
  }
});

/**
 * Onboarding answers and manual corrections.
 *
 * Editing `tech_stack` stamps `tech_stack_edited_at`, which permanently hands
 * ownership of that column from the sync to the user. That is the point: a
 * re-sync must never silently undo a correction somebody just made.
 */
meRouter.patch('/preferences', requireAuth, async (req, res, next) => {
  try {
    const parsed = preferencesSchema.safeParse(req.body ?? {});

    if (!parsed.success) {
      throw new HttpError(400, 'Invalid preferences', parsed.error.flatten());
    }

    const { complete_onboarding: completeOnboarding, ...fields } = parsed.data;
    const now = new Date().toISOString();

    const update: PreferencesUpdate = {
      ...fields,
      ...(fields.tech_stack
        ? {
            tech_stack: dedupe(canonicalise(fields.tech_stack)),
            tech_stack_edited_at: now,
          }
        : {}),
      ...(fields.learning_goals ? { learning_goals: dedupe(fields.learning_goals) } : {}),
      ...(fields.preferred_languages
        ? { preferred_languages: dedupe(fields.preferred_languages) }
        : {}),
      ...(completeOnboarding ? { onboarding_completed_at: now } : {}),
    };

    if (Object.keys(update).length === 0) {
      throw new HttpError(400, 'No fields to update');
    }

    const { user } = req as AuthedRequest;

    res.json({ profile: await updatePreferences(user.id, update) });
  } catch (error) {
    next(error);
  }
});
