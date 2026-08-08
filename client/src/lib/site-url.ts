import { headers } from "next/headers";

/**
 * Absolute origin for this deployment.
 *
 * OAuth redirect URLs have to be absolute, and they have to match what the
 * GitHub app and Supabase have registered. Prefer the configured value; fall
 * back to the request headers so local development works with no setup.
 */
export async function getSiteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const headerList = await headers();
  // Behind Docker or a reverse proxy the original host survives only here.
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "localhost:3000";
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${protocol}://${host}`;
}

/**
 * Sanitises a `next` parameter before redirecting to it.
 *
 * Anything but a same-site absolute path is discarded. Without this, a crafted
 * `?next=https://evil.example` would turn the sign-in flow into an open
 * redirect — the classic phishing lever on an OAuth callback. Note `//host`
 * is protocol-relative and must be rejected too.
 */
export function safeNextPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value) {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
}
