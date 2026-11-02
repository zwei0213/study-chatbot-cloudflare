"use client";

import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChatMessageText } from "@/components/chat-message-text";
import type { PracticeCondition, PracticePhase } from "@/lib/practice/flow";
import {
  getStudyErrorMessage,
  readStudyChatStream,
  readStudyJson,
} from "@/lib/study/client";

type PracticeMessage = {
  content: string;
  createdAt: string;
  grade: boolean | null;
  id: string;
  kind: string;
  questionId: string | null;
  role: "user" | "assistant";
  sequence: number;
};

type PracticeState = {
  condition: PracticeCondition;
  currentExtra: number;
  currentRequired: number;
  id: string;
  messages: PracticeMessage[];
  participantCode: string | null;
  phase: PracticePhase;
  trainingGoal: string | null;
};

const buttonStyle =
  "rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

export function PracticeChat({ condition }: { condition: PracticeCondition }) {
  const [state, setState] = useState<PracticeState | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmExit, setConfirmExit] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [pendingUserText, setPendingUserText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const stopped = state?.phase === "completed" || state?.phase === "incomplete";

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/practice/session", {
          body: JSON.stringify({ condition }),
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        setState(await readStudyJson<PracticeState>(response));
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            getStudyErrorMessage(cause, "加载陪练失败，请刷新页面重试。")
          );
        }
      }
    }
    load();
    return () => controller.abort();
  }, [condition]);

  useEffect(() => {
    if (!state?.messages.length && !busy) {
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.messages.length, busy]);

  const submit = useCallback(
    async (payload: { action?: string; text?: string }) => {
      if (!state || busy || stopped) {
        return;
      }
      setBusy(true);
      setError("");
      setConfirmExit(false);
      setStreamingText("");
      const actionLabel =
        payload.action === "skip" && state.phase === "extra-choice"
          ? "结束训练"
          : {
            continue: "继续加练",
            ready: "我准备好了",
            retry: "愿意重试",
            skip: "跳过本题",
            start: "开始对话",
            stop: "结束训练",
            }[payload.action ?? ""] ?? "";
      setPendingUserText(payload.text?.trim() ?? actionLabel);
      const previousInput = input;
      if (payload.text !== undefined) {
        setInput("");
      }
      try {
        const response = await fetch("/api/practice/message", {
          body: JSON.stringify({ ...payload, sessionId: state.id }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        await readStudyChatStream<PracticeMessage>(response, (event) => {
          if (event.type === "delta") {
            setStreamingText((current) => current + event.text);
          } else {
            const metadata = event.metadata as
              | Partial<PracticeState>
              | undefined;
            setState((current) =>
              current
                ? {
                    ...current,
                    currentExtra:
                      metadata?.currentExtra ?? current.currentExtra,
                    currentRequired:
                      metadata?.currentRequired ?? current.currentRequired,
                    messages: [...current.messages, ...event.messages],
                    participantCode:
                      metadata?.participantCode ?? current.participantCode,
                    phase: metadata?.phase ?? current.phase,
                    trainingGoal:
                      metadata?.trainingGoal ?? current.trainingGoal,
                  }
                : current
            );
            setPendingUserText("");
          }
        });
      } catch (cause) {
        setPendingUserText("");
        if (payload.text !== undefined) {
          setInput(previousInput);
        }
        setError(getStudyErrorMessage(cause, "发送失败，请检查网络后重试。"));
      } finally {
        setStreamingText("");
        setBusy(false);
      }
    },
    [busy, input, state, stopped]
  );

  const sendMessage = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = input.trim();
      if (text) {
        submit({ text });
      }
    },
    [input, submit]
  );

  const actions = useMemo(() => {
    if (state?.phase === "ready") {
      return [{ action: "start", label: "开始对话" }];
    }
    if (state?.phase === "confirm-ready") {
      return [{ action: "ready", label: "我准备好了" }];
    }
    if (state?.phase === "retry-choice") {
      return [
        { action: "retry", label: "重试" },
        { action: "skip", label: "跳过本题" },
      ];
    }
    if (state?.phase === "extra-choice") {
      return [
        { action: "continue", label: "继续加练" },
        { action: "skip", label: "结束训练" },
      ];
    }
    return [];
  }, [state?.phase]);

  const inputEnabled =
    !!state &&
    ["goal", "required", "retry-answer", "extra"].includes(state.phase) &&
    !stopped;

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value),
    []
  );
  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    },
    []
  );
  const handleActionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { action } = event.currentTarget.dataset;
      if (action) {
        submit({ action });
      }
    },
    [submit]
  );
  const handleStop = useCallback(() => {
    submit({ action: "stop" });
  }, [submit]);
  const handleConfirmExit = useCallback(() => setConfirmExit(true), []);
  const handleCancelExit = useCallback(() => setConfirmExit(false), []);

  return (
    <main className="flex min-h-dvh flex-col bg-[#f7f8fa] text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">AI智能陪练</h1>
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-5 sm:px-6">
        <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
          <p className="font-semibold">训练须知：</p>
          <p>1. 对话时长：点击“开始对话”后开始交互。</p>
          <p>
            2. 请根据AI智能陪练提出的问题认真作答，任何消极训练行为将被记录为无效。
          </p>
        </div>

        <div aria-live="polite" className="flex flex-1 flex-col gap-3 pb-6">
          {!state && !error ? (
            <p className="text-center text-sm text-slate-500">正在加载陪练…</p>
          ) : null}
          {state?.messages.map((message) => (
            <article
              className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-7 sm:max-w-[86%] ${
                message.role === "user"
                  ? "ml-auto bg-slate-900 text-white"
                  : "mr-auto border border-slate-200 bg-white text-slate-900 shadow-sm"
              }`}
              key={message.id}
            >
              <ChatMessageText text={message.content} />
            </article>
          ))}
          {pendingUserText ? (
            <article className="ml-auto max-w-[92%] rounded-2xl bg-slate-900 px-4 py-3 text-sm leading-7 text-white sm:max-w-[86%]">
              <ChatMessageText text={pendingUserText} />
            </article>
          ) : null}
          {streamingText ? (
            <article className="mr-auto max-w-[92%] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-900 shadow-sm sm:max-w-[86%]">
              <ChatMessageText text={streamingText} />
            </article>
          ) : null}
          {busy && !streamingText ? (
            <p
              className="mr-auto rounded-xl bg-white px-4 py-3 text-sm text-slate-500"
              role="status"
            >
              正在处理，请稍候…
            </p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {error ? (
          <p
            className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {actions.length > 0 && !stopped ? (
          <div className="mb-4 flex flex-wrap gap-3">
            {actions.map(({ action, label }) => (
              <button
                className={buttonStyle}
                data-action={action}
                disabled={busy}
                key={action}
                onClick={handleActionClick}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {inputEnabled ? (
          <form
            className="sticky bottom-0 flex items-end gap-2 border-t border-slate-200 bg-[#f7f8fa] py-3 sm:gap-3"
            onSubmit={sendMessage}
          >
            <textarea
              aria-label="输入回答"
              className="min-h-14 max-h-40 flex-1 resize-y rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base leading-6 outline-none focus:border-slate-500"
              disabled={busy}
              maxLength={2000}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              placeholder="请输入你的回答"
              value={input}
            />
            <button
              className={`${buttonStyle} h-14 shrink-0 px-4 sm:px-6`}
              disabled={busy || !input.trim()}
              type="submit"
            >
              发送
            </button>
          </form>
        ) : null}

        {state && !stopped ? (
          <div className="flex justify-end pt-2">
            {confirmExit ? (
              <div className="flex items-center gap-3 text-sm">
                <span>结束本次训练？未完成训练要求将无法获得完成编码。</span>
                <button
                  className="font-semibold text-red-700"
                  disabled={busy}
                  onClick={handleStop}
                  type="button"
                >
                  确认结束
                </button>
                <button
                  className="text-slate-600"
                  onClick={handleCancelExit}
                  type="button"
                >
                  继续练习
                </button>
              </div>
            ) : (
              <button
                className="text-sm text-slate-500 underline underline-offset-4"
                onClick={handleConfirmExit}
                type="button"
              >
                结束训练
              </button>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
