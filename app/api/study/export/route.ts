import { timingSafeEqual } from "node:crypto";
import { getStudyExportRows } from "@/lib/study/queries";
import { getStudyElapsedSeconds } from "@/lib/study/timing";

function authorized(request: Request) {
  const secret = process.env.STUDY_ADMIN_TOKEN;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer /i, "");
  if (!secret || !supplied) {
    return false;
  }
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function csv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const rows = await getStudyExportRows();
    const header = [
      "participant_id",
      "condition",
      "session_created_at",
      "message_id",
      "message_sequence",
      "role",
      "content",
      "message_created_at",
      "model",
      "system_prompt",
      "started_at",
      "ended_at",
      "duration_seconds",
    ];
    const lines = rows.map((row) =>
      [
        row.participantId,
        row.condition,
        row.sessionCreatedAt.toISOString(),
        row.messageId ?? "",
        row.sequence?.toString() ?? "",
        row.role ?? "",
        row.content ?? "",
        row.messageCreatedAt?.toISOString() ?? "",
        row.model,
        row.systemPrompt,
        row.startedAt?.toISOString() ?? "",
        row.endedAt?.toISOString() ?? "",
        row.startedAt && row.endedAt
          ? getStudyElapsedSeconds(row.startedAt, row.endedAt, 0).toString()
          : "",
      ]
        .map(csv)
        .join(",")
    );
    return new Response(`\uFEFF${[header.join(","), ...lines].join("\r\n")}`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="study-conversations.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Study export failed:", error);
    return new Response("Export unavailable", { status: 503 });
  }
}
