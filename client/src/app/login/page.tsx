import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { safeNextPath } from "@/lib/site-url";
import { GITHUB_SCOPES, isSupabaseConfigured } from "@/lib/supabase/config";
import { signInWithGitHub } from "./actions";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Contribly with your GitHub account.",
};

/**
 * Failure reasons set by the callback, the sign-in action and proxy.ts.
 * Anything unrecognised falls through to a generic message rather than being
 * echoed back — the value arrives in a query string and is attacker-controlled.
 */
const ERROR_MESSAGES: Record<string, string> = {
  denied:
    "You declined the GitHub authorisation. Contribly needs read access to your public profile to work out what to recommend.",
  provider_error:
    "GitHub could not complete the sign-in. This is usually temporary — try again.",
  missing_code:
    "That sign-in link was incomplete. Start again from this page.",
  exchange_failed:
    "We could not verify the sign-in with GitHub. Try again, and check the Supabase GitHub provider settings if it keeps happening.",
  start_failed:
    "Could not reach GitHub to begin sign-in. Try again in a moment.",
  unconfigured:
    "Authentication is not configured on this deployment yet.",
};

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const configured = isSupabaseConfigured();

  const rawError = searchParams.error;
  const errorKey = typeof rawError === "string" ? rawError : undefined;
  const errorMessage = errorKey
    ? (ERROR_MESSAGES[errorKey] ?? "Something went wrong signing you in.")
    : undefined;

  // Preserved through the round trip so people land where they were headed.
  const next = safeNextPath(searchParams.next);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-8 py-10">
      <Logo variant="mark" label={null} className="h-6 w-auto" />

      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign in to Contribly
        </h1>
        <p className="text-sm opacity-70">
          Contribly reads your GitHub profile to work out what you build and
          where you could grow, so GitHub is the only way in.
        </p>
      </div>

      {errorMessage && (
        <p
          role="alert"
          className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {errorMessage}
        </p>
      )}

      {configured ? (
        <form action={signInWithGitHub} className="w-full">
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2.5 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
          >
            <GitHubMark />
            Continue with GitHub
          </button>
        </form>
      ) : (
        <div className="w-full rounded-lg border border-dashed border-black/20 p-4 text-sm dark:border-white/25">
          <p className="font-medium">Supabase is not configured</p>
          <p className="mt-2 opacity-70">
            Set <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            and{" "}
            <code className="font-mono text-xs">
              NEXT_PUBLIC_SUPABASE_ANON_KEY
            </code>
            , then enable the GitHub provider in your Supabase project. See{" "}
            <code className="font-mono text-xs">client/.env.example</code>.
          </p>
        </div>
      )}

      <p className="text-center text-xs opacity-50">
        We ask for {GITHUB_SCOPES.join(" and ")} — your public profile and
        email address. Contribly never requests access to private repositories
        and never writes to your account.
      </p>
    </div>
  );
}
