import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "TRUSTORA: Trust every transaction",
  description:
    "Programmable trust infrastructure for human and AI-driven work: USDC milestone escrow on Arc, advisory AI evaluation, and independently verifiable evidence.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased text-[#172B4D]">
        <Providers>
          <SiteHeader />
          <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">{children}</main>
          <footer className="mx-auto max-w-6xl border-t border-[#E5EAF1] px-4 pb-10 pt-5 text-xs text-slate-500">
            TRUSTORA · Arc Testnet (chain 5042002) · AI evaluation is advisory only and can never release escrow funds.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
