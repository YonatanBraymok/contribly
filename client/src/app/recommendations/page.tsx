import type { Metadata } from "next";
import { apiFetch } from "@/lib/api";

export const metadata: Metadata = {
  title: "Recommendations",
  description: "Repositories and issues matched to your profile.",
};

type HealthResponse = {
  status: string;
  service: string;
  environment: string;
  uptimeSeconds: number;
};

export default async function RecommendationsPage() {
  // Until the matching endpoint exists, this proves the client → API wiring
  // end to end from a Server Component.
  const health = await apiFetch<HealthResponse>("/health");

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Recommendations
        </h1>
        <p className="max-w-2xl opacity-70">
          Semantic matches from the repository and issue vector index.
        </p>
      </header>

      <section className="rounded-xl border border-black/10 p-6 dark:border-white/15">
        <h2 className="font-medium">API connection</h2>
        {health.ok ? (
          <dl className="mt-4 grid gap-2 font-mono text-xs sm:grid-cols-2">
            <div>
              <dt className="opacity-50">status</dt>
              <dd>{health.data.status}</dd>
            </div>
            <div>
              <dt className="opacity-50">service</dt>
              <dd>{health.data.service}</dd>
            </div>
            <div>
              <dt className="opacity-50">environment</dt>
              <dd>{health.data.environment}</dd>
            </div>
            <div>
              <dt className="opacity-50">uptime</dt>
              <dd>{health.data.uptimeSeconds}s</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-4 font-mono text-xs opacity-60">
            API unreachable — {health.error}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-dashed border-black/15 p-6 dark:border-white/20">
        <h2 className="font-medium">Matched issues</h2>
        <p className="mt-2 text-sm opacity-60">
          Nothing indexed yet. Seed the <code>repositories</code> and{" "}
          <code>issues</code> tables, then query{" "}
          <code>match_repositories()</code> to populate this list.
        </p>
      </section>
    </div>
  );
}
