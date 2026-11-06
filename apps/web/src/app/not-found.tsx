import Link from "next/link";

export default function NotFound() {
  return (
    <div className="glass-card mx-auto max-w-lg rounded-xl p-8 text-center">
      <p className="text-4xl font-bold text-[#3867F6]">404</p>
      <h1 className="mt-2 text-lg font-semibold text-[#172B4D]">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">That page does not exist.</p>
      <Link href="/" className="mt-5 inline-block rounded-lg bg-[#3867F6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2854DB]">Back to home</Link>
    </div>
  );
}
