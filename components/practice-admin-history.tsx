"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ChatMessageText } from "@/components/chat-message-text";
import { getStudyErrorMessage, readStudyJson } from "@/lib/study/client";

type PracticeSessionSummary = {
  condition: "low" | "high";
  createdAt: string;
  currentExtra: number;
  currentRequired: number;
  id: string;
  participantCode: string | null;
  phase: string;
  promptVersion: string;
};

type PracticeRecord = PracticeSessionSummary & {
  messages: {
    content: string;
    createdAt: string;
    grade: boolean | null;
    id: string;
    kind: string;
    questionId: string | null;
    role: "user" | "assistant";
  }[];
};

function dateLabel(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}

export function PracticeAdminHistory() {
  const [sessions, setSessions] = useState<PracticeSessionSummary[]>([]);
  const [selected, setSelected] = useState<PracticeRecord | null>(null);
  const [busy, setBusy] = useState(true);
  const [detailBusy, setDetailBusy] = useState(false);
  const [searchCode, setSearchCode] = useState("");
  const [searchedCode, setSearchedCode] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState("");

  const loadSessions = useCallback(async (code: string) => {
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      const params = new URLSearchParams();
      if (code) {
        params.set("code", code);
      }
      const response = await fetch(
        `/api/admin/practice-sessions${params.size ? `?${params}` : ""}`,
        { cache: "no-store" }
      );
      const data = await readStudyJson<{
        sessions: PracticeSessionSummary[];
      }>(response);
      setSessions(data.sessions);
      setSearchedCode(code);
    } catch (cause) {
      setError(getStudyErrorMessage(cause, "读取陪练记录失败。"));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadSessions("");
  }, [loadSessions]);

  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setSearchCode(event.target.value),
    []
  );
  const handleSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      loadSessions(searchCode.trim().toUpperCase());
    },
    [loadSessions, searchCode]
  );
  const handleClearSearch = useCallback(() => {
    setSearchCode("");
    loadSessions("");
  }, [loadSessions]);

  const openSession = useCallback(async (sessionId: string) => {
    setDetailBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/practice-sessions?sessionId=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" }
      );
      setSelected(await readStudyJson<PracticeRecord>(response));
    } catch (cause) {
      setError(getStudyErrorMessage(cause, "读取这条陪练记录失败。"));
    } finally {
      setDetailBusy(false);
    }
  }, []);

  const handleSessionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { sessionId } = event.currentTarget.dataset;
      if (sessionId) {
        openSession(sessionId);
      }
    },
    [openSession]
  );

  const handleDelete = useCallback(async () => {
    if (!selected || confirmDeleteId !== selected.id) {
      return;
    }
    setDeleteBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/practice-sessions", {
        body: JSON.stringify({ sessionId: selected.id }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      await readStudyJson<{ deleted: boolean }>(response);
      setSessions((current) =>
        current.filter((session) => session.id !== selected.id)
      );
      setSelected(null);
      setConfirmDeleteId(null);
    } catch (cause) {
      setError(getStudyErrorMessage(cause, "删除陪练记录失败。"));
    } finally {
      setDeleteBusy(false);
    }
  }, [confirmDeleteId, selected]);

  const handleRequestDelete = useCallback(() => {
    if (selected) {
      setConfirmDeleteId(selected.id);
    }
  }, [selected]);
  const handleCancelDelete = useCallback(() => setConfirmDeleteId(null), []);

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI智能陪练实验记录</h2>
          <p className="mt-1 text-sm text-slate-600">
            低温暖与高温暖两组的练习进度、判定结果和完整对话。
          </p>
        </div>
        <a
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          href="/api/admin/practice-export"
        >
          导出 CSV
        </a>
      </div>

      {error ? (
        <p
          className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <form className="mb-4 flex flex-wrap gap-2" onSubmit={handleSearch}>
        <input
          aria-label="按完成编码搜索"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm uppercase outline-none focus:border-slate-500"
          maxLength={15}
          onChange={handleSearchChange}
          placeholder="输入15位完成编码查找对话"
          value={searchCode}
        />
        <button
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={busy || !searchCode.trim()}
          type="submit"
        >
          查找
        </button>
        {searchedCode ? (
          <button
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium hover:bg-slate-50"
            onClick={handleClearSearch}
            type="button"
          >
            显示全部
          </button>
        ) : null}
      </form>

      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.5fr)]">
        <div className="max-h-[30rem] overflow-y-auto rounded-xl border border-slate-200">
          {busy ? (
            <p className="p-4 text-sm text-slate-500">正在读取陪练记录…</p>
          ) : sessions.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">
              {searchedCode
                ? `没有找到编码 ${searchedCode} 对应的记录。`
                : "暂时没有陪练记录。"}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sessions.map((session) => (
                <li key={session.id}>
                  <button
                    className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${selected?.id === session.id ? "bg-blue-50" : ""}`}
                    data-session-id={session.id}
                    onClick={handleSessionClick}
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                      <span>
                        {session.condition === "low" ? "低温暖组" : "高温暖组"}
                      </span>
                      <span className="text-xs font-normal text-slate-500">
                        {session.phase}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      已完成必做 {session.currentRequired} 道 · 加练{" "}
                      {session.currentExtra} 道 · {dateLabel(session.createdAt)}
                    </span>
                    {session.participantCode ? (
                      <span className="mt-1 block font-mono text-xs text-emerald-700">
                        编码：{session.participantCode}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="max-h-[30rem] overflow-y-auto rounded-xl border border-slate-200 p-4">
          {detailBusy ? (
            <p className="text-sm text-slate-500">正在读取对话…</p>
          ) : selected ? (
            <div className="space-y-3">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="text-xs text-slate-500">
                  <p className="font-mono text-sm font-semibold text-slate-800">
                    完成编码：{selected.participantCode ?? "未完成"}
                  </p>
                  <p className="mt-1">
                    {selected.id} · 提示词版本 {selected.promptVersion}
                  </p>
                </div>
                <button
                  className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                  disabled={deleteBusy}
                  onClick={handleRequestDelete}
                  type="button"
                >
                  删除记录
                </button>
              </div>
              {confirmDeleteId === selected.id ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-900">
                  <span>确认永久删除这条会话及其全部消息？</span>
                  <button
                    className="rounded-lg bg-red-700 px-3 py-2 font-semibold text-white disabled:opacity-50"
                    disabled={deleteBusy}
                    onClick={handleDelete}
                    type="button"
                  >
                    {deleteBusy ? "正在删除…" : "确认删除"}
                  </button>
                  <button
                    className="rounded-lg border border-red-200 px-3 py-2"
                    disabled={deleteBusy}
                    onClick={handleCancelDelete}
                    type="button"
                  >
                    取消
                  </button>
                </div>
              ) : null}
              {selected.messages.map((message) => (
                <article
                  className={`rounded-xl px-3 py-2 text-sm leading-6 ${message.role === "user" ? "ml-8 bg-slate-100" : "mr-8 bg-blue-50"}`}
                  key={message.id}
                >
                  <p className="mb-1 text-[11px] text-slate-500">
                    {message.role === "user" ? "参与者" : "AI"}
                    {message.questionId ? ` · ${message.questionId}` : ""}
                    {message.grade === null
                      ? ""
                      : message.grade
                        ? " · 正确"
                        : " · 错误"}
                    {` · ${dateLabel(message.createdAt)}`}
                  </p>
                  <ChatMessageText text={message.content} />
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              选择左侧参与者查看完整对话。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
