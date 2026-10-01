import { z } from "zod";
import { isStudyAdminAuthenticated } from "@/lib/study/admin";
import {
  deleteStudyAdminSession,
  getStudyAdminSessionDetail,
  listStudyAdminSessions,
} from "@/lib/study/queries";
import { isStudyCondition } from "@/lib/study/study";

const sessionIdSchema = z.uuid();
const PAGE_SIZE = 20;

export async function GET(request: Request) {
  if (!(await isStudyAdminAuthenticated())) {
    return Response.json({ error: "请先登录管理员后台。" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId");
  if (sessionId) {
    if (!sessionIdSchema.safeParse(sessionId).success) {
      return Response.json({ error: "对话编号格式无效。" }, { status: 400 });
    }
    try {
      const detail = await getStudyAdminSessionDetail(sessionId);
      if (!detail) {
        return Response.json(
          { error: "找不到这条对话记录。" },
          { status: 404 }
        );
      }
      return Response.json(detail, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      console.error("Study admin conversation lookup failed:", error);
      return Response.json(
        { error: "读取对话详情失败，请稍后重试。" },
        { status: 503 }
      );
    }
  }

  const pageValue = Number(params.get("page") ?? 1);
  const page = Number.isInteger(pageValue)
    ? Math.min(100_000, Math.max(1, pageValue))
    : 1;
  const conditionValue = params.get("condition") ?? "all";
  const condition =
    conditionValue === "all" || isStudyCondition(conditionValue)
      ? conditionValue
      : "all";
  const query = (params.get("q") ?? "").trim().slice(0, 72);

  try {
    const result = await listStudyAdminSessions({
      condition,
      page,
      pageSize: PAGE_SIZE,
      query,
    });
    return Response.json(
      { ...result, page, pageSize: PAGE_SIZE },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Study admin history lookup failed:", error);
    return Response.json(
      { error: "读取历史记录失败，请稍后重试。" },
      { status: 503 }
    );
  }
}

export async function DELETE(request: Request) {
  if (!(await isStudyAdminAuthenticated())) {
    return Response.json({ error: "请先登录管理员后台。" }, { status: 401 });
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId || !sessionIdSchema.safeParse(sessionId).success) {
    return Response.json({ error: "对话编号格式无效。" }, { status: 400 });
  }

  try {
    const deleted = await deleteStudyAdminSession(sessionId);
    if (!deleted) {
      return Response.json({ error: "找不到这条对话记录。" }, { status: 404 });
    }
    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Study admin conversation deletion failed:", error);
    return Response.json(
      { error: "删除对话失败，请稍后重试。" },
      { status: 503 }
    );
  }
}
