import Link from "next/link";
import { ArrowRight, Bot, Check, ChevronRight, CircleDollarSign, FileCheck2, LockKeyhole, ScanSearch, ShieldCheck, Waypoints } from "lucide-react";

const steps = [
  { icon: FileCheck2, title: "Agree", body: "Criteria are written down, hashed, and accepted by both parties." },
  { icon: LockKeyhole, title: "Fund", body: "Clients fund milestones in USDC through the Arc escrow contract." },
  { icon: ScanSearch, title: "Work & evaluate", body: "Deliverables are anchored and can receive an advisory 0G review." },
  { icon: ShieldCheck, title: "Verify & release", body: "The client controls release. ProofTrack records verified evidence." },
];

export default function Landing() {
  return <div className="space-y-20 pb-10 sm:space-y-28">
    <section className="relative overflow-hidden rounded-3xl border border-[#E5EAF1] bg-white px-6 py-14 shadow-sm sm:px-12 sm:py-20 lg:px-16">
      <div className="absolute right-[-4rem] top-[-5rem] hidden h-80 w-80 rounded-full bg-[#EAF0FF] blur-3xl sm:block" aria-hidden />
      <div className="relative max-w-3xl">
        <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#D9E3F3] bg-[#F8FAFC] px-3 py-1.5 text-xs font-semibold uppercase tracking-[.12em] text-[#3867F6]"><span className="h-2 w-2 rounded-full bg-[#3867F6]"/>Programmable trust infrastructure</p>
        <h1 className="text-4xl font-semibold leading-[1.08] tracking-[-.04em] text-[#172B4D] sm:text-6xl">Trust every transaction.<br/><span className="text-[#3867F6]">Secure every promise.</span></h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">Secure milestone payments, evaluate deliverables with AI, and verify every transaction across blockchain ecosystems.</p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/projects/new" className="inline-flex items-center gap-2 rounded-lg bg-[#3867F6] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2854DB]">Start a project <ArrowRight className="h-4 w-4"/></Link>
          <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-lg border border-[#D8E0EB] bg-white px-5 py-3 text-sm font-semibold text-[#172B4D] hover:bg-slate-50">Explore dashboard</Link>
        </div>
        <div className="mt-11 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Agree <ChevronRight className="h-3.5 w-3.5 text-slate-300"/> Fund <ChevronRight className="h-3.5 w-3.5 text-slate-300"/> Work <ChevronRight className="h-3.5 w-3.5 text-slate-300"/> Evaluate <ChevronRight className="h-3.5 w-3.5 text-slate-300"/> Verify <ChevronRight className="h-3.5 w-3.5 text-slate-300"/> Release</div>
      </div>
    </section>

    <section className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-start">
      <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#3867F6]">A clear process</p><h2 className="mt-3 max-w-md text-3xl font-semibold tracking-tight text-[#172B4D]">A shared agreement. A verifiable outcome.</h2><p className="mt-4 max-w-md leading-7 text-slate-600">Trustora coordinates the agreement, milestone escrow, evaluation and evidence trail. Decisions over payment remain with people.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">{steps.map((s,i)=><article key={s.title} className="glass-card rounded-xl p-5"><div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EEF3F8] text-[#3867F6]"><s.icon className="h-5 w-5"/></span><span className="text-xs font-semibold text-slate-400">0{i+1}</span></div><h3 className="mt-5 font-semibold text-[#172B4D]">{s.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{s.body}</p></article>)}</div>
    </section>

    <section>
      <div className="mb-6 max-w-xl"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#3867F6]">Three technology tracks</p><h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#172B4D]">Built around evidence and control.</h2></div>
      <div className="grid gap-4 md:grid-cols-3">
        {[{icon:CircleDollarSign,name:"ARC",title:"Milestone escrow",body:"USDC funding and client-authorized release on Arc Testnet."},{icon:Bot,name:"0G",title:"AI-assisted review",body:"Criteria-based deliverable evaluations. Advisory only; never a payment authority."},{icon:Waypoints,name:"PROOFTRACK",title:"Correlated evidence",body:"A project timeline that distinguishes verified events from pending records."}].map((x)=><article key={x.name} className="glass-card rounded-xl p-6"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EEF3F8] text-[#3867F6]"><x.icon className="h-5 w-5"/></div><p className="mt-5 text-xs font-semibold tracking-[.14em] text-[#3867F6]">{x.name}</p><h3 className="mt-1 text-lg font-semibold text-[#172B4D]">{x.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{x.body}</p></article>)}
      </div>
    </section>

    <section className="grid gap-8 rounded-2xl border border-[#DCE5F2] bg-[#EEF3F8] p-6 sm:p-9 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex gap-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[#3867F6]"><LockKeyhole className="h-5 w-5"/></div><div><h2 className="text-xl font-semibold text-[#172B4D]">AI can advise. It can never pay.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Only the client’s wallet can authorize milestone release. AI reports inform the review, while the backend verifies on-chain receipts and records evidence.</p></div></div>
      <Link href="/dashboard" className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-[#3867F6] hover:text-[#2854DB]">View the dashboard <ArrowRight className="h-4 w-4"/></Link>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#E5EAF1] pt-8 text-xs text-slate-500"><span>TRUSTORA · Trust Every Transaction. Secure Every Promise.</span><span className="inline-flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600"/> Human-authorized escrow</span></div>
  </div>;
}
