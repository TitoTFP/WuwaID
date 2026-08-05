// Types matching the dialogue.json schema from export_text_grouped.py

export type QuestType = number; // 1=main, 2,3,4,7,9,10,11,14,100
export type Lang = "en" | "zh-Hans" | "ja" | "id";
export type LineType = "Talk" | "Option" | "CenterText" | "PhoneMessage" | "NoTextItem" | "SystemOption";

// Plot mode is the last SetPlotMode.Mode seen in a flow state.
// Common values: "Normal", "PhoneMessage", "BlackScreen", "Chapter",
// "LevelA".."LevelF" (camera focus levels). String union is open because
// the exporter passes the raw value through.
export type PlotMode = string;

export interface FlowAction {
  name: string;
  params: Record<string, unknown>;
  action_id?: number;
  action_guid?: string;
}

export interface DialogueLineOption {
  text_key: string;
  "text_zh-Hans": string;
  text_en: string;
  text_ja: string;
  // Indonesian (added by viewer integration):
  text_id?: string;
  // Optional cross-reference to the line this option jumps to
  plot_line_id?: number;
  plot_line_key?: string;
  // Branching actions, typically a single JumpTalk to another TalkId
  actions?: FlowAction[];
}

export interface DialogueLine {
  id: number;
  // Per-state id preserved from the source ShowTalk.TalkItems.Id field,
  // which restarts at 1 in every state. The export renumbers `id` to be
  // globally unique within the quest, but the verbose chip display
  // (`#<global> · S<state>.<sub>.<state_item_id>`) still uses this.
  state_item_id?: number;
  type: LineType | string;
  state_key: string;
  text_key: string;
  "speaker_zh-Hans": string;
  speaker_en: string;
  speaker_ja: string;
  "text_zh-Hans": string;
  text_en: string;
  text_ja: string;
  // Indonesian (added by viewer integration):
  text_id?: string;
  speaker_id?: string;
  options?: DialogueLineOption[];
  // For cross-state/cross-line linking (player choice → target line)
  plot_line_id?: number;
  plot_line_key?: string;
}

export interface QuestFlowState {
  state_key: string;
  plot_mode: PlotMode;
  actions: FlowAction[];
}

export interface QuestFlow {
  flow_list_name: string;
  flow_id: number;
  state_id: number;
  states: QuestFlowState[];
  dialogue: DialogueLine[];
}

export interface Quest {
  quest_id: number;
  quest_name: string;
  quest_type: QuestType;
  languages: Lang[];
  total_lines: number;
  flows?: QuestFlow[];
  all_lines: DialogueLine[];
  plot_mode_by_state: Record<string, PlotMode>;
  // main-story only:
  chapter_id?: number;
  chapter_name?: string;
  node_id?: number;
  // injected by build_index:
  side: 0 | 1;
}

export interface Chapter {
  id: number;
  name: string;
  quest_count: number;
  line_count: number;
}

export interface Speaker {
  name: string;
  line_count: number;
  quest_count: number;
}

export interface SearchHit {
  qid: number;
  line_id: number;
  quest_name: string;
  chapter_name: string;
  side: 0 | 1;
  speaker_en: string;
  text: string;
  line_type: string;
  has_options: 0 | 1;
  snippet: string;
}

export interface QuestListItem {
  qid: number;
  quest_name: string;
  quest_type: QuestType;
  side: 0 | 1;
  chapter_id: number;
  chapter_name: string;
  total_lines: number;
  translated_count: number;
}

export interface QuestListResponse {
  total: number;
  page: number;
  page_size: number;
  items: QuestListItem[];
}

// Editor mode types (mirrors app/db.py)

export type DraftStatus = "pending" | "applied" | "rejected" | "withdrawn";

export type DraftPatch = Partial<{
  type: string;
  state_key: string;
  text_key: string;
  speaker_en: string;
  "speaker_zh-Hans": string;
  speaker_ja: string;
  text_en: string;
  "text_zh-Hans": string;
  text_ja: string;
  speaker_id: string;
  text_id: string;
  options: DialogueLineOption[];
  _op: "reorder";
}>;

export interface Draft {
  id: number;
  qid?: number;
  line_id?: number;
  category?: string;
  key?: string;
  position_after?: number | null;
  patch_json: string;
  status: DraftStatus;
  created_at: string;
  updated_at: string;
  author_label: string | null;
  note: string | null;
  patch?: DraftPatch;
  original_json?: (DialogueLine | {
    key: string;
    "zh-Hans": string;
    en: string;
    ja: string;
    text_id: string;
  }) | null;
}

export interface GlossaryMatch {
  term: string;
  indonesian_translation: string;
  category: string;
}

export interface TranslationFinding {
  code: "token-mismatch" | "tag-mismatch" | "missing-translation" | "outer-whitespace" | "same-as-source" | "glossary-mismatch";
  field: string;
  message: string;
}

export interface LineSummary {
  id: number;
  type: string;
  state_key: string;
  speaker_en: string;
  text_en: string;
  is_edited: boolean;
}

export type TreeNodeKind = "flow" | "state" | "line";
export type TreeDropPosition = "before" | "after" | "inside";

export interface DialogueTreeNode {
  id: string;
  kind: TreeNodeKind;
  label: string;
  flowName?: string;
  stateKey?: string;
  stateId?: number;
  subId?: number;
  plotMode?: string;
  line?: DialogueLine & { is_edited?: boolean };
  lineIds: number[];
  children?: DialogueTreeNode[];
  // 1-based position of a state within its parent flow. Only set for
  // kind === "state". Computed at tree-build time; updates as the
  // underlying line order changes (drag/drop, reorder, etc.).
  localIndex?: number;
}

export interface MeResponse {
  role: "anon" | "editor" | "admin";
}

export interface TextVersion {
  id: number;
  tag: string;
  note: string | null;
  created_at: string;
  dataset_hash: string;
  row_count: number;
  category_row_count: number;
  quest_row_count: number;
}

export type TextDiffStatus = "added" | "removed" | "changed";

export interface TextDiffItem {
  status: TextDiffStatus;
  text_id: string;
  old_content: string | null;
  new_content: string | null;
  source_kind: "category" | "quest";
  source_ref: string;
}

export interface TextDiffResponse {
  base: string;
  target: string;
  language: "en" | "zh-Hans" | "ja";
  summary: Record<TextDiffStatus, number>;
  total: number;
  page: number;
  page_size: number;
  items: TextDiffItem[];
}

export interface TextDiffGroup {
  group_id: string;
  source_kind: "category" | "quest";
  source_ref: string;
  db_path: string;
  is_new_group: boolean;
  added: number;
  changed: number;
  total: number;
}

export interface TextDiffGroupsResponse {
  base: string;
  target: string;
  language: "en" | "zh-Hans" | "ja";
  summary: Record<TextDiffStatus, number>;
  exportable_rows: number;
  groups: TextDiffGroup[];
}

export interface CategoryItem {
  key: string;
  "zh-Hans"?: string;
  en?: string;
  ja?: string;
}

export interface CategoryResponse {
  category: string;
  total: number;
  page: number;
  page_size: number;
  items: CategoryItem[];
}

export interface CategorySummary {
  name: string;
  key_count: number;
  translated_count: number;
}

export interface CategorySingleEntry {
  key: string;
  "zh-Hans": string;
  en: string;
  ja: string;
  id: string | null;
}

export interface CategorySingleResponse {
  name: string;
  languages: string[];
  entries: CategorySingleEntry[];
}

export interface CategoryEditorEntry {
  key: string;
  prefix: string;
  "zh-Hans": string;
  en: string;
  ja: string;
  id: string | null;
  is_edited: boolean;
}

export interface AdminActiveSummary {
  active: number;
  window_seconds: number;
  total_30d?: number;
}

export interface AdminActivePlayer {
  client_id: string;
  launcher_version: string;
  install_method: string;
  event: string;
  last_seen: string;
}

export interface AdminLogUpload {
  id: string;
  app_version: string;
  timestamp: string;
  os: string;
  file_count: number;
  total_bytes: number;
  created_at: string;
}

export interface AdminLogHistoryPoint {
  timestamp: string;
  events: Record<string, number>;
  total: number;
}

export interface AdminLogHistoryResponse {
  points: AdminLogHistoryPoint[];
  window: string;
  interval: string;
  event_keys: string[];
}

export interface AdminLogFilesResponse {
  id: string;
  files: Array<{ name: string; size: number }>;
}
