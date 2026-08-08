/**
 * Supabase connection details, plus the shape of the GitHub grant we ask for.
 *
 * Both values are safe in the browser: the URL is public and the anon key is
 * only as powerful as the row level security policies allow. The service-role
 * key is never read here — it belongs to the API alone.
 */

/**
 * GitHub OAuth scopes.
 *
 * `read:user` covers the profile signals that drive matching; `user:email`
 * gets a verified address even when the user keeps it private. Neither grants
 * access to private repositories, which keeps the consent screen easy to say
 * yes to. Widening this means widening what the consent screen asks for, so
 * change it deliberately.
 */
export const GITHUB_SCOPES = ["read:user", "user:email"] as const;

export const GITHUB_SCOPE_STRING = GITHUB_SCOPES.join(" ");

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy client/.env.example to client/.env.local and fill in your Supabase project details.`,
    );
  }

  return value;
}

export function supabaseUrl(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

export function supabaseAnonKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/** True when both values are present, so callers can degrade instead of throwing. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
