import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { practiceAdminSetting } from "@/lib/db/schema";
import prompts from "./prompts.json";
import defaultQuestions from "./questions.json";
import {
  type PracticeQuestion,
  type PracticeSettingsInput,
  practiceQuestionBankSchema,
  practiceSettingsSchema,
} from "./validation";

const settingKeys = {
  apiKey: "deepseek_api_key",
  commonPrompt: "common_prompt",
  highWarmthPrompt: "high_warmth_prompt",
  lowWarmthPrompt: "low_warmth_prompt",
  model: "model",
  questions: "questions_json",
  welcomeHigh: "welcome_high",
  welcomeLow: "welcome_low",
} as const;

function deriveEncryptionKey() {
  const token = process.env.STUDY_ADMIN_TOKEN ?? "";
  if (token.length < 32) {
    throw new Error("STUDY_ADMIN_TOKEN must be at least 32 characters long.");
  }
  return createHash("sha256")
    .update("practice-admin-api-key-v1\0")
    .update(token)
    .digest();
}

function encryptApiKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: 1,
  });
}

function decryptApiKey(encrypted: string) {
  const payload = JSON.parse(encrypted) as {
    ciphertext?: string;
    iv?: string;
    tag?: string;
    version?: number;
  };
  if (
    payload.version !== 1 ||
    !payload.ciphertext ||
    !payload.iv ||
    !payload.tag
  ) {
    throw new Error("Saved practice API Key has an unsupported format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(),
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function readSettings() {
  const db = await getDb();
  const entries = await db.select().from(practiceAdminSetting);
  return new Map(entries.map(({ key, value }) => [key, value]));
}

function parseStoredSettings(values: Map<string, string>) {
  let questions: unknown = defaultQuestions;
  const storedQuestions = values.get(settingKeys.questions);
  if (storedQuestions) {
    try {
      questions = JSON.parse(storedQuestions);
    } catch {
      questions = defaultQuestions;
    }
  }
  return practiceSettingsSchema.parse({
    commonPrompt: values.get(settingKeys.commonPrompt) ?? prompts.common,
    highWarmthPrompt:
      values.get(settingKeys.highWarmthPrompt) ?? prompts.highWarmth,
    lowWarmthPrompt:
      values.get(settingKeys.lowWarmthPrompt) ?? prompts.lowWarmth,
    model: values.get(settingKeys.model) ?? prompts.model,
    questions,
    welcomeHigh: values.get(settingKeys.welcomeHigh) ?? prompts.welcomeHigh,
    welcomeLow: values.get(settingKeys.welcomeLow) ?? prompts.welcomeLow,
  });
}

export async function getPracticeRuntimeConfig() {
  const values = await readSettings();
  const settings = parseStoredSettings(values);
  const promptVersion = createHash("sha256")
    .update(JSON.stringify(settings))
    .digest("hex")
    .slice(0, 16);
  return { ...settings, promptVersion };
}

export function parsePracticeQuestionSnapshot(snapshot: string | null) {
  if (!snapshot) {
    return defaultQuestions as PracticeQuestion[];
  }
  try {
    return practiceQuestionBankSchema.parse(JSON.parse(snapshot));
  } catch (error) {
    console.error("Invalid saved practice question snapshot:", error);
    return defaultQuestions as PracticeQuestion[];
  }
}

export async function getPracticeApiKey() {
  const values = await readSettings();
  const stored = values.get(settingKeys.apiKey);
  if (stored) {
    try {
      return decryptApiKey(stored);
    } catch (error) {
      if (process.env.DEEPSEEK_API_KEY) {
        return process.env.DEEPSEEK_API_KEY;
      }
      throw error;
    }
  }
  return process.env.DEEPSEEK_API_KEY ?? null;
}

export async function getPracticeAdminSettings() {
  const values = await readSettings();
  const settings = parseStoredSettings(values);
  let source: "backend" | "environment" | "none" | "unavailable";
  const stored = values.get(settingKeys.apiKey);
  if (stored) {
    try {
      decryptApiKey(stored);
      source = "backend";
    } catch {
      source = process.env.DEEPSEEK_API_KEY ? "environment" : "unavailable";
    }
  } else {
    source = process.env.DEEPSEEK_API_KEY ? "environment" : "none";
  }
  return {
    ...settings,
    apiKeyConfigured: source === "backend" || source === "environment",
    apiKeySource: source,
  };
}

export async function savePracticeAdminSettings(
  settings: PracticeSettingsInput,
  options: { apiKey?: string; clearApiKey?: boolean }
) {
  const db = await getDb();
  const values: [string, string][] = [
    [settingKeys.commonPrompt, settings.commonPrompt],
    [settingKeys.highWarmthPrompt, settings.highWarmthPrompt],
    [settingKeys.lowWarmthPrompt, settings.lowWarmthPrompt],
    [settingKeys.model, settings.model],
    [settingKeys.questions, JSON.stringify(settings.questions)],
    [settingKeys.welcomeHigh, settings.welcomeHigh],
    [settingKeys.welcomeLow, settings.welcomeLow],
  ];
  if (options.apiKey?.trim()) {
    values.push([settingKeys.apiKey, encryptApiKey(options.apiKey.trim())]);
  }
  const statements = values.map(([key, value]) =>
    db
      .insert(practiceAdminSetting)
      .values({ key, updatedAt: new Date(), value })
      .onConflictDoUpdate({
        set: { updatedAt: new Date(), value },
        target: practiceAdminSetting.key,
      })
  );
  await db.batch(
    statements as [
      (typeof statements)[number],
      ...(typeof statements)[number][],
    ]
  );
  if (options.clearApiKey && !options.apiKey?.trim()) {
    await db
      .delete(practiceAdminSetting)
      .where(eq(practiceAdminSetting.key, settingKeys.apiKey));
  }
  return getPracticeAdminSettings();
}
