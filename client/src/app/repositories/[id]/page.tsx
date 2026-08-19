import Link from "next/link";

/**
 * Dynamic route placeholder. Note that in Next.js 16 `params` is a Promise and
 * must be awaited — synchronous access was removed.
 */
export default async function RepositoryPage({
  params,
}: PageProps<"/repositories/[id]">) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/recommendations" className="text-sm opacity-60 hover:opacity-100">
        ← Back to recommendations
      </Link>

      <h1 className="text-3xl font-semibold tracking-tight">Repository</h1>
      <p className="font-mono text-sm opacity-60">id: {id}</p>

      <p className="max-w-2xl opacity-70">
        Repository detail and matched issues will render here. Recommendations
        themselves are live on <code>/recommendations</code>; this page is for
        the per-repository view, which needs issue ingestion first.
      </p>
    </div>
  );
}
