import Link from "next/link";

const steps = [
  {
    title: "Analyze your profile",
    body: "We read your GitHub activity — languages, commit history, and the complexity of what you already ship.",
  },
  {
    title: "Capture your goals",
    body: "Tell us what you want to learn next. Rust? Distributed systems? Your goals steer the match, not just your history.",
  },
  {
    title: "Match semantically",
    body: "Repositories and issues are embedded into a pgvector index, so we surface work that fits — not just what is trending.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-16">
      <section className="flex flex-col gap-6">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Find the open-source issue worth your next weekend.
        </h1>
        <p className="max-w-2xl text-lg opacity-70">
          Contribly matches your GitHub profile and learning goals against a
          curated vector index of repositories and their open issues — so your
          next contribution moves you forward.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/recommendations"
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85"
          >
            See recommendations
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Set up your profile
          </Link>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {steps.map((step, index) => (
          <article
            key={step.title}
            className="rounded-xl border border-black/10 p-5 dark:border-white/15"
          >
            <span className="font-mono text-xs opacity-50">0{index + 1}</span>
            <h2 className="mt-2 font-medium">{step.title}</h2>
            <p className="mt-2 text-sm opacity-70">{step.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
