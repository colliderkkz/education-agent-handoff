import { getChatGPTUser } from "../../chatgpt-auth";
import { loadContentBank } from "../../../lib/content-bank";
import { resolveAccess } from "../../../lib/server/memberships";
import { errorResponse, json } from "../../../lib/server/http";
import { subjectOfKnowledge, stageOfKnowledge, type Question } from "@/lib/types";

const PAGE_SIZE = 50;

/**
 * 静态内容库浏览接口。
 *
 * 题库带答案与完整讲解，绝不能下发给学生、家长或教师角色 ——
 * 教研角色（owner / editor / reviewer）才可以按需分页取题。
 * 库本身不进客户端 bundle，因此只能走接口按需取。
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ error: "请先使用 ChatGPT 登录" }, 401);
    const access = await resolveAccess(user);
    if (!["owner", "editor", "reviewer"].includes(access.role)) return json({ error: "当前身份没有查看题库的权限" }, 403);

    const url = new URL(request.url);
    const subject = url.searchParams.get("subject") ?? "";
    const point = url.searchParams.get("point") ?? "";
    const keyword = url.searchParams.get("q") ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);

    const bank = loadContentBank();
    let questions = bank.questions;
    if (subject) questions = questions.filter(q => subjectOfKnowledge(q.knowledgeId) === subject);
    if (point) questions = questions.filter(q => q.knowledgeId === point);
    if (keyword.trim()) {
      const needle = keyword.trim();
      questions = questions.filter(q => q.text.includes(needle) || q.id.includes(needle) || q.source.includes(needle));
    }

    const counts: Record<string, Record<string, number>> = {};
    for (const question of bank.questions) {
      const subjectId = subjectOfKnowledge(question.knowledgeId);
      if (!subjectId) continue;
      const stage = stageOfKnowledge(question.knowledgeId);
      counts[stage] = counts[stage] ?? {};
      counts[stage][subjectId] = (counts[stage][subjectId] ?? 0) + 1;
    }
    const start = (page - 1) * PAGE_SIZE;
    const items = questions.slice(start, start + PAGE_SIZE).map(bankItem);
    return json({
      version: bank.version,
      digest: bank.digest,
      counts,
      total: questions.length,
      page,
      pageSize: PAGE_SIZE,
      hasMore: start + PAGE_SIZE < questions.length,
      items,
    });
  } catch (error) { return errorResponse(error); }
}

function bankItem(q: Question) {
  return {
    id: q.id, familyId: q.familyId, version: q.version, knowledgeId: q.knowledgeId,
    taskType: q.taskType, contextId: q.contextId, difficulty: q.difficulty,
    text: q.text, answer: q.answer, unit: q.unit, source: q.source, sourceScope: q.sourceScope,
    steps: q.steps, hint: q.hint, alternative: q.alternative, prerequisites: q.prerequisites,
    image: q.image ?? null,
  };
}
