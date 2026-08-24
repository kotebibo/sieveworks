import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sieveworks",
  description: "An exchange for verifiable search. Hard to find, easy to check.",
};

const NAV = [
  ["/jobs", "bounties"],
  ["/contribute", "contribute"],
  ["/finds", "finds"],
  ["/docs", "docs"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--border)] px-4 py-2 flex items-baseline gap-6">
          <Link href="/" className="font-semibold tracking-tight">
            sieveworks
          </Link>
          <nav className="flex gap-4 text-sm text-[var(--muted)]">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="hover:text-[var(--foreground)]">
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
