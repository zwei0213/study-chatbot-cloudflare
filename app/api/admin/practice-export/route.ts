import { listPracticeAdminExportRows } from "@/lib/practice/queries";
import { isStudyAdminAuthenticated } from "@/lib/study/admin";

function csv(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text.trimStart())) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  if (!(await isStudyAdminAuthenticated())) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const rows = await listPracticeAdminExportRows();
    const columns = [
      "session_id",
      "participant_code",
      "user_id",
      "condition",
      "phase",
      "prompt_version",
      "system_prompt",
      "session_created_at",
      "message_sequence",
      "message_id",
      "message_role",
      "message_kind",
      "question_id",
      "answer_correct",
      "message_created_at",
      "content",
    ];
    const lines = rows.map((row) =>
      [
        row.sessionId,
        row.participantCode,
        row.userId,
        row.condition,
        row.phase,
        row.promptVersion,
        row.systemPrompt,
        row.createdAt.toISOString(),
        row.sequence,
        row.messageId,
        row.role,
        row.messageKind,
        row.questionId,
        row.answerGrade === null
          ? ""
          : row.answerGrade
            ? "correct"
            : "incorrect",
        row.messageCreatedAt?.toISOString(),
        row.message,
      ]
        .map(csv)
        .join(",")
    );
    return new Response(
      `\uFEFF${[columns.map(csv).join(","), ...lines].join("\r\n")}`,
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": 'attachment; filename="practice-records.csv"',
          "Content-Type": "text/csv; charset=utf-8",
        },
      }
    );
  } catch (error) {
    console.error("Practice admin export failed:", error);
    return new Response("Export unavailable", { status: 503 });
  }
}
