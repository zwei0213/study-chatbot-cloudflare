export async function readModelStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let streamEnded = false;

  const handleEvent = (rawEvent: string) => {
    const data = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) {
      return;
    }
    if (data === "[DONE]") {
      completed = true;
      return;
    }
    const chunk = JSON.parse(data) as {
      choices?: { delta?: { content?: unknown } }[];
      error?: unknown;
    };
    if (!chunk || typeof chunk !== "object" || chunk.error) {
      throw new Error("Invalid model stream response");
    }
    const text = chunk.choices?.[0]?.delta?.content;
    if (typeof text === "string" && text.length > 0) {
      onText(text);
    }
  };

  try {
    while (!completed) {
      // biome-ignore lint/performance/noAwaitInLoops: Stream chunks must be consumed in order.
      const { done, value } = await reader.read();
      streamEnded = done;
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1 && !completed) {
        handleEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) {
        if (!completed && buffer.trim()) {
          handleEvent(buffer);
        }
        break;
      }
    }
    if (!completed) {
      throw new Error("Model stream ended without a completion event");
    }
  } finally {
    // Completion does not require waiting for the upstream transport to close.
    if (!streamEnded) {
      reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}
