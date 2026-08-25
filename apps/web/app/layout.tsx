import type { Metadata } from "next";
import { Archivo, Public_Sans, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ThemeProvider, themeInitScript } from "@/lib/theme";
import { WalletContext, WalletButton } from "@/lib/wallet";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/Wordmark";

const display = Archivo({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });
const sans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const mono = Spline_Sans_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://sieveworks.vercel.app"),
  title: { default: "Sieveworks — verifiable distributed search", template: "%s · Sieveworks" },
  description:
    "Pay strangers to search. Prove they did. Fund a brute-force search; contributors run chunks in the browser and get paid per verified chunk on Solana — proving the work costs under 1% of doing it.",
  openGraph: { title: "Sieveworks", description: "Pay strangers to search. Prove they did.", type: "website" },
};

const NAV = [
  ["/bounties", "Bounties"],
  ["/contribute", "Contribute"],
  ["/how-it-works", "How it works"],
  ["/docs", "Docs"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${sans.variable} ${display.variable} ${mono.variable} min-h-screen antialiased`}>
        <ThemeProvider>
          <WalletContext>
            <header className="border-b border-[var(--border)] sticky top-0 z-20 backdrop-blur-md"
              style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}>
              <div className="mx-auto max-w-[1180px] px-5 sm:px-7 h-[58px] flex items-center gap-7">
                <Link href="/" className="flex items-center gap-2.5 text-[var(--text)]">
                  <Wordmark />
                  <span className="font-display font-extrabold text-[15px] tracking-[0.1em] uppercase">Sieveworks</span>
                </Link>
                <nav className="hidden sm:flex gap-[22px] ml-auto items-center text-[13.5px] font-medium">
                  {NAV.map(([href, label]) => (
                    <Link key={href} href={href} className="text-[var(--text-dim)] hover:text-[var(--text)]">{label}</Link>
                  ))}
                  <ThemeToggle />
                  <WalletButton />
                </nav>
                <div className="ml-auto sm:hidden flex items-center gap-2">
                  <ThemeToggle />
                  <WalletButton />
                </div>
              </div>
            </header>
            <main>{children}</main>
          </WalletContext>
        </ThemeProvider>
      </body>
    </html>
  );
}
