"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Database, Layers3, Search } from "lucide-react";
import { curriculumCatalog, type CatalogSubject } from "@/lib/curriculum-catalog";
import { shanghaiCatalog } from "@/lib/curriculum-catalog-shanghai";
import { stageNames, type StageId } from "@/lib/types";
import QuestionFigure from "./question-figure";
import "./admin-workspace.css";

type BankItem = {
  id: string; familyId: string; version: number; knowledgeId: string;
  taskType?: string; contextId?: string; difficulty: string;
  text: string; answer: string; unit: string; source: string; sourceScope: string;
  steps: string[]; hint: string; alternative: string; prerequisites: string[]; image?: string | null;
};
type BankResponse = {
  version: string; digest: string; counts: Record<string, Record<string, number>>;
  total: number; page: number; pageSize: number; hasMore: boolean; items: BankItem[];
};

/** 学科目录所属学段。小学目录没有 stage 字段。 */
const stageOfSubject = (subject: CatalogSubject): StageId => subject.stage ?? "primary";
const countSum = (counts: Record<string, number> | undefined) =>
  counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : 0;

const taskTypeNames: Record<string, string> = { basic: "基础任务", application: "应用任务", transfer: "迁移任务" };

/**
 * 静态内容库浏览面板。
 *
 * 库里的题目是仓库内的只读产物，带完整答案与讲解，因此只对教研角色开放
 * （接口层也会再校验一次）。这里明确标出「未经逐题人工复核」，
 * 不让教研把机器校验误读成人工审核。
 */
export function AdminBankPanel() {
  const [stage, setStage] = useState("");
  const [subject, setSubject] = useState("");
  const [point, setPoint] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<{ data: BankResponse | null; error: string; loading: boolean }>({ data: null, error: "", loading: true });

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (subject) params.set("subject", subject);
    if (point) params.set("point", point);
    if (keyword.trim()) params.set("q", keyword.trim());
    params.set("page", String(page));
    fetch(`/api/content-bank?${params.toString()}`)
      .then(async (response) => {
        const body = await response.json() as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "题库暂时无法读取");
        if (active) setView({ data: body as BankResponse, error: "", loading: false });
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setView({ data: null, error: failure instanceof Error ? failure.message : "题库暂时无法读取", loading: false });
      });
    return () => { active = false; };
  }, [subject, point, keyword, page]);

  const { data, error, loading } = view;

  // 目录来自小学与上海初高中三套，学段与学科分别筛选。
  const allSubjects = useMemo(() => [...curriculumCatalog, ...shanghaiCatalog], []);
  const stageOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const item of allSubjects) {
      const stage = stageOfSubject(item);
      if (!seen.has(stage)) seen.add(stage);
    }
    return [...seen];
  }, [allSubjects]);
  const visibleSubjects = useMemo(
    () => allSubjects.filter(item => (!stage || stageOfSubject(item) === stage) && (!subject || item.id === subject)),
    [allSubjects, stage, subject],
  );
  const points = useMemo(
    () => visibleSubjects.flatMap(item => item.units.flatMap(unit => unit.points.map(point => ({ subject: item.id, point })))),
    [visibleSubjects],
  );

  return (
    <>
      <div className="admin-metrics">
        <Metric label="静态库题目" value={data?.total ?? 0} detail="仓库内只读题库" icon={Database} accent />
        <Metric label="小学" value={countSum(data?.counts.primary)} detail="四年级上册" icon={Layers3} />
        <Metric label="初中" value={countSum(data?.counts.junior)} detail="上海中考考纲" icon={Layers3} />
        <Metric label="高中" value={countSum(data?.counts.senior)} detail="上海高考考纲" icon={Layers3} />
      </div>

      <div className="admin-notice admin-notice-warning">
        <AlertTriangle size={16} />
        <span>静态库题目由教研模板批量编写并通过自动校验脚本，<strong>未经逐题人工复核</strong>，不代表教学有效性已验证。正式投放前请由教研逐题核对。</span>
      </div>

      <div className="admin-filters">
        <select className="input" value={stage} onChange={(event) => { setStage(event.target.value); setSubject(""); setPoint(""); setPage(1); }} aria-label="筛选学段">
          <option value="">全部学段</option>
          {stageOptions.map(item => <option key={item} value={item}>{stageNames[item as StageId]}</option>)}
        </select>
        <select className="input" value={subject} onChange={(event) => { setSubject(event.target.value); setPoint(""); setPage(1); }} aria-label="筛选学科">
          <option value="">全部学科</option>
          {visibleSubjects.map(item => <option key={`${stageOfSubject(item)}-${item.id}`} value={item.id}>{item.name}（{stageNames[stageOfSubject(item)]}）</option>)}
        </select>
        <select className="input" value={point} onChange={(event) => { setPoint(event.target.value); setPage(1); }} aria-label="筛选知识点">
          <option value="">全部知识点</option>
          {points.map(item => <option key={item.point.id} value={item.point.id}>{item.point.name}</option>)}
        </select>
        <span className="admin-search"><Search size={15} /><input className="input" value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} placeholder="搜索题干、题号或来源" aria-label="搜索题库" /></span>
        {data && <span className="admin-footnote">库版本 {data.version} · 摘要 {data.digest.slice(0, 12) || "（空库）"}</span>}
      </div>

      {error ? <div className="card error-text" role="alert">{error}</div>
        : loading ? <div className="empty-state"><span className="spinner" />正在读取题库…</div>
        : !data?.items.length ? <div className="empty-state">题库里还没有符合条件的题目。</div>
        : <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>题目 / 版本</th><th>知识点</th><th>任务 / 情境</th><th>难度</th><th>答案与讲解</th></tr></thead>
              <tbody>
                {data.items.map(item => (
                  <tr key={item.id}>
                    <td>
                      <QuestionFigure image={item.image} version={item.version} />
                      <strong>{item.text}</strong>
                      <small className="admin-table-sub">{item.id} · v{item.version} · {item.familyId}</small>
                    </td>
                    <td>{item.knowledgeId}</td>
                    <td>{item.taskType ? taskTypeNames[item.taskType] ?? item.taskType : "—"}{item.contextId ? <><small className="admin-table-sub">{item.contextId}</small></> : null}</td>
                    <td>{item.difficulty}</td>
                    <td>
                      <strong>{item.answer}{item.unit ? ` ${item.unit}` : ""}</strong>
                      <ol className="admin-step-list">{item.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
                      <p className="admin-footnote">提示：{item.hint}</p>
                      <p className="admin-footnote">另一解法：{item.alternative}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-pager">
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
            <span>第 {data.page} 页 · 共 {data.total} 道 · 每页 {data.pageSize} 道</span>
            <button className="btn btn-secondary" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>下一页</button>
          </div>
        </>}
    </>
  );
}

function Metric({ label, value, detail, icon: Icon, accent }: { label: string; value: number | string; detail: string; icon: typeof Database; accent?: boolean }) {
  return (
    <div className={`admin-metric ${accent ? "admin-metric-accent" : ""}`}>
      <div className="admin-metric-label"><Icon size={15} />{label}</div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
