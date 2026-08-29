"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  ["/bounties", "Bounties"],
  ["/contribute", "Contribute"],
  ["/modules", "Modules"],
  ["/how-it-works", "How it works"],
  ["/docs", "Docs"],
] as const;

/** Header nav with the current section highlighted (brass + drawn underline).
 * aria-current drives both the styling (globals.css) and screen readers. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {NAV.map(([href, label]) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="navlink text-[var(--text-dim)] hover:text-[var(--text)]"
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
