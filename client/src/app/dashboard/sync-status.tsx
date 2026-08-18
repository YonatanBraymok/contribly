"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { SyncStatus as Status } from "@/lib/api-server";
import { pollSync, retrySync } from "@/lib/profile-actions";

const POLL_INTERVAL_MS = 2500;

function relative(iso: string | null): string {
  if (!iso) {
    return "never";
  }

  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;

  return `${Math.round(minutes / 1440)}d ago`;
}

/**
 * Live state of the background profile analysis.
 *
 * Polls only while something is actually running, then calls router.refresh()
 * once — the page is a Server Component, so a refresh is what pulls the newly
 * derived stack, languages and complexity into the rest of the dashboard
 * without a full reload or a second copy of that data living in the client.
 */
export function SyncStatus({
  status,
  error,
  lastSyncedAt,
}: {
  status: Status;
  error: string | null;
  lastSyncedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Local state so the poller can move the indicator between server renders,
  // reset whenever the server sends something newer.
  const [live, setLive] = useState<{ status: Status; error: string | null }>({
    status,
    error,
  });
  const [fromServer, setFromServer] = useState({ status, error });

  // Adjusting state during render rather than in an effect: the server is the
  // source of truth, and reconciling it in an effect would render once with the
  // stale value before correcting itself.
  if (fromServer.status !== status || fromServer.error !== error) {
    setFromServer({ status, error });
    setLive({ status, error });
  }

  const current = live.status;
  const message = live.error;
  const running = current === "running" || current === "pending";

  useEffect(() => {
    if (!running) {
      return;
    }

    let cancelled = false;

    const id = setInterval(async () => {
      const snapshot = await pollSync();

      if (cancelled) {
        return;
      }

      setLive({ status: snapshot.sync_status, error: snapshot.sync_error });

      if (snapshot.sync_status !== "running" && snapshot.sync_status !== "pending") {
        router.refresh();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [running, router]);

  const resync = () =>
    startTransition(async () => {
      const result = await retrySync();

      if (result.ok) {
        setLive({ status: "running", error: null });
      } else {
        setLive({
          status: current,
          error: result.error ?? "Could not start the analysis",
        });
      }
    });

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-black/10 px-5 py-3 dark:border-white/15">
      <div className="flex items-center gap-3 text-sm">
        {running ? (
          <>
            <span
              aria-hidden
              className="h-2 w-2 animate-pulse rounded-full bg-brand-bright"
            />
            <span>Reading your GitHub activity…</span>
          </>
        ) : current === "failed" ? (
          <>
            <span aria-hidden className="h-2 w-2 rounded-full bg-red-500" />
            <span>Analysis failed{message ? ` — ${message}` : ""}</span>
          </>
        ) : (
          <>
            <span aria-hidden className="h-2 w-2 rounded-full bg-brand-muted" />
            <span className="opacity-70">
              Profile analysed {relative(lastSyncedAt)}
            </span>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={resync}
        disabled={pending || running}
        className="rounded-full border border-black/15 px-4 py-1.5 text-xs transition-colors hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
      >
        {running ? "Running…" : "Re-analyse"}
      </button>
    </div>
  );
}
