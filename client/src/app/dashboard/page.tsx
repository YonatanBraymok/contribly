import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  fetchAnalysis,
  fetchProfile,
  type ProfileAnalysis,
} from "@/lib/api-server";
import { SyncStatus } from "./sync-status";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your GitHub profile signals and learning goals.",
};

const GOAL_LABELS: Record<string, string> = {
  "learn-new-tech": "Learn something new",
  "deepen-stack": "Go deeper in my stack",
  "first-contribution": "Make my first contribution",
  "give-back": "Give back to what I use",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Gentle",
  intermediate: "Moderate",
  advanced: "Challenging",
  expert: "Deep end",
};

function Card({
  title,
  blurb,
  children,
  dashed = false,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
  dashed?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border p-6 ${
        dashed
          ? "border-dashed border-black/15 dark:border-white/20"
          : "border-black/10 dark:border-white/15"
      }`}
    >
      <h2 className="font-medium">{title}</h2>
      {blurb && <p className="mt-2 text-sm opacity-60">{blurb}</p>}
      <div className="mt-4">{children}</div>
    </article>
  );
}

function Chips({ values, muted = false }: { values: string[]; muted?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {values.map((value) => (
        <li
          key={value}
          className={
            muted
              ? "rounded-full border border-black/15 px-3 py-1 text-xs dark:border-white/20"
              : "rounded-full bg-contrib-2/15 px-3 py-1 font-mono text-xs"
          }
        >
          {value}
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs opacity-50">{children}</p>;
}

/** Proficiency bars, widest first — the shares arrive already sorted. */
function LanguageBars({ languages }: { languages: ProfileAnalysis["languages"] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {languages.map((language) => (
        <li key={language.name} className="flex items-center gap-3 text-xs">
          <span className="w-28 shrink-0 truncate">{language.name}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <span
              className="block h-full rounded-full bg-contrib-3"
              style={{ width: `${Math.max(2, language.share * 100)}%` }}
            />
          </span>
          <span className="w-12 shrink-0 text-right font-mono opacity-60">
            {(language.share * 100).toFixed(0)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The complexity score with its arithmetic shown.
 *
 * Collapsed by default but always present, because a number that labels
 * somebody a beginner has to be able to justify itself on demand. "Our
 * algorithm decided" is not an answer anyone accepts about themselves.
 */
function ComplexityBreakdown({
  complexity,
}: {
  complexity: ProfileAnalysis["complexity"];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-semibold tracking-tight capitalize">
          {complexity.level}
        </span>
        <span className="font-mono text-xs opacity-50">
          {complexity.score}/100
        </span>
      </div>

      <span className="h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <span
          className="block h-full rounded-full bg-contrib-4"
          style={{ width: `${complexity.score}%` }}
        />
      </span>

      <details className="text-sm">
        <summary className="cursor-pointer opacity-60 transition-opacity hover:opacity-100">
          How this was worked out
        </summary>
        <dl className="mt-4 flex flex-col gap-3">
          {Object.entries(complexity.components).map(([key, component]) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <dt className="text-xs opacity-70">{component.note}</dt>
              <dd className="shrink-0 font-mono text-xs opacity-50">
                {component.points}/{component.max}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

/** Reached only with a session — proxy.ts redirects everyone else to /login. */
export default async function DashboardPage() {
  // Independent calls; the analysis blob is kept off GET /me because onboarding
  // polls that route every couple of seconds and has no use for it.
  const [profileResult, analysisResult] = await Promise.all([
    fetchProfile(),
    fetchAnalysis(),
  ]);

  const profile = profileResult.ok ? profileResult.data.profile : null;
  const analysis = analysisResult.ok ? analysisResult.data.analysis : null;

  // First run goes through setup. The check lives here rather than in proxy.ts,
  // which runs on nearly every request and already pays for one Supabase hop.
  if (profile && !profile.onboarding_completed_at) {
    redirect("/onboarding");
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center gap-4">
        {profile?.avatar_url && (
          <Image
            src={profile.avatar_url}
            alt=""
            width={56}
            height={56}
            className="rounded-full"
            unoptimized
          />
        )}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            {profile?.github_username ?? "Dashboard"}
          </h1>
          <p className="text-sm opacity-70">
            {profile?.email ?? "Signed in with GitHub"}
          </p>
        </div>
      </header>

      {!profileResult.ok && (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
        >
          Could not load your profile — {profileResult.error}. The session is
          valid; this is the API call failing.
        </p>
      )}

      {profile && (
        <SyncStatus
          status={profile.sync_status}
          error={profile.sync_error}
          lastSyncedAt={profile.last_synced_at}
        />
      )}

      {analysis?.confidence === "low" && (
        <p className="rounded-lg border border-black/10 px-4 py-3 text-sm opacity-70 dark:border-white/15">
          There is not much public activity on this account, so the signals
          below are thin. That says nothing about your experience — plenty of
          strong work sits behind a company firewall. Your stated preferences
          will do the heavy lifting for matching.
        </p>
      )}

      <section className="grid gap-6 md:grid-cols-2">
        <Card
          title="Detected stack"
          blurb={
            profile?.tech_stack_edited_at
              ? "Edited by you, so re-analysing will not overwrite it."
              : "Derived from your public repositories, their topics and your recent activity."
          }
        >
          {profile?.tech_stack.length ? (
            <Chips values={profile.tech_stack} />
          ) : (
            <Empty>Awaiting profile sync</Empty>
          )}
        </Card>

        <Card
          title="Language proficiency"
          blurb="Weighted by size and recency, so what you write now counts for more than what you wrote three years ago."
        >
          {analysis?.languages.length ? (
            <LanguageBars languages={analysis.languages} />
          ) : (
            <Empty>Awaiting profile sync</Empty>
          )}
        </Card>

        <Card
          title="Contribution level"
          blurb="What your public history suggests you can take on."
        >
          {analysis ? (
            <ComplexityBreakdown complexity={analysis.complexity} />
          ) : (
            <Empty>Awaiting profile sync</Empty>
          )}
        </Card>

        <Card
          title="Interests"
          blurb="From what you star and fork — where you seem to want to go, rather than where you have been."
        >
          {analysis?.interests.length ? (
            <Chips
              values={analysis.interests.map((interest) => interest.topic)}
              muted
            />
          ) : (
            <Empty>Nothing detected yet</Empty>
          )}
        </Card>
      </section>

      <section className="rounded-xl border border-black/10 p-6 dark:border-white/15">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">What you told us</h2>
            <p className="mt-2 text-sm opacity-60">
              Your answers steer matching past what your history alone would
              suggest.
            </p>
          </div>
          <Link
            href="/onboarding?edit=1"
            className="shrink-0 rounded-full border border-black/15 px-4 py-1.5 text-xs transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Edit
          </Link>
        </div>

        <dl className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <dt className="text-xs opacity-50">Wants to work in</dt>
            <dd className="mt-2">
              {profile?.preferred_languages.length ? (
                <Chips values={profile.preferred_languages} muted />
              ) : (
                <Empty>No preference set</Empty>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-xs opacity-50">Learning goals</dt>
            <dd className="mt-2">
              {profile?.learning_goals.length ? (
                <Chips values={profile.learning_goals} muted />
              ) : (
                <Empty>None set</Empty>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-xs opacity-50">Here to</dt>
            <dd className="mt-2">
              {profile?.contribution_goals.length ? (
                <Chips
                  values={profile.contribution_goals.map(
                    (goal) => GOAL_LABELS[goal] ?? goal,
                  )}
                  muted
                />
              ) : (
                <Empty>Not stated</Empty>
              )}
            </dd>
          </div>

          <div className="flex gap-10">
            <div>
              <dt className="text-xs opacity-50">Time per week</dt>
              <dd className="mt-2 text-sm">
                {profile?.weekly_hours ? `~${profile.weekly_hours} hrs` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs opacity-50">Appetite</dt>
              <dd className="mt-2 text-sm">
                {profile?.difficulty_preference
                  ? (DIFFICULTY_LABELS[profile.difficulty_preference] ??
                    profile.difficulty_preference)
                  : "—"}
              </dd>
            </div>
          </div>
        </dl>
      </section>

      {analysis && (
        <section className="rounded-xl border border-dashed border-black/15 p-6 dark:border-white/20">
          <h2 className="font-medium">Signals behind the match</h2>
          <dl className="mt-4 grid gap-3 font-mono text-xs sm:grid-cols-4">
            <div>
              <dt className="opacity-50">external merged PRs</dt>
              <dd>{analysis.github.external_merged_prs}</dd>
            </div>
            <div>
              <dt className="opacity-50">original repos</dt>
              <dd>{analysis.github.non_fork_repos}</dd>
            </div>
            <div>
              <dt className="opacity-50">active months / 12</dt>
              <dd>{analysis.github.active_months_last_year}</dd>
            </div>
            <div>
              <dt className="opacity-50">events read</dt>
              <dd>
                {analysis.github.events_analysed} /{" "}
                {analysis.github.events_window_days}d
              </dd>
            </div>
          </dl>

          {analysis.sources.some((source) => !source.ok) && (
            <div className="mt-5 border-t border-black/10 pt-4 dark:border-white/15">
              <p className="text-xs opacity-50">
                Some GitHub calls did not come back, so parts of this are
                thinner than they should be:
              </p>
              <ul className="mt-2 flex flex-col gap-1 font-mono text-xs opacity-60">
                {analysis.sources
                  .filter((source) => !source.ok)
                  .map((source) => (
                    <li key={source.endpoint}>
                      {source.endpoint} — {source.error}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
