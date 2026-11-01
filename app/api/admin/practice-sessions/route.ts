import { z } from "zod";
import {
  getPracticeAdminDetail,
  listPracticeAdminSessions,
} from "@/lib/practice/queries";
import { isStudyAdminAuthenticated } from "@/lib/study/admin";

const idSchema = z.uuid();

export async function GET(request: Request) {
  if (!(await isStudyAdminAuthenticated())) {
    return Response.json({ error: "请先登录管理员后台。" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("sessionId");
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
    const sessions = await listPracticeAdminSessions();
    return Response.json(
      { sessions },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Practice admin history lookup failed:", error);
    return Response.json({ error: "读取陪练记录失败。" }, { status: 503 });
  }
}
