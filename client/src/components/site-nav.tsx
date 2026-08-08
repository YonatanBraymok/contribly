import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { Logo } from "@/components/logo";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSessionUser } from "@/lib/supabase/server";

/** Only reachable with a session, so they stay hidden until there is one. */
const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/recommendations", label: "Recommendations" },
] as const;

export async function SiteNav() {
  // Never throws on a missing session — returns null, which is the signed-out
  // state. Guarded on configuration so an unconfigured deployment still renders.
  const user = isSupabaseConfigured() ? await getSessionUser() : null;

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const username = (user?.user_metadata?.user_name ??
    user?.user_metadata?.preferred_username) as string | undefined;

  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-4">
        <Link
          href="/"
          aria-label="Contribly — home"
          className="shrink-0 transition-opacity hover:opacity-80"
        >
          {/* The lockup is roughly 9:1, so narrow screens get the mark alone,
              sized to take no more width than the wordmark it replaced. */}
          <Logo variant="mark" label={null} className="h-4 w-auto sm:hidden" />
          <Logo
            variant="full"
            label={null}
            className="hidden h-6 w-auto sm:block"
          />
        </Link>

        {user ? (
          <div className="flex items-center gap-5 text-sm">
            <ul className="flex items-center gap-5">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="opacity-70 transition-opacity hover:opacity-100"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-3">
              {avatarUrl && (
                <Image
                  src={avatarUrl}
                  alt=""
                  width={28}
                  height={28}
                  className="rounded-full"
                  // GitHub avatars are already sized and cached upstream.
                  unoptimized
                />
              )}
              <span className="hidden opacity-70 sm:inline">{username}</span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="opacity-70 transition-opacity hover:opacity-100"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        ) : (
          <Link
            href="/auth"
            className="rounded-full border border-black/15 px-4 py-1.5 text-sm font-medium transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
