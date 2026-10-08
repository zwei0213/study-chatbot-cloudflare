import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Run against the local fix without starting a server or making AI requests.
const source = await readFile(
  new URL("../lib/study/client.ts", import.meta.url),
  "utf8"
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const {
  readStudyJson,
  readStudyChatStream,
  getStudyErrorMessage,
  StudyApiError,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

function streamResponse(body) {
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
const event = (value) => `data: ${JSON.stringify(value)}\n\n`;

test("valid JSON remains readable", async () => {
  assert.deepEqual(
    await readStudyJson(Response.json({ participantId: "test" })),
    { participantId: "test" }
  );
});
test("empty 405 response from the live redirect chain is handled", async () => {
  await assert.rejects(
    readStudyChatStream(new Response(null, { status: 405 }), () => undefined),
    (error) =>
      error instanceof StudyApiError && error.message.includes("格式异常")
  );
});
test("HTML gateway failure is handled", async () => {
  await assert.rejects(
    readStudyJson(
      new Response("<html>Error</html>", {
        headers: { "Content-Type": "text/html" },
        status: 502,
      })
    ),
    /HTTP 502/
  );
});
test("HTML challenge is identified", async () => {
  await assert.rejects(
    readStudyJson(
      new Response("<html>Challenge</html>", {
        headers: { "Content-Type": "text/html", "cf-mitigated": "challenge" },
      })
    ),
    /安全验证/
  );
});
test("JSON authentication error is retained", async () => {
  await assert.rejects(
    readStudyJson(
      Response.json(
        { error: "会话验证已失效，请刷新页面后重试。" },
        { status: 401 }
      )
    ),
    /会话验证已失效/
  );
});
test("redirected response is rejected", async () => {
  const response = Response.json({ unused: true });
  Object.defineProperty(response, "redirected", { value: true });
  await assert.rejects(readStudyJson(response), /会话验证已失效/);
});
test("invalid JSON is translated to an application error", async () => {
  await assert.rejects(
    readStudyJson(
      new Response("{", { headers: { "Content-Type": "application/json" } })
    ),
    StudyApiError
  );
});
test("UTF-8 and CRLF work even with one-byte chunks", async () => {
  const bytes = new TextEncoder().encode(
    (
      ": heartbeat\n\n" +
      event({ text: "你好 😔", type: "delta" }) +
      event({ messages: [{ id: "saved" }], type: "done" })
    ).replace(/\n/g, "\r\n")
  );
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index === bytes.length) {
        controller.close();
      } else {
        controller.enqueue(bytes.slice(index, index + 1));
        index += 1;
      }
    },
  });
  const received = [];
  await readStudyChatStream(streamResponse(stream), (value) =>
    received.push(value)
  );
  assert.deepEqual(received, [
    { text: "你好 😔", type: "delta" },
    { messages: [{ id: "saved" }], type: "done" },
  ]);
});
test("connection ending without a done event is rejected", async () => {
  await assert.rejects(
    readStudyChatStream(
      streamResponse(event({ text: "partial", type: "delta" })),
      () => undefined
    ),
    /连接中断/
  );
});
test("malformed stream JSON is rejected safely", async () => {
  await assert.rejects(
    readStudyChatStream(streamResponse("data: {\n\n"), () => undefined),
    /数据格式异常/
  );
});
test("server error event is retained", async () => {
  await assert.rejects(
    readStudyChatStream(
      streamResponse(event({ error: "AI 暂时无法回复", type: "error" })),
      () => undefined
    ),
    /AI 暂时无法回复/
  );
});
test("done event completes without waiting for transport closure", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() {
      cancelled = true;
    },
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(event({ messages: [], type: "done" }))
      );
    },
  });
  await readStudyChatStream(streamResponse(stream), () => undefined);
  assert.equal(cancelled, true);
});
test("native browser errors are not shown verbatim", () => {
  assert.equal(
    getStudyErrorMessage(
      new DOMException(
        "The string did not match the expected pattern.",
        "SyntaxError"
      ),
      "发送失败，请重试。"
    ),
    "发送失败，请重试。"
  );
  assert.match(
    getStudyErrorMessage(new TypeError("Failed to fetch"), "fallback"),
    /网络连接失败/
  );
  assert.match(
    getStudyErrorMessage(new DOMException("aborted", "AbortError"), "fallback"),
    /请求超时/
  );
});
