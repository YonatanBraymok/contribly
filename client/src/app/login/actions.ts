"use server";

import { redirect } from "next/navigation";
import { getSiteOrigin, safeNextPath } from "@/lib/site-url";
import { GITHUB_SCOPE_STRING } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Starts the GitHub OAuth flow.
 *
 * Supabase builds the authorize URL rather than redirecting for us, so the
 * browser only leaves for GitHub once we redirect to it. GitHub is the only
 * provider wired up here by design — there is deliberately no password path.
 */
export async function signInWithGitHub(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next"));
  const origin = await getSiteOrigin();

  const callbackUrl = new URL("/login/callback", origin);
  callbackUrl.searchParams.set("next", next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: callbackUrl.toString(),
      scopes: GITHUB_SCOPE_STRING,
    },
  });

  const authorizeUrl = data?.url;

  if (error || !authorizeUrl) {
    console.error("Could not start GitHub OAuth:", error?.message);
    redirect("/login?error=start_failed");
  }

  // Hands the browser to GitHub's consent screen.
  redirect(authorizeUrl);
}

/** Clears the session and returns to the public landing page. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect("/");
}
