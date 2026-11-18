import type { ApiResult, ChatOpenContext, WorkspaceState } from "./types";
export type ChatEntryContext = ChatOpenContext;
export type View = "home" | "knowledge" | "camera" | "papers" | "practice" | "mistakes" | "profile" | "chat" | "report" | "access" | "shared-help" | "evidence-review" | "history-delete";
export interface AppProps {
  state: WorkspaceState;
  mutate: (action: string, payload?: Record<string, unknown>) => Promise<ApiResult | undefined>;
  navigate: (view: View, id?: string, context?: ChatEntryContext, evidenceRevision?: number) => void;
  selectedId?: string;
  evidenceRevision?: number;
  chatContext?: ChatEntryContext;
  chatEntryError?: string;
  reload?: () => Promise<void>;
  busy: boolean;
  curriculumSubjectId?: string;
  onCurriculumSubjectChange?: (id: string) => void;
}
