"use client";

import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";
import { PracticeAdminHistory } from "@/components/practice-admin-history";
import { getStudyErrorMessage, readStudyJson } from "@/lib/study/client";

export function PracticeAdmin({
  initialAuthenticated,
}: {
  initialAuthenticated: boolean;
}) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleTokenChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setToken(event.target.value),
    []
  );

  const handleLogin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/admin/login", {
          body: JSON.stringify({ token }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        await readStudyJson<{ authenticated: boolean }>(response);
        setAuthenticated(true);
        setToken("");
      } catch (cause) {
        setError(getStudyErrorMessage(cause, "登录失败，请重试。"));
      } finally {
        setBusy(false);
      }
    },
    [token]
  );

  const handleLogout = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      setAuthenticated(false);
    } finally {
      setBusy(false);
    }
  }, []);

  if (!authenticated) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Practice Console
          </p>
          <h1 className="mt-3 text-2xl font-semibold">英语陪练实验后台</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            输入 Cloudflare Worker Secret STUDY_ADMIN_TOKEN 登录。
          </p>
          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            <label
              className="block text-sm font-medium"
              htmlFor="practice-admin-token"
            >
              管理员密钥
            </label>
            <input
              autoComplete="current-password"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              id="practice-admin-token"
              onChange={handleTokenChange}
              placeholder="输入 STUDY_ADMIN_TOKEN"
              required
              type="password"
              value={token}
            />
            {error ? (
              <p className="text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
              disabled={busy || !token}
              type="submit"
            >
              {busy ? "正在登录…" : "登录陪练后台"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#f6f7f9] px-4 py-6 text-slate-900 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Practice Console
            </p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
              英语陪练实验后台
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              只显示低温暖/高温暖陪练实验的参与者记录。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              disabled={busy}
              onClick={handleLogout}
              type="button"
            >
              退出登录
            </button>
          </div>
        </header>
        <PracticeAdminHistory />
      </div>
    </main>
  );
}
