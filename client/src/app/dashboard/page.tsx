import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your GitHub profile signals and learning goals.",
};

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="max-w-2xl opacity-70">
          Connect GitHub to derive your stack automatically, then tell Contribly
          where you want to grow.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <article className="rounded-xl border border-black/10 p-6 dark:border-white/15">
          <h2 className="font-medium">Detected stack</h2>
          <p className="mt-2 text-sm opacity-60">
            Populated from your commit history once GitHub OAuth is wired up.
          </p>
          <p className="mt-4 font-mono text-xs opacity-50">
            Awaiting profile sync
          </p>
        </article>

        <article className="rounded-xl border border-black/10 p-6 dark:border-white/15">
          <h2 className="font-medium">Learning goals</h2>
          <p className="mt-2 text-sm opacity-60">
            Free-text goals get embedded and blended into the match query.
          </p>
          <p className="mt-4 font-mono text-xs opacity-50">No goals set yet</p>
        </article>
      </section>
    </div>
  );
}
