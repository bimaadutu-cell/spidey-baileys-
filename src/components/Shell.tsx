"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "./hooks";
import { Avatar } from "./avatar";
import { GlobalChat } from "./global-chat";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

const NAV = [
  { href: "/", label: "Home", icon: "◆" },
  { href: "/discover", label: "Discover", icon: "▶" },
  { href: "/premium-alight", label: "Premium", icon: "✦" },
  { href: "/ulasan", label: "Ulasan", icon: "★" },
  { href: "/account", label: "Akun", icon: "☺" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, reload } = useSession();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    router.push(term ? `/?q=${encodeURIComponent(term)}` : "/");
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await reload();
    router.push("/");
  };

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 glass border-b border-white/10">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:gap-5 sm:px-6">
          <Link href="/" className="group flex items-center gap-2.5 shrink-0">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-white to-slate-300 text-[15px] font-black text-black shadow-[0_10px_30px_-12px_rgba(255,255,255,0.8)]">
              预
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-[15px] font-bold neon-text">预设空间</span>
              <span className="block text-[10px] tracking-[0.22em] text-slate-400">PRESET SPACE</span>
            </span>
          </Link>

          <form onSubmit={submitSearch} className="relative flex-1">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari preset, kreator, sound…"
              aria-label="Cari preset"
              className="w-full rounded-full border border-white/12 bg-white/5 px-4 py-2.5 pr-11 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-white/35 focus:bg-white/8"
            />
            <button
              type="submit"
              aria-label="Cari"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/20"
            >
              ⌕
            </button>
          </form>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3.5 py-2 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            {user?.role === "admin" || user?.role === "developer" ? (
              <Link
                href="/admin"
                className="rounded-full px-3.5 py-2 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                Admin
              </Link>
            ) : null}
          </nav>

          <div className="flex items-center gap-2">
            {installEvent ? (
              <button
                onClick={() => {
                  void installEvent.prompt();
                  setInstallEvent(null);
                }}
                className="chip hidden sm:inline-flex"
                title="Instal aplikasi"
              >
                ⤓ Install
              </button>
            ) : null}

            {user ? (
              <div className="flex items-center gap-2">
                <Link href="/account" className="flex items-center gap-2 rounded-full border border-white/12 bg-white/5 py-1 pl-1 pr-3 transition hover:border-white/30">
                  <Avatar seed={user.avatarKey || user.username} size={28} />
                  <span className="hidden text-xs font-medium text-slate-200 sm:block">
                    {user.displayName || user.username}
                  </span>
                </Link>
                <button onClick={() => void logout()} className="hidden rounded-full border border-white/12 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 sm:block">
                  Keluar
                </button>
              </div>
            ) : (
              <Link href="/login" className="btn btn-primary !py-2 !text-xs">
                Login
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-16">{children}</main>

      <footer className="safe-bottom glass border-t border-white/10 px-4 py-6 text-center text-xs text-slate-500">
        <p>
          预设空间 | Preset Space — <span className="text-slate-300">Find it. Preset it. Create it.</span>
        </p>
        <p className="mt-1">Developer BimzOfficial ✓ · Preset ditemukan dari konten publik TikTok, bukan konten milik Preset Space.</p>
      </footer>

      <MobileNav isAdmin={user?.role === "admin" || user?.role === "developer"} />
      <GlobalChat onChanged={reload} />
    </div>
  );
}

function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const items = [...NAV, ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: "⚙" }] : [])];
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 glass border-t border-white/10 md:hidden">
      <div className="mx-auto flex max-w-md items-center justify-around px-3 py-2">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] text-slate-400 transition active:scale-95 hover:text-white"
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
