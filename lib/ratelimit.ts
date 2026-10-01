import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isProductionEnvironment } from "@/lib/constants";

type RateLimitBinding = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

type CloudflareRateLimitEnv = {
  CHAT_RATE_LIMITER?: RateLimitBinding;
  ADMIN_RATE_LIMITER?: RateLimitBinding;
};

export class RateLimitError extends Error {}

export async function checkIpRateLimit(
  request: Request,
  purpose: "chat" | "admin"
) {
  if (!isProductionEnvironment) {
    return;
  }

  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) {
    throw new Error("Cloudflare client IP header is missing.");
  }

  const { env } = await getCloudflareContext({ async: true });
  const bindings = env as CloudflareRateLimitEnv;
  const limiter =
    purpose === "chat"
      ? bindings.CHAT_RATE_LIMITER
      : bindings.ADMIN_RATE_LIMITER;
  if (!limiter) {
    throw new Error(`Cloudflare ${purpose} rate limit binding is missing.`);
  }

  const { success } = await limiter.limit({ key: ip });
  if (!success) {
    throw new RateLimitError("Too many requests");
  }
}
