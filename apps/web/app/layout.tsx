import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/lib/theme";
import { WalletContext, WalletButton } from "@/lib/wallet";
import { ThemeToggle } from "@/components/ThemeToggle";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sieveworks — verifiable search",
  description: "An exchange for verifiable search. Hard to find, easy to check.",
};

const NAV = [
  ["/jobs", "bounties"],
  ["/contribute", "contribute"],
  ["/finds", "finds"],
  ["/leaderboard", "leaderboard"],
  ["/docs", "docs"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${sans.variable} ${mono.variable} min-h-screen antialiased`}>
        <ThemeProvider>
          <WalletContext>
            <header className="border-b border-[var(--border)] px-4 py-2 flex items-center gap-6 sticky top-0 bg-[var(--bg)] z-20">
              <Link href="/" className="font-semibold tracking-tight">
                sieveworks
              </Link>
              <nav className="flex gap-4 text-sm text-[var(--text-dim)]">
                {NAV.map(([href, label]) => (
                  <Link key={href} href={href} className="hover:text-[var(--text)]">
                    {label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-2">
                <ThemeToggle />
                <WalletButton />
              </div>
            </header>
            <main className="px-4 py-6">{children}</main>
          </WalletContext>
        </ThemeProvider>
      </body>
    </html>
  );
}
