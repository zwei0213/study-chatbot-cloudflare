"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChatMessageText } from "@/components/chat-message-text";
import type { StudyCondition } from "@/lib/study/study";
import {
  getStudyElapsedSeconds,
  STUDY_MIN_SECONDS,
  STUDY_REMINDER_SECONDS,
  STUDY_TARGET_SECONDS,
} from "@/lib/study/timing";

type StudyMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sequence: number;
};

type StudyTiming = {
  startedAt: string | null;
  endedAt: string | null;
  serverNow: string;
};

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function StudyChat({
  condition,
  welcome,
}: {
  condition: StudyCondition;
  welcome: string;
}) {
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [maxExchanges, setMaxExchanges] = useState<number | null>(null);
  const [messages, setMessages] = useState<StudyMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingUserText, setPendingUserText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [updating, setUpdating] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [endedAt, setEndedAt] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const serverOffsetRef = useRef(0);
  const latestServerTimeRef = useRef(0);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageCount = messages.length;
  const completedExchanges = messages.filter(
    (message) => message.role === "user"
  ).length;
  const reachedRoundLimit =
    maxExchanges !== null && completedExchanges >= maxExchanges;
  const isComplete = endedAt !== null;
  const elapsed = getStudyElapsedSeconds(startedAt, endedAt, now);
  const canEnd = !!startedAt && elapsed >= STUDY_MIN_SECONDS;
  const blocked =
    loading ||
    !participantId ||
    !startedAt ||
    sending ||
    updating ||
    isComplete;
  const inputBlocked =
    loading || !participantId || !startedAt || updating || isComplete;
  const reminder =
    startedAt && !isComplete && elapsed >= STUDY_TARGET_SECONDS
      ? "对话已满 30 分钟，请整理最后的想法并点击“结束对话”。系统不会自动中断。"
      : startedAt && !isComplete && elapsed >= STUDY_REMINDER_SECONDS
        ? "温馨提醒：距离建议结束时间不超过 5 分钟，请逐步收尾。"
        : "";

  const syncTiming = useCallback((data: StudyTiming) => {
    const serverTime = new Date(data.serverNow).getTime();
    if (serverTime < latestServerTimeRef.current) {
      return;
    }
    latestServerTimeRef.current = serverTime;
    serverOffsetRef.current = serverTime - Date.now();
    setStartedAt((current) => current ?? data.startedAt);
    setEndedAt((current) => current ?? data.endedAt);
    setNow(serverTime);
  }, []);

  const mergeMessages = useCallback((incoming: StudyMessage[]) => {
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of incoming) {
        byId.set(message.id, message);
      }
      return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
    });
  }, []);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function loadSession(initial = false) {
      if (refreshing) {
        return;
      }
      refreshing = true;
      try {
        const response = await fetch("/api/study/session", {
          body: JSON.stringify({ condition }),
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "加载对话失败。");
        }
        if (active) {
          setParticipantId(data.participantId);
          setMaxExchanges(data.maxExchanges);
          mergeMessages(data.messages);
          syncTiming(data);
        }
      } catch (cause) {
        if (active && initial) {
          setError(cause instanceof Error ? cause.message : "加载对话失败。");
        }
      } finally {
        refreshing = false;
        if (active) {
          setLoading(false);
        }
      }
    }
    loadSession(true);
    const poll = window.setInterval(() => loadSession(), 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        loadSession();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [condition, mergeMessages, syncTiming]);

  useEffect(() => {
    if (!startedAt || endedAt) {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now() + serverOffsetRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, endedAt]);

  const updateSession = useCallback(
    async (action: "start" | "end") => {
      if (
        !participantId ||
        updating ||
        sending ||
        (action === "end" && !canEnd)
      ) {
        return;
      }
      setUpdating(true);
      setError("");
      try {
        const response = await fetch("/api/study/session", {
          body: JSON.stringify({ action, participantId }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "保存失败，请重试。");
        }
        syncTiming(data);
        setConfirmEnd(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
      } finally {
        setUpdating(false);
      }
    },
    [participantId, updating, sending, canEnd, syncTiming]
  );

  const startSession = useCallback(
    () => updateSession("start"),
    [updateSession]
  );
  const endSession = useCallback(() => updateSession("end"), [updateSession]);
  const showEndConfirmation = useCallback(() => setConfirmEnd(true), []);
  const cancelEnd = useCallback(() => setConfirmEnd(false), []);

  useEffect(() => {
    if (messageCount > 0 || sending) {
      bottomRef.current?.scrollIntoView({
        behavior: streamingText ? "auto" : "smooth",
      });
    }
  }, [messageCount, sending, streamingText]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (blocked || reachedRoundLimit || confirmEnd || !text) {
      return;
    }

    setSending(true);
    setError("");
    setStreamingText("");
    setPendingUserText(text);
    setInput("");
    let completed = false;
    try {
      const response = await fetch("/api/study/chat", {
        body: JSON.stringify({ participantId, text }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "发送失败，请重试。");
      }
      if (!response.body) {
        throw new Error("无法读取 AI 回复，请重试。");
      }

      const responseBody = response.body;
      if (!responseBody) {
        throw new Error("无法读取 AI 回复，请重试。");
      }
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (rawEvent: string) => {
        const data = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) {
          return;
        }

        const event = JSON.parse(data) as {
          error?: string;
          messages?: StudyMessage[];
          text?: string;
          type?: string;
        };
        if (event.type === "delta" && typeof event.text === "string") {
          setStreamingText((current) => current + event.text);
        } else if (event.type === "done" && event.messages) {
          mergeMessages(event.messages);
          setPendingUserText("");
          completed = true;
        } else if (event.type === "error") {
          throw new Error(event.error ?? "发送失败，请重试。");
        }
      };

      const handleChunk = (chunk: Uint8Array) => {
        buffer += decoder.decode(chunk, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          handleEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      };

      await responseBody.pipeTo(
        new WritableStream<Uint8Array>({ write: handleChunk })
      );

      buffer += decoder.decode();
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.trim()) {
        handleEvent(buffer);
      }

      if (!completed) {
        throw new Error("AI 回复连接中断，请重试。");
      }
    } catch (cause) {
      setPendingUserText("");
      setInput((current) => current || text);
      setError(cause instanceof Error ? cause.message : "发送失败，请重试。");
    } finally {
      setStreamingText("");
      setSending(false);
    }
  }, [
    input,
    participantId,
    blocked,
    reachedRoundLimit,
    confirmEnd,
    mergeMessages,
  ]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setInput(event.target.value);
    },
    []
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  return (
    <main className="flex min-h-dvh flex-col bg-[#f7f8fa] text-slate-900">
      <header className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">AI 对话</h1>
            <p className="text-sm text-slate-500">请根据自己的真实经历交流</p>
          </div>
          {participantId ? (
            <span className="text-xs text-slate-400">
              会话编号 {participantId.slice(0, 8)}
            </span>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ChatMessageText className="text-sm leading-7" text={welcome} />
        </div>

        <section
          aria-label="对话时间说明"
          className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-5"
        >
          <h2 className="font-semibold text-blue-950">对话时长：10–30 分钟</h2>
          <p className="mt-2 text-sm leading-7 text-blue-900">
            点击“开始对话”后计时，至少交流 10 分钟后才能结束。第 25
            分钟会提醒您收尾，满 30 分钟会再次提醒，不会自动中断对话。
          </p>
          <p className="mt-1 text-xs leading-6 text-blue-800">
            请预留连续的交流时间；刷新或暂时离开页面不会暂停、重置计时。
          </p>
          {!loading && !startedAt && participantId ? (
            <button
              className="mt-4 rounded-xl bg-slate-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              disabled={updating}
              onClick={startSession}
              type="button"
            >
              {updating ? "正在开始…" : "开始对话"}
            </button>
          ) : null}
        </section>

        {maxExchanges === null ? null : (
          <p className="mb-4 text-sm text-slate-500">
            对话进度：{completedExchanges} / {maxExchanges}
          </p>
        )}

        <div aria-live="polite" className="flex flex-1 flex-col gap-4 pb-6">
          {loading ? (
            <p className="text-center text-sm text-slate-500">正在加载对话…</p>
          ) : null}
          {messages.map((message) => (
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-7 ${
                message.role === "user"
                  ? "ml-auto bg-slate-800 text-white"
                  : "mr-auto border border-slate-200 bg-white text-slate-900"
              }`}
              key={message.id}
            >
              <ChatMessageText text={message.content} />
            </div>
          ))}
          {pendingUserText ? (
            <div className="ml-auto max-w-[88%] rounded-2xl bg-slate-800 px-4 py-3 text-sm leading-7 text-white">
              <ChatMessageText text={pendingUserText} />
            </div>
          ) : null}
          {sending && !streamingText ? (
            <p className="text-sm text-slate-500" role="status">
              AI 正在回复…
            </p>
          ) : null}
          {streamingText ? (
            <div className="mr-auto max-w-[88%] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-900">
              <ChatMessageText text={streamingText} />
              <span aria-hidden="true" className="animate-pulse">
                ▍
              </span>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <div className="sticky bottom-0 border-t border-slate-200 bg-[#f7f8fa] pb-5 pt-4">
          {startedAt ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {isComplete ? "本次用时" : "已对话"}{" "}
                  <span className="font-mono tabular-nums" role="timer">
                    {formatTime(elapsed)}
                  </span>
                </p>
                {isComplete ? null : (
                  <p className="mt-1 text-xs text-slate-500">
                    {canEnd
                      ? "已满 10 分钟，可在准备好后结束对话"
                      : `距离可结束还有 ${formatTime(STUDY_MIN_SECONDS - elapsed)}`}
                  </p>
                )}
              </div>
              {isComplete ? null : (
                <button
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canEnd || sending || updating || confirmEnd}
                  onClick={showEndConfirmation}
                  type="button"
                >
                  结束对话
                </button>
              )}
            </div>
          ) : null}
          <div aria-atomic="true" aria-live="polite">
            {reminder ? (
              <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                {reminder}
              </p>
            ) : null}
          </div>
          {confirmEnd && !isComplete ? (
            <div className="mb-3 rounded-xl border border-slate-300 bg-white p-4">
              <p className="text-sm leading-6">
                确认结束本次对话？结束后可以查看记录，但不能继续发送消息。
                {input.trim() ? "输入框中尚未发送的内容不会保存。" : ""}
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={updating || sending || !canEnd}
                  onClick={endSession}
                  type="button"
                >
                  {updating ? "正在保存…" : "确认结束"}
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                  disabled={updating}
                  onClick={cancelEnd}
                  type="button"
                >
                  继续对话
                </button>
              </div>
            </div>
          ) : null}
          {isComplete ? (
            <p className="mb-3 text-center text-sm font-medium text-slate-700">
              本次对话已结束，请返回实验问卷继续。
            </p>
          ) : null}
          {reachedRoundLimit && !isComplete ? (
            <p className="mb-3 text-sm text-slate-600">
              已达到设定的对话轮数，请在满 10 分钟后点击“结束对话”。
            </p>
          ) : null}
          {error ? (
            <p className="mb-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex items-end gap-3 rounded-2xl border border-slate-300 bg-white p-3 shadow-sm">
            <textarea
              aria-label="输入消息"
              className="max-h-40 min-h-12 flex-1 resize-none bg-transparent p-2 text-sm outline-none"
              disabled={inputBlocked || reachedRoundLimit || confirmEnd}
              maxLength={2000}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                startedAt
                  ? "说说你的经历和感受…"
                  : "请先阅读时间说明并点击“开始对话”"
              }
              rows={2}
              value={input}
            />
            <button
              className="rounded-xl bg-slate-800 px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                blocked || reachedRoundLimit || confirmEnd || !input.trim()
              }
              onClick={sendMessage}
              type="button"
            >
              发送
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-slate-400">
            按 Enter 发送，Shift + Enter 换行
          </p>
        </div>
      </div>
    </main>
  );
}
