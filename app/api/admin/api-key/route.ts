import {
  clearStudyApiKeyOverride,
  encryptStudyApiKey,
  getStudyApiKeyStatus,
  isStudyAdminAuthenticated,
} from "@/lib/study/admin";
import { setStudyAdminSetting } from "@/lib/study/queries";

const API_KEY_SETTING = "deepseek_api_key";

function unauthorized() {
  return Response.json({ error: "请先登录管理员后台。" }, { status: 401 });
}

export async function GET() {
  if (!(await isStudyAdminAuthenticated())) {
    return unauthorized();
  }
  try {
    const status = await getStudyApiKeyStatus();
    return Response.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Study admin API key status lookup failed:", error);
    return Response.json({ error: "读取 API Key 状态失败。" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  if (!(await isStudyAdminAuthenticated())) {
    return unauthorized();
  }
  const body = (await request.json().catch(() => null)) as {
    apiKey?: unknown;
  } | null;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (apiKey.length < 8 || apiKey.length > 512) {
    return Response.json(
      { error: "API Key 长度需在 8 到 512 个字符之间。" },
      { status: 400 }
    );
  }

  try {
    await setStudyAdminSetting(API_KEY_SETTING, encryptStudyApiKey(apiKey));
    return Response.json(
      { ...(await getStudyApiKeyStatus()), saved: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Study admin API key update failed:", error);
    return Response.json(
      {
        error:
          "保存失败。请确认 STUDY_ADMIN_TOKEN 已配置为至少 32 个字符，并检查数据库连接。",
      },
      { status: 503 }
    );
  }
}

export async function DELETE() {
  if (!(await isStudyAdminAuthenticated())) {
    return unauthorized();
  }
  try {
    await clearStudyApiKeyOverride();
    return Response.json(
      { ...(await getStudyApiKeyStatus()), deleted: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Study admin API key reset failed:", error);
    return Response.json(
      { error: "恢复环境变量 API Key 失败。" },
      { status: 503 }
    );
  }
}
