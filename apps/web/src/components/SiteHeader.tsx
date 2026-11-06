"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bot, CircleDollarSign, FileCheck2, LayoutDashboard, Menu, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { WalletButton } from "./WalletButton";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FileCheck2 },
  { href: "/projects/new", label: "Create project", icon: CircleDollarSign },
  { href: "/dashboard#integrations", label: "AI Evaluation", icon: Bot },
  { href: "/dashboard#integrations", label: "ProofTrack", icon: Activity },
  { href: "/agent-payments", label: "Agent Payments", icon: SlidersHorizontal },
];

/** A link is active on its own page; "Projects" also stays active inside a project but not on "New project". */
function isActive(pathname: string, href: string): boolean {
  if (href === "/projects") return pathname === "/projects" || (pathname.startsWith("/projects/") && pathname !== "/projects/new");
  return pathname === href;
}

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = (mobile: boolean) =>
    links.map((l) => {
      const active = isActive(pathname, l.href);
      return (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active ? "page" : undefined}
          onClick={() => setMobileOpen(false)}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${mobile ? "" : ""} ${
            active ? "bg-[#EAF0FF] font-medium text-[#2854DB]" : "text-slate-600 hover:bg-slate-100 hover:text-[#172B4D]"
          }`}
        >
          <l.icon className="h-4 w-4 shrink-0" />{l.label}
        </Link>
      );
    });

  return (
    <header className="sticky top-0 z-30 border-b border-[#E5EAF1] bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-lg font-bold tracking-tight text-[#172B4D]">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3867F6] text-white"><ShieldCheck className="h-5 w-5" /></span> TRUSTORA
        </Link>
        <nav className="hidden items-center gap-1 xl:flex" aria-label="Main">{nav(false)}</nav>
        <div className="ml-auto flex items-center gap-3"><span className="hidden items-center gap-2 rounded-full border border-[#E5EAF1] bg-[#F8FAFC] px-3 py-2 text-xs font-medium text-slate-600 sm:inline-flex"><span className="h-2 w-2 rounded-full bg-emerald-500"/> Arc Testnet</span><WalletButton /></div>
        <button type="button" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E5EAF1] text-slate-600 xl:hidden">{mobileOpen ? <X className="h-5 w-5"/> : <Menu className="h-5 w-5"/>}</button>
      </div>
      {mobileOpen && <nav className="grid gap-1 border-t border-[#E5EAF1] bg-white px-4 py-3 xl:hidden" aria-label="Mobile main">{nav(true)}</nav>}
    </header>
  );
}
