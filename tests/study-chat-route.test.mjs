import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { loadTypeScript } from "./load-typescript.mjs";

const participantId = "ec794982-08ee-4e4f-aab8-b956c84cd183";
const timing = loadTypeScript("../lib/study/timing.ts");
const upstream = loadTypeScript("../lib/study/upstream.ts");
const client = loadTypeScript("../lib/study/client.ts");
class RateLimitError extends Error {}

function setup(options = {}) {
  const saved = [];
  const calls = [];
  const dependencies = {
    "@/app/(auth)/auth": {
      auth: async () => (options.anonymous ? null : { user: { id: "owner" } }),
    },
    "@/lib/ratelimit": {
      checkIpRateLimit() {
        if (options.rateError) {
          return Promise.reject(options.rateError);
        }
        return Promise.resolve();
      },
      RateLimitError,
    },
    "@/lib/study/admin": { getStudyApiKey: async () => "test-key" },
    "@/lib/study/queries": {
      getStudyMessages: async () => [],
      getStudySession: async () => ({
        endedAt: options.ended ? new Date() : null,
        id: participantId,
        model: "test-model",
        startedAt: new Date(),
        systemPrompt: "test prompt",
        userId: options.otherOwner ? "someone-else" : "owner",
      }),
      saveStudyExchange(...args) {
        if (options.saveError) {
          return Promise.reject(options.saveError);
        }
        saved.push(args);
        return Promise.resolve([]);
      },
    },
    "@/lib/study/study": { getStudyMaxExchanges: () => null },
    "@/lib/study/timing": timing,
    "@/lib/study/upstream": upstream,
    zod: { z },
  };
  const { POST } = loadTypeScript(
    "../app/api/study/chat/route.ts",
    dependencies,
    {
      fetch(_url, init) {
        calls.push(init);
        return Promise.resolve(
          options.modelResponse ??
            new Response(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "回复" } }] })}\n\ndata: [DONE]\n\n`
            )
        );
      },
    }
  );
  return {
    calls,
    post(body = { participantId, text: "你好" }) {
      return POST(
        new Request("https://test.example/api/study/chat", {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );
    },
    saved,
  };
}

test("unauthenticated chat sends return JSON 401 without a guest redirect", async () => {
  const state = setup({ anonymous: true });
  const response = await state.post();
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Location"), null);
  assert.equal(typeof (await response.json()).error, "string");
  assert.equal(state.calls.length, 0);
});

test("ownership and ended-session checks block model requests", async () => {
  for (const [options, status] of [
    [{ otherOwner: true }, 403],
    [{ ended: true }, 409],
  ]) {
    const state = setup(options);
    // biome-ignore lint/performance/noAwaitInLoops: Each authorization case is independent.
    const response = await state.post();
    assert.equal(response.status, status);
    assert.equal(state.calls.length, 0);
  }
});

test("invalid messages are rejected before calling the model", async () => {
  const state = setup();
  const response = await state.post({ participantId, text: "x".repeat(2001) });
  assert.equal(response.status, 400);
  assert.equal(state.calls.length, 0);
});

test("rate limit configuration errors are distinguished from exhausted limits", async () => {
  for (const [rateError, status] of [
    [new RateLimitError("limited"), 429],
    [new Error("missing binding"), 503],
  ]) {
    const state = setup({ rateError });
    // biome-ignore lint/performance/noAwaitInLoops: Each limiter failure is independent.
    const response = await state.post();
    assert.equal(response.status, status);
    assert.equal(state.calls.length, 0);
  }
});

test("streaming completes after the complete exchange is saved", async () => {
  const state = setup();
  const response = await state.post();
  const events = [];
  await client.readStudyChatStream(response, (event) => events.push(event));
  assert.equal(events[0].text, "回复");
  assert.equal(events.at(-1).type, "done");
  assert.deepEqual(state.saved[0], [participantId, "你好", "回复"]);
});

test("an upstream disconnect never saves a partial exchange", async () => {
  const state = setup({
    modelResponse: new Response(
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
    ),
  });
  const response = await state.post();
  await assert.rejects(
    client.readStudyChatStream(response, () => undefined),
    /中断或保存失败/
  );
  assert.equal(state.saved.length, 0);
});

test("session state changes during generation return a useful error", async () => {
  const state = setup({
    saveError: new timing.StudySessionError("本次对话已经结束。"),
  });
  const response = await state.post();
  await assert.rejects(
    client.readStudyChatStream(response, () => undefined),
    /本次对话已经结束/
  );
});
