import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { fetchProfile, requestSync } from "@/lib/api-server";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = {
  title: "Set up",
  description: "Tell Contribly what you build and what you want to work on.",
};

/**
 * First-run setup. Reached only with a session — proxy.ts sees to that — and
 * normally only once: /dashboard sends people here until they finish, and this
 * page sends them back once they have.
 *
 * `?edit=1` reopens it deliberately, which is how the dashboard offers a way to
 * change the answers later.
 */
export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const searchParams = await props.searchParams;
  const editing = searchParams.edit === "1";

  const result = await fetchProfile();

  if (!result.ok) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          We cannot reach your profile
        </h1>
        <p className="text-sm opacity-70">
          Your session is fine — this is the API call failing. {result.error}
        </p>
        <Link
          href="/onboarding"
          className="rounded-full border border-black/15 px-5 py-2 text-sm transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Try again
        </Link>
      </div>
    );
  }

  const { profile } = result.data;

  if (profile.onboarding_completed_at && !editing) {
    redirect("/dashboard");
  }

  // Belt and braces. POST /api/v1/auth/session already kicks the analysis at
  // sign-in, but that call is fire-and-forget from the OAuth callback and
  // deliberately does not fail the login when it errors. A profile that arrives
  // here still 'pending' is exactly that case, and this is where it gets fixed.
  const status = profile.sync_status === "pending" ? "running" : profile.sync_status;

  if (profile.sync_status === "pending") {
    await requestSync();
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <OnboardingFlow
        initial={{
          username: profile.github_username,
          syncStatus: status,
          syncError: profile.sync_error,
          techStack: profile.tech_stack,
          languages: Object.keys(profile.language_proficiency),
          learningGoals: profile.learning_goals,
          preferredLanguages: profile.preferred_languages,
          contributionGoals: profile.contribution_goals,
          weeklyHours: profile.weekly_hours,
          difficultyPreference: profile.difficulty_preference,
          stackEdited: Boolean(profile.tech_stack_edited_at),
        }}
      />
    </div>
  );
}
