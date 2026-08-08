/**
 * Base URL for the Contribly API.
 *
 * Server Components resolve the API over the Docker network (`http://server:4000`),
 * while the browser must reach the published port on the host. Picking the right
 * one here keeps callers from having to care.
 */
export function getApiBaseUrl(): string {
  const isServer = typeof window === "undefined";

  if (isServer) {
    return (
      process.env.API_INTERNAL_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:4000"
    );
  }

  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Thin fetch wrapper that returns a result object instead of throwing, so pages
 * can render a degraded state when the API is down rather than erroring out.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const url = `${getApiBaseUrl()}${path}`;

  try {
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      // Health and recommendation data are request-scoped; never serve stale.
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, error: `${response.status} ${response.statusText}` };
    }

    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown network error",
    };
  }
}
