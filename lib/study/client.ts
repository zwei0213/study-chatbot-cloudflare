export class StudyApiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StudyApiError";
  }
}

function invalidResponse(response: Response, cause?: unknown) {
  console.warn("Unexpected study API response", {
    contentType: response.headers.get("Content-Type"),
    rayId: response.headers.get("cf-ray"),
    redirected: response.redirected,
    status: response.status,
  });
  if (response.redirected || response.status === 401) {
    return new StudyApiError("会话验证已失效，请刷新页面后重试。", { cause });
  }
  if (response.headers.get("cf-mitigated") === "challenge") {
    return new StudyApiError(
      "请求被网站安全验证拦截，请在系统浏览器中打开链接并完成验证。",
      { cause }
    );
  }
  if (response.status >= 500) {
    return new StudyApiError(
      `服务器暂时无法响应（HTTP ${response.status}），请稍后重试。`,
      { cause }
    );
  }
  return new StudyApiError("服务器返回的内容格式异常，请刷新页面后重试。", {
    cause,
  });
}

export async function readStudyJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (
    response.redirected ||
    !/application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)
  ) {
    throw invalidResponse(response);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (cause) {
    throw invalidResponse(response, cause);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw invalidResponse(response);
  }
  if (!response.ok) {
    const { error } = data as { error?: unknown };
    throw typeof error === "string" && error
      ? new StudyApiError(error)
      : invalidResponse(response);
  }
  return data as T;
}

export type StudyChatEvent<TMessage> =
  | { type: "delta"; text: string }
  | { type: "done"; messages: TMessage[] };

export async function readStudyChatStream<TMessage>(
  response: Response,
  onEvent: (event: StudyChatEvent<TMessage>) => void
) {
  if (!response.ok) {
    await readStudyJson(response);
  }
  if (
    response.redirected ||
    !/^text\/event-stream\b/i.test(response.headers.get("Content-Type") ?? "")
  ) {
    throw invalidResponse(response);
  }
  if (!response.body) {
    throw new StudyApiError("无法读取 AI 回复，请重试。");
  }

  const reader = response.body.getReader();
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
    let event: {
      type?: unknown;
      text?: unknown;
      messages?: unknown;
      error?: unknown;
    };
    try {
      event = JSON.parse(data);
    } catch (cause) {
      throw new StudyApiError("AI 回复的数据格式异常，请稍后重试。", { cause });
    }
    if (!event || typeof event !== "object") {
      throw new StudyApiError("AI 回复的数据格式异常，请稍后重试。");
    }
    if (event.type === "delta" && typeof event.text === "string") {
      onEvent({ text: event.text, type: "delta" });
    } else if (event.type === "done" && Array.isArray(event.messages)) {
      onEvent({ messages: event.messages as TMessage[], type: "done" });
      completed = true;
    } else if (event.type === "error") {
      throw new StudyApiError(
        typeof event.error === "string" ? event.error : "发送失败，请重试。"
      );
    } else {
      throw new StudyApiError("AI 回复的数据格式异常，请稍后重试。");
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
      throw new StudyApiError("AI 回复连接中断，请重试。");
    }
  } finally {
    // A done event confirms that the exchange was saved. Do not wait for the
    // connection to close or restore a sent message because of a later read error.
    if (!streamEnded) {
      reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

export function getStudyErrorMessage(cause: unknown, fallback: string) {
  if (cause instanceof StudyApiError) {
    return cause.message;
  }
  if (
    cause instanceof Error &&
    (cause.name === "AbortError" || cause.name === "TimeoutError")
  ) {
    return "请求超时或连接中断，请稍后重试。";
  }
  if (cause instanceof Error && cause.name === "TypeError") {
    return "网络连接失败，请检查网络后重试。";
  }
  return fallback;
}
