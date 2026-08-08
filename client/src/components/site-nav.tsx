import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/recommendations", label: "Recommendations" },
] as const;

export function SiteNav() {
  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Contribly
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
