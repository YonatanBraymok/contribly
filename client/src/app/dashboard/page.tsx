import type { Metadata } from "next";
import Image from "next/image";
import { fetchProfile } from "@/lib/api-server";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your GitHub profile signals and learning goals.",
};

/** Reached only with a session — proxy.ts redirects everyone else to /login. */
export default async function DashboardPage() {
  const result = await fetchProfile();
  const profile = result.ok ? result.data.profile : null;

  return (
    <div className="flex flex-col gap-10">
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

      {!result.ok && (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
        >
          Could not load your profile — {result.error}. The session is valid;
          this is the API call failing.
        </p>
      )}

      <section className="grid gap-6 md:grid-cols-2">
        <article className="rounded-xl border border-black/10 p-6 dark:border-white/15">
          <h2 className="font-medium">Detected stack</h2>
          <p className="mt-2 text-sm opacity-60">
            Derived from your commit history by the profile-sync worker.
          </p>
          {profile?.tech_stack.length ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {profile.tech_stack.map((tech) => (
                <li
                  key={tech}
                  className="rounded-full bg-contrib-2/15 px-3 py-1 font-mono text-xs"
                >
                  {tech}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 font-mono text-xs opacity-50">
              Awaiting profile sync
            </p>
          )}
        </article>

        <article className="rounded-xl border border-black/10 p-6 dark:border-white/15">
          <h2 className="font-medium">Learning goals</h2>
          <p className="mt-2 text-sm opacity-60">
            Free-text goals get embedded and blended into the match query.
          </p>
          {profile?.learning_goals.length ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {profile.learning_goals.map((goal) => (
                <li
                  key={goal}
                  className="rounded-full border border-black/15 px-3 py-1 text-xs dark:border-white/20"
                >
                  {goal}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 font-mono text-xs opacity-50">No goals set yet</p>
          )}
        </article>
      </section>

      {profile && (
        <section className="rounded-xl border border-black/10 p-6 dark:border-white/15">
          <h2 className="font-medium">Matching signals</h2>
          <dl className="mt-4 grid gap-3 font-mono text-xs sm:grid-cols-3">
            <div>
              <dt className="opacity-50">complexity</dt>
              <dd>{profile.complexity_level}</dd>
            </div>
            <div>
              <dt className="opacity-50">github id</dt>
              <dd>{profile.github_id ?? "—"}</dd>
            </div>
            <div>
              <dt className="opacity-50">last synced</dt>
              <dd>{profile.last_synced_at ?? "never"}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
