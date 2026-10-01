"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type AdminSession = {
  condition: "a" | "b";
  createdAt: string;
  endedAt: string | null;
  id: string;
  messageCount: number;
  model: string;
  startedAt: string | null;
  userId: string;
};

type AdminMessage = {
  content: string;
  createdAt: string;
  id: string;
  role: "user" | "assistant";
  sequence: number;
};

type AdminSessionDetail = Omit<AdminSession, "messageCount"> & {
  messages: AdminMessage[];
};

type ApiKeyStatus = {
  configured: boolean;
  fallbackAvailable: boolean;
  source: "admin" | "environment" | "none" | "unavailable";
  updatedAt: string | null;
};

type SessionPage = {
  page: number;
  pageSize: number;
  sessions: AdminSession[];
  total: number;
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

async function readError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return data?.error ?? fallback;
}

export function StudyAdmin({
  initialAuthenticated,
}: {
  initialAuthenticated: boolean;
}) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [token, setToken] = useState("");
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [condition, setCondition] = useState("all");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [confirmKeyReset, setConfirmKeyReset] = useState(false);
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<
    string | null
  >(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const lastPage = Math.max(1, Math.ceil(total / 20));
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? null,
    [sessions, selectedId]
  );

  const loadSessions = useCallback(
    async (nextPage: number, nextCondition: string, nextQuery: string) => {
      setListBusy(true);
      setError("");
      try {
        const params = new URLSearchParams({
          condition: nextCondition,
          page: String(nextPage),
        });
        if (nextQuery) {
          params.set("q", nextQuery);
        }
        const response = await fetch(`/api/admin/study-sessions?${params}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await readError(response, "读取历史记录失败。"));
        }
        const data = (await response.json()) as SessionPage;
        setSessions(data.sessions);
        setTotal(data.total);
        setPage(data.page);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "读取历史记录失败。");
      } finally {
        setListBusy(false);
      }
    },
    []
  );

  const loadKeyStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/api-key", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readError(response, "无法读取 API Key 状态。"));
      }
      setKeyStatus((await response.json()) as ApiKeyStatus);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "无法读取 API Key 状态。"
      );
    }
  }, []);

  const handleTokenChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setToken(event.target.value),
    []
  );
  const handleApiKeyChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setApiKey(event.target.value),
    []
  );
  const handleQueryInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setQueryInput(event.target.value),
    []
  );
  const handleConditionChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setCondition(event.target.value);
      setPage(1);
    },
    []
  );
  const handleSessionListClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (event.currentTarget.dataset.sessionId) {
        setSelectedId(event.currentTarget.dataset.sessionId);
      }
    },
    []
  );

  useEffect(() => {
    if (!authenticated) {
      return;
    }
    loadSessions(1, condition, query);
    loadKeyStatus();
  }, [authenticated, condition, loadKeyStatus, loadSessions, query]);

  useEffect(() => {
    if (!sessions.length) {
      setSelectedId(null);
      setDetail(null);
      return;
    }
    if (!sessions.some((session) => session.id === selectedId)) {
      setSelectedId(sessions[0].id);
    }
  }, [selectedId, sessions]);

  useEffect(() => {
    if (!authenticated || !selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailBusy(true);
    setError("");
    fetch(
      `/api/admin/study-sessions?sessionId=${encodeURIComponent(selectedId)}`,
      { cache: "no-store" }
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readError(response, "读取对话详情失败。"));
        }
        return (await response.json()) as AdminSessionDetail;
      })
      .then((data) => {
        if (active) {
          setDetail(data);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "读取对话详情失败。"
          );
        }
      })
      .finally(() => {
        if (active) {
          setDetailBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [authenticated, selectedId]);

  const handleLogin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setLoginBusy(true);
      setError("");
      try {
        const response = await fetch("/api/admin/login", {
          body: JSON.stringify({ token }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) {
          throw new Error(await readError(response, "管理员登录失败。"));
        }
        setToken("");
        setAuthenticated(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "管理员登录失败。");
      } finally {
        setLoginBusy(false);
      }
    },
    [token]
  );

  const handleLogout = useCallback(async () => {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    setAuthenticated(false);
    setSessions([]);
    setSelectedId(null);
    setDetail(null);
    setKeyStatus(null);
    setNotice("");
  }, []);

  const handleSaveApiKey = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!apiKey.trim()) {
        setError("请输入新的 DeepSeek API Key。");
        return;
      }
      setKeyBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/admin/api-key", {
          body: JSON.stringify({ apiKey }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        });
        if (!response.ok) {
          throw new Error(await readError(response, "保存 API Key 失败。"));
        }
        setKeyStatus((await response.json()) as ApiKeyStatus);
        setApiKey("");
        setNotice("DeepSeek API Key 已加密保存；后续新对话将使用新 Key。");
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "保存 API Key 失败。"
        );
      } finally {
        setKeyBusy(false);
      }
    },
    [apiKey]
  );

  const handleBeginKeyReset = useCallback(() => setConfirmKeyReset(true), []);
  const handleCancelKeyReset = useCallback(() => setConfirmKeyReset(false), []);

  const handleBeginDeleteSession = useCallback(() => {
    if (selectedId) {
      setConfirmDeleteSessionId(selectedId);
    }
  }, [selectedId]);

  const handleCancelDeleteSession = useCallback(
    () => setConfirmDeleteSessionId(null),
    []
  );

  const handleDeleteSession = useCallback(async () => {
    const sessionId = confirmDeleteSessionId;
    if (!sessionId) {
      return;
    }

    setDeleteBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/study-sessions?sessionId=${encodeURIComponent(sessionId)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        throw new Error(await readError(response, "删除会话失败。"));
      }

      const nextPage = sessions.length === 1 && page > 1 ? page - 1 : page;
      if (selectedId === sessionId) {
        setDetail(null);
      }
      setConfirmDeleteSessionId(null);
      await loadSessions(nextPage, condition, query);
      setNotice("会话及其中的消息已删除。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除会话失败。");
    } finally {
      setDeleteBusy(false);
    }
  }, [
    condition,
    confirmDeleteSessionId,
    loadSessions,
    page,
    query,
    selectedId,
    sessions,
  ]);

  const handleResetApiKey = useCallback(async () => {
    setKeyBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/api-key", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(
          await readError(response, "恢复环境变量 API Key 失败。")
        );
      }
      setKeyStatus((await response.json()) as ApiKeyStatus);
      setNotice(
        "已移除后台覆盖值；现在使用 Cloudflare Worker Secret 中的 Key。"
      );
      setConfirmKeyReset(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "恢复环境变量 API Key 失败。"
      );
    } finally {
      setKeyBusy(false);
    }
  }, []);

  const submitSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setPage(1);
      setQuery(queryInput.trim());
    },
    [queryInput]
  );

  const handlePreviousPage = useCallback(() => {
    if (page > 1) {
      loadSessions(page - 1, condition, query);
    }
  }, [condition, loadSessions, page, query]);

  const handleNextPage = useCallback(() => {
    if (page < lastPage) {
      loadSessions(page + 1, condition, query);
    }
  }, [condition, lastPage, loadSessions, page, query]);

  if (!authenticated) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Study Console
          </p>
          <h1 className="mt-3 text-2xl font-semibold">研究管理后台</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            输入 Cloudflare Worker Secret STUDY_ADMIN_TOKEN 登录。密钥需至少 32
            个字符。
          </p>
          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            <label className="block text-sm font-medium" htmlFor="admin-token">
              管理员密钥
            </label>
            <input
              autoComplete="current-password"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              id="admin-token"
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
              disabled={loginBusy || !token}
              type="submit"
            >
              {loginBusy ? "正在登录…" : "登录后台"}
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
              Study Console
            </p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
              研究管理后台
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              查看参与者对话记录，管理 DeepSeek API Key。
            </p>
          </div>
          <button
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
            onClick={handleLogout}
            type="button"
          >
            退出登录
          </button>
        </header>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">DeepSeek API Key</h2>
              <p className="mt-1 text-sm text-slate-600">
                Key 使用 AES-256-GCM 加密后保存在数据库中，界面不会显示已保存的
                Key。
              </p>
              <p className="mt-1 text-xs text-slate-500">
                加密密钥由 STUDY_ADMIN_TOKEN 派生；更换该环境变量后，请重新保存
                API Key。
              </p>
              <p className="mt-2 text-xs text-slate-500" role="status">
                {keyStatus?.source === "admin"
                  ? `当前使用后台保存的 Key${keyStatus.updatedAt ? `，更新于 ${formatDate(keyStatus.updatedAt)}` : ""}`
                  : keyStatus?.source === "environment"
                    ? "当前使用 Cloudflare Worker Secret DEEPSEEK_API_KEY；保存新 Key 可覆盖它。"
                    : keyStatus?.source === "unavailable"
                      ? keyStatus.fallbackAvailable
                        ? "后台 Key 无法解密，当前回退使用环境变量；可清除后台覆盖值。"
                        : "后台 Key 无法解密，请清除覆盖值并重新设置 Key。"
                      : "尚未配置 Key。"}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                keyStatus?.configured
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {keyStatus?.configured ? "已配置" : "未配置"}
            </span>
          </div>
          <form
            className="mt-5 flex flex-col gap-3 sm:flex-row"
            onSubmit={handleSaveApiKey}
          >
            <input
              autoComplete="new-password"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              onChange={handleApiKeyChange}
              placeholder="粘贴新的 DeepSeek API Key"
              type="password"
              value={apiKey}
            />
            <button
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              disabled={keyBusy || !apiKey.trim()}
              type="submit"
            >
              {keyBusy ? "正在保存…" : "保存并启用"}
            </button>
            {keyStatus?.source === "admin" ||
            keyStatus?.source === "unavailable" ? (
              confirmKeyReset ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-2 text-sm text-amber-950">
                  <span>删除后台覆盖值并恢复环境变量？</span>
                  <button
                    className="rounded-lg bg-amber-900 px-3 py-2 font-medium text-white disabled:opacity-50"
                    disabled={keyBusy}
                    onClick={handleResetApiKey}
                    type="button"
                  >
                    确认
                  </button>
                  <button
                    className="rounded-lg border border-amber-300 px-3 py-2 font-medium disabled:opacity-50"
                    disabled={keyBusy}
                    onClick={handleCancelKeyReset}
                    type="button"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                  disabled={keyBusy}
                  onClick={handleBeginKeyReset}
                  type="button"
                >
                  恢复环境变量
                </button>
              )
            ) : null}
          </form>
        </section>

        {error ? (
          <p
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            role="status"
          >
            {notice}
          </p>
        ) : null}

        <section className="grid min-h-[32rem] gap-5 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.6fr)]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">用户历史记录</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    共 {total} 个会话
                  </p>
                </div>
                <label className="sr-only" htmlFor="condition-filter">
                  按实验条件筛选
                </label>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  id="condition-filter"
                  onChange={handleConditionChange}
                  value={condition}
                >
                  <option value="all">全部条件</option>
                  <option value="a">条件 A</option>
                  <option value="b">条件 B</option>
                </select>
              </div>
              <form className="mt-4 flex gap-2" onSubmit={submitSearch}>
                <input
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  onChange={handleQueryInputChange}
                  placeholder="搜索用户 ID 或会话 ID"
                  value={queryInput}
                />
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
                  disabled={listBusy}
                  type="submit"
                >
                  搜索
                </button>
              </form>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {listBusy && sessions.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">正在读取记录…</p>
              ) : sessions.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">
                  没有匹配的历史记录。
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {sessions.map((session) => (
                    <li key={session.id}>
                      <button
                        aria-current={
                          selectedId === session.id ? "true" : undefined
                        }
                        className={`w-full px-5 py-4 text-left transition hover:bg-slate-50 ${
                          selectedId === session.id ? "bg-slate-50" : ""
                        }`}
                        data-session-id={session.id}
                        onClick={handleSessionListClick}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs text-slate-700">
                            {shortId(session.userId)}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                            条件 {session.condition.toUpperCase()}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          {formatDate(session.createdAt)} ·{" "}
                          {session.messageCount} 条消息
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-slate-400">
                          会话 {shortId(session.id)}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
              <span>
                第 {page} / {lastPage} 页
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
                  disabled={page <= 1 || listBusy}
                  onClick={handlePreviousPage}
                  type="button"
                >
                  上一页
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
                  disabled={page >= lastPage || listBusy}
                  onClick={handleNextPage}
                  type="button"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {detailBusy ? (
              <p className="p-6 text-sm text-slate-500">正在读取对话…</p>
            ) : detail ? (
              <>
                <header className="border-b border-slate-200 p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                        Participant
                      </p>
                      <h2 className="mt-1 font-mono text-sm font-semibold">
                        {detail.userId}
                      </h2>
                    </div>
                    <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                      条件 {detail.condition.toUpperCase()}
                    </span>
                  </div>
                  <dl className="mt-5 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <dt className="text-slate-500">会话编号</dt>
                      <dd className="mt-1 font-mono text-slate-800">
                        {detail.id}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">创建时间</dt>
                      <dd className="mt-1 text-slate-800">
                        {formatDate(detail.createdAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">开始 / 结束</dt>
                      <dd className="mt-1 text-slate-800">
                        {formatDate(detail.startedAt)} /{" "}
                        {formatDate(detail.endedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">模型</dt>
                      <dd className="mt-1 text-slate-800">{detail.model}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">消息数</dt>
                      <dd className="mt-1 text-slate-800">
                        {detail.messages.length}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                    <span className="text-xs text-slate-500">
                      删除会话会同时删除其中的所有消息。
                    </span>
                    {confirmDeleteSessionId === detail.id ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-red-50 p-2 text-sm text-red-950">
                        <span>
                          永久删除此会话及 {detail.messages.length}{" "}
                          条消息？此操作无法撤销。
                        </span>
                        <button
                          className="rounded-lg bg-red-700 px-3 py-2 font-medium text-white disabled:opacity-50"
                          disabled={deleteBusy}
                          onClick={handleDeleteSession}
                          type="button"
                        >
                          {deleteBusy ? "正在删除…" : "确认删除"}
                        </button>
                        <button
                          className="rounded-lg border border-red-200 px-3 py-2 font-medium disabled:opacity-50"
                          disabled={deleteBusy}
                          onClick={handleCancelDeleteSession}
                          type="button"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        disabled={deleteBusy}
                        onClick={handleBeginDeleteSession}
                        type="button"
                      >
                        删除此会话
                      </button>
                    )}
                  </div>
                </header>
                <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/70 p-4 sm:p-6">
                  {detail.messages.length === 0 ? (
                    <p className="text-center text-sm text-slate-500">
                      此会话暂无消息。
                    </p>
                  ) : (
                    detail.messages.map((message) => (
                      <article
                        className={`max-w-[92%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[82%] ${
                          message.role === "user"
                            ? "ml-auto bg-slate-900 text-white"
                            : "mr-auto border border-slate-200 bg-white text-slate-900"
                        }`}
                        key={message.id}
                      >
                        <div className="mb-1 flex items-center justify-between gap-4 text-[11px] opacity-65">
                          <span>{message.role === "user" ? "用户" : "AI"}</span>
                          <time>{formatDate(message.createdAt)}</time>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-7">
                          {message.content}
                        </p>
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
                {selectedSession
                  ? "无法读取这条对话。"
                  : "选择左侧会话查看完整对话记录。"}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
