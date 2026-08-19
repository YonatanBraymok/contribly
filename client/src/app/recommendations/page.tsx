import type { Metadata } from "next";
import Link from "next/link";
import { fetchRecommendations, type Recommendation } from "@/lib/api-server";

export const metadata: Metadata = {
  title: "Recommendations",
  description: "Open-source repositories matched to the technologies you use.",
};

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Small project",
  intermediate: "Mid-sized project",
  advanced: "Large project",
  expert: "Very large project",
};

function stars(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k` : String(count);
}

function lastTouched(iso: string | null): string | null {
  if (!iso) {
    return null;
  }

  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);

  if (days < 1) return "active today";
  if (days < 7) return `active ${days}d ago`;
  if (days < 60) return `active ${Math.round(days / 7)}w ago`;

  return `active ${Math.round(days / 30)}mo ago`;
}

/**
 * One recommendation.
 *
 * The matched technologies lead, before the description and well before the
 * star count. The whole promise of the page is "this is yours because you use
 * these things", and burying the reason under a popularity number would make it
 * indistinguishable from any trending list.
 */
function RepoCard({ repo }: { repo: Recommendation }) {
  const touched = lastTouched(repo.last_commit_at);

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-black/10 p-6 dark:border-white/15">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <a
            href={repo.html_url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-sm font-medium underline-offset-4 hover:underline"
          >
            {repo.full_name}
          </a>
          {repo.description && (
            <p className="max-w-xl text-sm opacity-70">{repo.description}</p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-contrib-2/15 px-3 py-1 font-mono text-xs">
          {repo.overlap} match{repo.overlap === 1 ? "" : "es"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs opacity-50">Matches your stack on</span>
        <ul className="flex flex-wrap gap-2">
          {repo.matched_tech.map((tech) => (
            <li
              key={tech}
              className="rounded-full bg-contrib-3/20 px-3 py-1 font-mono text-xs"
            >
              {tech}
            </li>
          ))}
        </ul>
      </div>

      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-black/10 pt-4 font-mono text-xs opacity-60 dark:border-white/15">
        {repo.primary_language && (
          <div className="flex gap-1.5">
            <dt className="sr-only">Language</dt>
            <dd>{repo.primary_language}</dd>
          </div>
        )}
        <div className="flex gap-1.5">
          <dt className="sr-only">Stars</dt>
          <dd>★ {stars(repo.stars)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="sr-only">Open issues</dt>
          <dd>{repo.open_issues_count} open issues</dd>
        </div>
        {repo.contribution_difficulty && (
          <div className="flex gap-1.5">
            <dt className="sr-only">Size</dt>
            <dd>{DIFFICULTY_LABELS[repo.contribution_difficulty]}</dd>
          </div>
        )}
        {touched && (
          <div className="flex gap-1.5">
            <dt className="sr-only">Last commit</dt>
            <dd>{touched}</dd>
          </div>
        )}
        {repo.has_good_first_issues && (
          <div className="flex gap-1.5">
            <dt className="sr-only">Good first issues</dt>
            <dd className="text-contrib-4">good first issues</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

function Notice({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-black/15 p-8 dark:border-white/20">
      <h2 className="font-medium">{title}</h2>
      <div className="max-w-xl text-sm opacity-70">{children}</div>
      {action && (
        <Link
          href={action.href}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85"
        >
          {action.label}
        </Link>
      )}
    </section>
  );
}

export default async function RecommendationsPage() {
  const result = await fetchRecommendations();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Recommendations</h1>
        <p className="max-w-2xl opacity-70">
          Repositories that share at least two technologies with your stack,
          best match first.
        </p>
      </header>

      {!result.ok && (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
        >
          Could not load recommendations — {result.error}. Your session is
          valid; this is the API call failing.
        </p>
      )}

      {result.ok && result.data.status === "ok" && (
        <>
          <p className="font-mono text-xs opacity-50">
            matching on {result.data.techStack.join(", ")}
          </p>
          <section className="flex flex-col gap-4">
            {result.data.recommendations.map((repo) => (
              <RepoCard key={repo.id} repo={repo} />
            ))}
          </section>
        </>
      )}

      {result.ok && result.data.status === "insufficient_stack" && (
        <Notice
          title="We need a little more to go on"
          action={{ href: "/onboarding?edit=1", label: "Add your technologies" }}
        >
          <p>
            Matching needs at least {result.data.required} technologies, and
            your profile has{" "}
            {result.data.techStack.length === 0
              ? "none"
              : `only ${result.data.techStack.join(" and ")}`}
            .
          </p>
          <p className="mt-3">
            That usually means your work is private rather than that you have
            not done any — the analysis only sees public activity. Adding what
            you use takes a moment and is the whole input to this page.
          </p>
        </Notice>
      )}

      {result.ok && result.data.status === "no_matches" && (
        <Notice
          title="Nothing matched on two technologies"
          action={{ href: "/onboarding?edit=1", label: "Adjust your stack" }}
        >
          <p>
            We looked for repositories sharing at least two of{" "}
            <span className="font-mono text-xs">
              {result.data.techStack.join(", ")}
            </span>{" "}
            and came up empty. The indexed corpus is still small, so an unusual
            combination can genuinely miss.
          </p>
        </Notice>
      )}

      {result.ok && result.data.status === "empty_corpus" && (
        <Notice title="No repositories indexed yet">
          <p>
            The corpus is empty, so there is nothing to match against. This is a
            setup step rather than anything to do with your profile — seed it
            with:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-black/5 px-4 py-3 font-mono text-xs dark:bg-white/10">
            npm run ingest:repos --workspace=server
          </pre>
        </Notice>
      )}
    </div>
  );
}
