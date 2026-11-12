import type { Attempt, Paper } from "./types.ts";

/** Select real work without relying on the order returned by the workspace API. */
export function homeWork(papers: Paper[], attempts: Attempt[], now: number) {
  const pending = papers.filter(p => p.status !== "completed" && !p.id.startsWith("demo-"));
  const draftFor = (paper: Paper) => attempts.filter(a => a.paperId === paper.id && a.status === "draft" && !a.id.startsWith("demo-"))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  pending.sort((a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress") || (draftFor(b)?.startedAt ?? b.createdAt).localeCompare(draftFor(a)?.startedAt ?? a.createdAt));
  const submitted = attempts.filter(a => a.status === "submitted" && !a.id.startsWith("demo-") && !a.paperId.startsWith("demo-") && papers.some(p => p.id === a.paperId));
  const recent = submitted.filter(a => { const time = Date.parse(a.submittedAt ?? a.startedAt); return Number.isFinite(time) && time <= now && time >= now - 7 * 24 * 60 * 60 * 1000; });
  const latest = submitted.filter(a => { const time = Date.parse(a.submittedAt ?? a.startedAt); return Number.isFinite(time) && time <= now; }).sort((a, b) => (b.submittedAt ?? b.startedAt).localeCompare(a.submittedAt ?? a.startedAt))[0];
  return { pending, pendingAttempt: pending[0] ? draftFor(pending[0]) : undefined, recent, latest };
}
