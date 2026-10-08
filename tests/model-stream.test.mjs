import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./load-typescript.mjs";

const { readModelStream } = loadTypeScript("../lib/study/upstream.ts");
const encoder = new TextEncoder();
const delta = (text) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

test("model completion finishes while the upstream connection stays open", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
    start(controller) {
      controller.enqueue(encoder.encode(`${delta("你好")}data: [DONE]\n\n`));
    },
  });
  const received = [];
  await readModelStream(body, (text) => received.push(text));
  assert.deepEqual(received, ["你好"]);
  assert.equal(cancelled, true);
});

test("model UTF-8 and CRLF are preserved across one-byte chunks", async () => {
  const bytes = encoder.encode(
    `${delta("你好 😔")}data: [DONE]\r\n\r\n`
      .replace(/\n/g, "\r\n")
      .replace(/\r\r\n/g, "\r\n")
  );
  let offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
      } else {
        controller.enqueue(bytes.slice(offset, offset + 1));
        offset += 1;
      }
    },
  });
  let received = "";
  await readModelStream(body, (text) => {
    received += text;
  });
  assert.equal(received, "你好 😔");
});

test("incomplete model streams are rejected instead of saving a partial reply", async () => {
  await assert.rejects(
    readModelStream(new Response(delta("partial")).body, () => undefined),
    /without a completion event/
  );
});

test("malformed and provider error events are rejected", async () => {
  for (const event of ["data: {\n\n", 'data: {"error":"failed"}\n\n']) {
    // biome-ignore lint/performance/noAwaitInLoops: Each test input is checked independently.
    await assert.rejects(
      readModelStream(new Response(event).body, () => undefined)
    );
  }
});
