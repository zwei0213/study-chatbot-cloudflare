"use client";

import { type MouseEvent, useCallback, useEffect, useState } from "react";
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
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/admin/practice-sessions", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readStudyJson<{
          sessions: PracticeSessionSummary[];
        }>(response);
        if (!controller.signal.aborted) {
          setSessions(data.sessions);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(getStudyErrorMessage(cause, "读取陪练记录失败。"));
        }
      } finally {
        if (!controller.signal.aborted) {
          setBusy(false);
        }
      }
    }
    load();
    return () => controller.abort();
  }, []);

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

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">英语陪练实验记录</h2>
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

      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.5fr)]">
        <div className="max-h-[30rem] overflow-y-auto rounded-xl border border-slate-200">
          {busy ? (
            <p className="p-4 text-sm text-slate-500">正在读取陪练记录…</p>
          ) : sessions.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">暂时没有陪练记录。</p>
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
                      必做 {session.currentRequired}/5 · 加练{" "}
                      {session.currentExtra} · {dateLabel(session.createdAt)}
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
              <div className="mb-4 border-b border-slate-100 pb-3 text-xs text-slate-500">
                {selected.id} · 提示词版本 {selected.promptVersion}
              </div>
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
