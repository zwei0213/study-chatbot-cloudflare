import { z } from "zod";
import {
  getPracticeAdminSettings,
  savePracticeAdminSettings,
} from "@/lib/practice/config";
import { practiceSettingsSchema } from "@/lib/practice/validation";
import { isStudyAdminAuthenticated } from "@/lib/study/admin";

const updateSchema = z.object({
  apiKey: z.string().max(500).optional(),
  clearApiKey: z.boolean().optional(),
  settings: practiceSettingsSchema,
});

export async function GET() {
  if (!(await isStudyAdminAuthenticated())) {
    return Response.json({ error: "请先登录管理员后台。" }, { status: 401 });
  }
  try {
    return Response.json(await getPracticeAdminSettings(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Practice admin settings read failed:", error);
    return Response.json({ error: "读取陪练设置失败。" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  if (!(await isStudyAdminAuthenticated())) {
    return Response.json({ error: "请先登录管理员后台。" }, { status: 401 });
  }
  const body = updateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { error: body.error.issues[0]?.message ?? "设置内容无效。" },
      { status: 400 }
    );
  }
  try {
    const settings = await savePracticeAdminSettings(body.data.settings, {
      apiKey: body.data.apiKey,
      clearApiKey: body.data.clearApiKey,
    });
    return Response.json(settings, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Practice admin settings save failed:", error);
    return Response.json({ error: "保存陪练设置失败。" }, { status: 503 });
  }
}
