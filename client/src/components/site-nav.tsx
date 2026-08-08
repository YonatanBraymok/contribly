import Link from "next/link";
import { Logo } from "@/components/logo";

const links = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/recommendations", label: "Recommendations" },
] as const;

export function SiteNav() {
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
        <ul className="flex items-center gap-5 text-sm">
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
      </nav>
    </header>
  );
}
