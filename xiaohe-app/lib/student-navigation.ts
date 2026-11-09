import type { View } from "./ui-types";

/** Keep contextual tools under the task that owns them, including deep links. */
export function studentSection(view: View): View {
  if (["papers", "practice", "camera", "chat"].includes(view)) return "papers";
  if (["profile", "access", "history-delete", "evidence-review", "report"].includes(view)) return "profile";
  return view;
}

export function practiceSection(id?: string): "points" | "sets" | "history" {
  if (id === "history") return "history";
  if (["sets", "configure", "division", "multiplication", "geometry"].includes(id ?? "")) return "sets";
  return "points";
}
