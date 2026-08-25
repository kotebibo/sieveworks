import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Mono, Inter } from "next/font/google";
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
// Display face — an angular technical HUD font; carries the console identity.
const display = Chakra_Petch({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
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
      <body className={`${sans.variable} ${mono.variable} ${display.variable} min-h-screen antialiased`}>
        <ThemeProvider>
          <WalletContext>
            <header className="border-b border-[var(--border)] sticky top-0 bg-[var(--bg)] z-20">
              <div className="flex items-center gap-6 px-4 h-11">
                <Link href="/" className="font-display font-bold tracking-tight text-[15px] flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-[var(--accent)]" style={{ boxShadow: "0 0 8px var(--accent)" }} />
                  SIEVEWORKS
                </Link>
                <nav className="hidden sm:flex gap-5 text-[13px] text-[var(--text-dim)] font-display tracking-wide">
                  {NAV.map(([href, label]) => (
                    <Link key={href} href={href} className="hover:text-[var(--accent)] uppercase">
                      {label}
                    </Link>
                  ))}
                </nav>
                <div className="ml-auto flex items-center gap-2">
                  <ThemeToggle />
                  <WalletButton />
                </div>
              </div>
            </header>
            <main className="px-3 sm:px-4 py-4">{children}</main>
          </WalletContext>
        </ThemeProvider>
      </body>
    </html>
  );
}
