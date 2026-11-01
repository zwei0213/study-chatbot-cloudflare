import { z } from "zod";
import {
  deletePracticeAdminSession,
  getPracticeAdminDetail,
  listPracticeAdminSessions,
} from "@/lib/practice/queries";
import { isStudyAdminAuthenticated } from "@/lib/study/admin";

const idSchema = z.uuid();

export async function GET(request: Request) {
  if (!(await isStudyAdminAuthenticated())) {
    return Response.json({ error: "请先登录管理员后台。" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const id = params.get("sessionId");
  const rawCode = params.get("code")?.trim().toUpperCase();
  if (rawCode && !/^[A-Z0-9]{1,15}$/.test(rawCode)) {
    return Response.json({ error: "完成编码格式无效。" }, { status: 400 });
  }
  try {
    if (id) {
      if (!idSchema.safeParse(id).success) {
        return Response.json({ error: "记录编号格式无效。" }, { status: 400 });
      }
      const detail = await getPracticeAdminDetail(id);
      if (!detail) {
        return Response.json(
          { error: "找不到这条陪练记录。" },
          { status: 404 }
        );
      }
      return Response.json(detail, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const sessions = await listPracticeAdminSessions(rawCode);
    return Response.json(
      { sessions },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Practice admin history lookup failed:", error);
    return Response.json({ error: "读取陪练记录失败。" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isStudyAdminAuthenticated())) {
    return Response.json({ error: "请先登录管理员后台。" }, { status: 401 });
  }
  const body = z
    .object({ sessionId: idSchema })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "记录编号格式无效。" }, { status: 400 });
  }
  try {
    const deleted = await deletePracticeAdminSession(body.data.sessionId);
    if (!deleted) {
      return Response.json({ error: "找不到这条陪练记录。" }, { status: 404 });
    }
    return Response.json(
      { deleted: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Practice admin record deletion failed:", error);
    return Response.json({ error: "删除陪练记录失败。" }, { status: 503 });
  }
}
