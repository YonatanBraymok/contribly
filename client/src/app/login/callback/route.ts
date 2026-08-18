import type { Session } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "@/lib/api";
import { getSiteOrigin, safeNextPath } from "@/lib/site-url";
import { GITHUB_SCOPES } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Hands the freshly-minted session to the API.
 *
 * This is the only moment `provider_token` exists: Supabase returns GitHub's
 * access token on the code exchange and then forgets it — it is not stored in
 * the session and no later call can retrieve it. If this does not run, the
 * profile-sync worker has no way to call GitHub as the user.
 *
 * Failures are logged rather than raised. The session is already valid at this
 * point, and refusing to sign someone in because a side-channel write failed
 * trades a working login for a broken one; GET /api/v1/me recreates the profile
 * on the next request, and signing in again re-captures the token.
 */
async function syncSession(session: Session): Promise<void> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        providerToken: session.provider_token ?? undefined,
        scopes: [...GITHUB_SCOPES],
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        `Profile sync failed: ${response.status} ${await response.text()}`,
      );
    }
  } catch (error) {
    console.error("Profile sync failed:", error);
  }
}

/**
 * OAuth callback. Supabase redirects here with `?code=...` after GitHub, and
 * exchanging that code is what actually sets the session cookies.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const origin = await getSiteOrigin();
  const next = safeNextPath(searchParams.get("next"));

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, origin));

  // GitHub sends the user back with an error when they decline consent.
  const providerError = searchParams.get("error");
  if (providerError) {
    return fail(providerError === "access_denied" ? "denied" : "provider_error");
  }

  const code = searchParams.get("code");
  if (!code) {
    return fail("missing_code");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error("Code exchange failed:", error?.message);
    return fail("exchange_failed");
  }

  await syncSession(data.session);

  // Session cookies written during the exchange ride along on this response.
  return NextResponse.redirect(new URL(next, origin));
}
