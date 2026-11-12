import { test } from "node:test";
import assert from "node:assert/strict";
import { homeWork } from "../lib/home-work.ts";
import type { Attempt, Paper } from "../lib/types.ts";

const paper = (id: string, status: Paper["status"], createdAt: string) => ({ id, status, createdAt } as Paper);
const attempt = (id: string, paperId: string, status: Attempt["status"], date: string) => ({ id, paperId, status, startedAt: date, ...(status === "submitted" ? { submittedAt: date } : {}) } as Attempt);

test("home prioritizes the latest started unfinished work and excludes demo work", () => {
  const papers = [paper("ready", "ready", "2026-11-10"), paper("older", "in_progress", "2026-11-01"), paper("newer", "in_progress", "2026-11-02"), paper("demo-paper", "in_progress", "2026-11-10")];
  const attempts = [attempt("a", "older", "draft", "2026-11-03"), attempt("b", "newer", "draft", "2026-11-08")];
  const result = homeWork(papers, attempts, Date.parse("2026-11-10"));
  assert.deepEqual(result.pending.map(p => p.id), ["newer", "older", "ready"]);
  assert.equal(result.pendingAttempt?.id, "b");
});

test("home recent work excludes demo, orphan and future records and handles an empty history", () => {
  const papers = [paper("p", "completed", "2026-11-01"), paper("demo-p", "completed", "2026-11-01")];
  const attempts = [attempt("old", "p", "submitted", "2026-11-01"), attempt("recent", "p", "submitted", "2026-11-09"), attempt("demo-a", "p", "submitted", "2026-11-09"), attempt("orphan", "missing", "submitted", "2026-11-09"), attempt("future", "p", "submitted", "2026-11-11")];
  const result = homeWork(papers, attempts, Date.parse("2026-11-10"));
  assert.deepEqual(result.recent.map(a => a.id), ["recent"]);
  assert.equal(result.latest?.id, "recent");
  assert.equal(homeWork([], [], Date.now()).latest, undefined);
});
