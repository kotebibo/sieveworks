import type { Metadata } from "next";
import { Inter, Nunito, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { WalletContext } from "@/lib/wallet";
import { AuthProvider } from "@/lib/auth";
import { AuthButton } from "@/components/AuthButton";
import { Wordmark } from "@/components/Wordmark";
import { NavLinks } from "@/components/NavLinks";
import { ClientChrome } from "@/components/ClientChrome";

// Daylight Arcade type: Nunito (rounded, confident display) + Inter (body) +
// Spline Sans Mono (tabular numbers). Friendly but precise.
const display = Nunito({ subsets: ["latin"], weight: ["600", "700", "800", "900"], variable: "--font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = Spline_Sans_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://sievework.com"),
  title: { default: "Sieveworks · a compute network you can trust", template: "%s · Sieveworks" },
  description:
    "A supercomputer's worth of work, done by a crowd, for a fraction of the cost. Post a job or earn with your computer: a crowd runs huge searches, every result is verified, settled on Solana. Proving the work costs about 1%, not 200%.",
  openGraph: { title: "Sieveworks", description: "A supercomputer's worth of work, done by a crowd. Every result verified, settled on Solana.", type: "website" },
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${sans.variable} ${display.variable} ${mono.variable} min-h-screen antialiased`}>
        <WalletContext>
          <AuthProvider>
            <ClientChrome />
            <header className="border-b border-[var(--border)] sticky top-0 z-20 backdrop-blur-md"
              style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}>
              <div className="mx-auto max-w-[1180px] px-5 sm:px-7 h-[58px] flex items-center gap-7">
                <Link href="/" className="flex items-center gap-2.5 text-[var(--text)]">
                  <Wordmark />
                  <span className="font-display font-extrabold text-[15px] tracking-[0.1em] uppercase">Sieveworks</span>
                </Link>
                <nav className="hidden sm:flex gap-[22px] ml-auto items-center text-[13.5px] font-medium">
                  <NavLinks />
                  <AuthButton />
                </nav>
                <div className="ml-auto sm:hidden flex items-center gap-2">
                  <AuthButton />
                </div>
              </div>
            </header>
            <main>{children}</main>
          </AuthProvider>
        </WalletContext>
      </body>
    </html>
  );
}
