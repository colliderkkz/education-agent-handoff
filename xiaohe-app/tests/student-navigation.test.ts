import { test } from "node:test";
import assert from "node:assert/strict";
import { studentSection, practiceSection } from "../lib/student-navigation.ts";

test("contextual tools retain a reachable parent section", () => {
  for (const view of ["practice", "camera", "chat"] as const) assert.equal(studentSection(view), "papers");
  for (const view of ["access", "history-delete", "evidence-review", "report"] as const) assert.equal(studentSection(view), "profile");
  assert.equal(studentSection("mistakes"), "mistakes");
});

test("legacy deep links open the paper configuration while catalog points open self practice", () => {
  for (const id of ["configure", "division", "multiplication", "geometry"]) assert.equal(practiceSection(id), "sets");
  assert.equal(practiceSection("history"), "history");
  assert.equal(practiceSection("math-1-round"), "points");
  assert.equal(practiceSection(), "points");
});
