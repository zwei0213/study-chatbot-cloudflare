"use client";

import { type ChangeEvent, useCallback, useEffect, useState } from "react";
import type {
  PracticeQuestion,
  PracticeSettingsInput,
} from "@/lib/practice/validation";
import { getStudyErrorMessage, readStudyJson } from "@/lib/study/client";

type SettingsResponse = PracticeSettingsInput & {
  apiKeyConfigured: boolean;
  apiKeySource: "backend" | "environment" | "none" | "unavailable";
};

const sourceLabel: Record<SettingsResponse["apiKeySource"], string> = {
  backend: "后台已加密保存",
  environment: "使用 Cloudflare 环境变量 DEEPSEEK_API_KEY",
  none: "尚未配置 API Key",
  unavailable: "后台密钥无法解密，请重新输入 Key",
};

function reindexQuestions(questions: PracticeQuestion[]) {
  const required = questions
    .filter((question) => question.phase === "required")
    .map((question, index) => ({
      ...question,
      id: `B${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
    }));
  const extra = questions
    .filter((question) => question.phase === "extra")
    .map((question, index) => ({
      ...question,
      id: `E${String(index + 1).padStart(2, "0")}`,
      order: required.length + index + 1,
    }));
  return [...required, ...extra];
}

export function PracticeAdminSettings() {
  const [settings, setSettings] = useState<PracticeSettingsInput | null>(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeySource, setApiKeySource] =
    useState<SettingsResponse["apiKeySource"]>("none");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/practice-settings", {
        cache: "no-store",
      });
      const data = await readStudyJson<SettingsResponse>(response);
      const {
        apiKeyConfigured: configured,
        apiKeySource: source,
        ...editable
      } = data;
      setSettings(editable);
      setApiKeyConfigured(configured);
      setApiKeySource(source);
      setClearApiKey(false);
    } catch (cause) {
      setError(getStudyErrorMessage(cause, "读取陪练设置失败。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings().then(() => undefined);
  }, [loadSettings]);

  const updateText = useCallback(
    (key: Exclude<keyof PracticeSettingsInput, "questions">, value: string) => {
      setSettings((current) =>
        current ? { ...current, [key]: value } : current
      );
    },
    []
  );

  const updateQuestion = useCallback(
    (id: string, key: "zhPrompt" | "referenceEn", value: string) => {
      setSettings((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((question) =>
                question.id === id ? { ...question, [key]: value } : question
              ),
            }
          : current
      );
    },
    []
  );

  const handleAddQuestion = useCallback((phase: PracticeQuestion["phase"]) => {
    setSettings((current) => {
      if (!current) {
        return current;
      }
      const phaseCount = current.questions.filter(
        (question) => question.phase === phase
      ).length;
      if (phaseCount >= 25) {
        return current;
      }
      return {
        ...current,
        questions: reindexQuestions([
          ...current.questions,
          {
            id: "B00",
            order: 0,
            phase,
            referenceEn: "",
            zhPrompt: "",
          },
        ]),
      };
    });
  }, []);

  const handleRemoveQuestion = useCallback((id: string) => {
    setSettings((current) => {
      if (!current) {
        return current;
      }
      const target = current.questions.find((question) => question.id === id);
      const phaseCount = current.questions.filter(
        (question) => question.phase === target?.phase
      ).length;
      if (!target || (target.phase === "required" && phaseCount <= 1)) {
        return current;
      }
      return {
        ...current,
        questions: reindexQuestions(
          current.questions.filter((question) => question.id !== id)
        ),
      };
    });
  }, []);

  const handleSettingsTextChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { currentTarget } = event;
      const { name, value } = currentTarget;
      if (name.startsWith("question:")) {
        const [, id, key] = name.split(":");
        if (key === "zhPrompt" || key === "referenceEn") {
          updateQuestion(id, key, value);
        }
        return;
      }
      if (
        name === "model" ||
        name === "commonPrompt" ||
        name === "lowWarmthPrompt" ||
        name === "highWarmthPrompt" ||
        name === "welcomeLow" ||
        name === "welcomeHigh"
      ) {
        updateText(name, value);
      }
    },
    [updateQuestion, updateText]
  );

  const handleClearApiKeyChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setClearApiKey(event.currentTarget.checked);
    },
    []
  );

  const handleReload = useCallback(() => {
    loadSettings().then(() => undefined);
  }, [loadSettings]);

  const handleApiKeyChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setApiKey(event.target.value);
      if (event.target.value) {
        setClearApiKey(false);
      }
    },
    []
  );

  const save = useCallback(async () => {
    if (!settings) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/practice-settings", {
        body: JSON.stringify({ apiKey, clearApiKey, settings }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const data = await readStudyJson<SettingsResponse>(response);
      const {
        apiKeyConfigured: configured,
        apiKeySource: source,
        ...editable
      } = data;
      setSettings(editable);
      setApiKeyConfigured(configured);
      setApiKeySource(source);
      setApiKey("");
      setClearApiKey(false);
      setNotice(
        "设置已保存。未开始的会话会应用新设置，进行中的会话保持原设置。提示词影响 AI 回复；练习流程和题目数量由题库决定。"
      );
    } catch (cause) {
      setError(getStudyErrorMessage(cause, "保存陪练设置失败。"));
    } finally {
      setSaving(false);
    }
  }, [apiKey, clearApiKey, settings]);

  const handleSave = useCallback(() => {
    save().then(() => undefined);
  }, [save]);

  if (loading) {
    return (
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        正在读取陪练设置…
      </section>
    );
  }
  if (!settings) {
    return (
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-red-700">{error}</p>
        <button
          className="mt-3 rounded-lg border px-3 py-2 text-sm"
          onClick={handleReload}
          type="button"
        >
          重试
        </button>
      </section>
    );
  }

  const textArea = (
    label: string,
    key: Exclude<keyof PracticeSettingsInput, "questions" | "model">
  ) => (
    <label className="block text-sm font-medium text-slate-800" key={key}>
      {label}
      <textarea
        className="mt-2 min-h-40 w-full rounded-xl border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        name={key}
        onChange={handleSettingsTextChange}
        value={settings[key]}
      />
    </label>
  );

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">陪练配置</h2>
          <p className="mt-1 text-sm text-slate-600">
            提示词用于指导 AI 回复；练习流程和题数由题库控制。已开始会话沿用原设置，未开始的会话会更新为最新设置。
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs ${apiKeyConfigured ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}
        >
          {sourceLabel[apiKeySource]}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-medium">
          DeepSeek API Key
          <input
            autoComplete="new-password"
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            onChange={handleApiKeyChange}
            placeholder={
              apiKeyConfigured
                ? "已配置；输入新 Key 可替换"
                : "粘贴 DeepSeek API Key"
            }
            type="password"
            value={apiKey}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Key 只写入加密后的 D1 设置，不会回传或显示。
          </span>
        </label>
        <label className="block text-sm font-medium">
          DeepSeek 模型
          <input
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            name="model"
            onChange={handleSettingsTextChange}
            placeholder="deepseek-flash"
            value={settings.model}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            API 地址固定使用 DeepSeek 官方接口。
          </span>
        </label>
      </div>

      {apiKeyConfigured && apiKeySource !== "environment" ? (
        <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            checked={clearApiKey}
            onChange={handleClearApiKeyChange}
            type="checkbox"
          />
          清除后台保存的 Key
          {apiKeySource === "backend" ? "（若环境变量已配置则回退使用）" : ""}
        </label>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {textArea("共同提示词", "commonPrompt")}
        {textArea("低温暖提示词", "lowWarmthPrompt")}
        {textArea("高温暖提示词", "highWarmthPrompt")}
        {textArea("低温暖欢迎语", "welcomeLow")}
        {textArea("高温暖欢迎语", "welcomeHigh")}
      </div>

      <div className="mt-6 border-t border-slate-200 pt-5">
        <h3 className="text-lg font-semibold">题库</h3>
        <p className="mt-1 text-sm text-slate-600">
          必做题 {settings.questions.filter((question) => question.phase === "required").length} 道，加练题 {settings.questions.filter((question) => question.phase === "extra").length} 道；每类最多 25 道。题号会自动重排。
        </p>
        <div className="mt-4 space-y-4">
          {settings.questions.map((question: PracticeQuestion) => (
            <div
              className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[5rem_1fr_1fr_auto]"
              key={question.id}
            >
              <div className="pt-2 text-sm font-semibold">
                {question.id}
                <span className="block text-xs font-normal text-slate-500">
                  {question.phase === "required" ? "必做" : "加练"}
                </span>
              </div>
              <label className="text-xs font-medium text-slate-600">
                题目
                <textarea
                  className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900"
                  name={`question:${question.id}:zhPrompt`}
                  onChange={handleSettingsTextChange}
                  value={question.zhPrompt}
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                参考答案
                <textarea
                  className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900"
                  name={`question:${question.id}:referenceEn`}
                  onChange={handleSettingsTextChange}
                  value={question.referenceEn}
                />
              </label>
              <button
                aria-label={`删除题目 ${question.id}`}
                className="justify-self-end rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
                disabled={question.phase === "required" && settings.questions.filter((item) => item.phase === "required").length <= 1}
                onClick={() => handleRemoveQuestion(question.id)}
                type="button"
              >
                删除题目
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-40"
            disabled={settings.questions.filter((question) => question.phase === "required").length >= 25}
            onClick={() => handleAddQuestion("required")}
            type="button"
          >
            添加必做题
          </button>
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-40"
            disabled={settings.questions.filter((question) => question.phase === "extra").length >= 25}
            onClick={() => handleAddQuestion("extra")}
            type="button"
          >
            添加加练题
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 text-sm text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end">
        <button
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          disabled={saving}
          onClick={handleSave}
          type="button"
        >
          {saving ? "保存中…" : "保存陪练配置"}
        </button>
      </div>
    </section>
  );
}
