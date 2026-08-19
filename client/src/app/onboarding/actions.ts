"use server";

import { redirect } from "next/navigation";
import {
  savePreferences,
  type ComplexityLevel,
  type PreferencesUpdate,
} from "@/lib/api-server";

export interface OnboardingAnswers {
  tech_stack?: string[];
  learning_goals: string[];
  preferred_languages: string[];
  contribution_goals: string[];
  weekly_hours: number | null;
  difficulty_preference: ComplexityLevel | null;
}

/**
 * Writes the questionnaire and marks onboarding done.
 *
 * `tech_stack` is only present when the user actually edited it. The PATCH
 * route stamps `tech_stack_edited_at` on any write to that field, which
 * permanently takes the column away from the sync — sending an untouched value
 * would freeze the detected stack at whatever the first analysis happened to
 * find, and no later re-sync would ever correct it.
 */
export async function finishOnboarding(
  answers: OnboardingAnswers,
): Promise<{ ok: false; error: string } | never> {
  const update: PreferencesUpdate = {
    ...(answers.tech_stack ? { tech_stack: answers.tech_stack } : {}),
    learning_goals: answers.learning_goals,
    preferred_languages: answers.preferred_languages,
    contribution_goals: answers.contribution_goals,
    weekly_hours: answers.weekly_hours,
    difficulty_preference: answers.difficulty_preference,
    complete_onboarding: true,
  };

  const result = await savePreferences(update);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  redirect("/dashboard");
}
