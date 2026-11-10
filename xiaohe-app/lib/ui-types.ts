import type { ApiResult, ChatOpenContext, StageId, WorkspaceState } from "./types";
export type ChatEntryContext = ChatOpenContext;
export type View = "home" | "knowledge" | "camera" | "papers" | "practice" | "mistakes" | "profile" | "chat" | "report" | "access" | "shared-help" | "evidence-review" | "history-delete" | "exam";
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
  /** 当前学段（小学 / 上海初中 / 上海高中）—— 知识地图、组卷、单题练习、错题本共用一份，不用每处重选。 */
  stageId?: StageId;
  onStageChange?: (id: StageId) => void;
}
