import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { deleteStudyAdminSetting, getStudyAdminSetting } from "./queries";

export const STUDY_ADMIN_COOKIE = "study_admin_session";
const API_KEY_SETTING = "deepseek_api_key";
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function getAdminToken() {
  return process.env.STUDY_ADMIN_TOKEN ?? "";
}

function constantTimeEqual(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length > 0 &&
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

export function isStudyAdminTokenConfigured() {
  return getAdminToken().length >= 32;
}

export function verifyStudyAdminToken(supplied: string) {
  const expected = getAdminToken();
  return expected.length >= 32 && constantTimeEqual(expected, supplied);
}

function createStudyAdminCookieValue() {
  const issuedAt = Date.now().toString();
  const signature = createHmac("sha256", getAdminToken())
    .update(`study-admin-session-v1:${issuedAt}`)
    .digest("base64url");
  return `${issuedAt}.${signature}`;
}

export function verifyStudyAdminCookie(value: string | undefined) {
  if (!value || !isStudyAdminTokenConfigured()) {
    return false;
  }
  const [issuedAtText, suppliedSignature, extra] = value.split(".");
  const issuedAt = Number(issuedAtText);
  if (
    extra !== undefined ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > Date.now() ||
    Date.now() - issuedAt > ADMIN_SESSION_TTL_MS
  ) {
    return false;
  }
  const expectedSignature = createHmac("sha256", getAdminToken())
    .update(`study-admin-session-v1:${issuedAtText}`)
    .digest("base64url");
  return constantTimeEqual(expectedSignature, suppliedSignature ?? "");
}

export async function isStudyAdminAuthenticated() {
  const cookieStore = await cookies();
  return verifyStudyAdminCookie(cookieStore.get(STUDY_ADMIN_COOKIE)?.value);
}

export function getStudyAdminCookieValue() {
  if (!isStudyAdminTokenConfigured()) {
    throw new Error("STUDY_ADMIN_TOKEN must be at least 32 characters long.");
  }
  return createStudyAdminCookieValue();
}

function getEncryptionKey() {
  const secret = getAdminToken();
  if (secret.length < 32) {
    throw new Error("STUDY_ADMIN_TOKEN must be at least 32 characters long.");
  }
  return createHash("sha256")
    .update("study-admin-api-key-v1\0")
    .update(secret)
    .digest();
}

export function encryptStudyApiKey(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
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

export function decryptStudyApiKey(encrypted: string) {
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
    throw new Error("Stored API key has an unsupported format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function getStudyApiKey() {
  const setting = await getStudyAdminSetting(API_KEY_SETTING);
  if (setting) {
    try {
      return decryptStudyApiKey(setting.value);
    } catch (error) {
      if (process.env.DEEPSEEK_API_KEY) {
        return process.env.DEEPSEEK_API_KEY;
      }
      throw error;
    }
  }
  return process.env.DEEPSEEK_API_KEY ?? null;
}

export async function getStudyApiKeyStatus() {
  const setting = await getStudyAdminSetting(API_KEY_SETTING);
  let storedKeyIsReadable = true;
  if (setting) {
    try {
      decryptStudyApiKey(setting.value);
    } catch {
      storedKeyIsReadable = false;
    }
  }
  const source = setting
    ? storedKeyIsReadable
      ? "admin"
      : "unavailable"
    : process.env.DEEPSEEK_API_KEY
      ? "environment"
      : "none";
  return {
    configured:
      source === "admin" ||
      source === "environment" ||
      (source === "unavailable" && Boolean(process.env.DEEPSEEK_API_KEY)),
    fallbackAvailable: Boolean(process.env.DEEPSEEK_API_KEY),
    source,
    updatedAt: setting?.updatedAt.toISOString() ?? null,
  } as const;
}

export async function clearStudyApiKeyOverride() {
  await deleteStudyAdminSetting(API_KEY_SETTING);
}
