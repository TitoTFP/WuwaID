// Types matching the dialogue.json schema from export_quest_ordered.py

export type QuestType = number; // 1=main, 2,3,4,7,9,10,11,14,100
export type Lang = "en" | "zh-Hans" | "ja";
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
  flows: QuestFlow[];
  all_lines: DialogueLine[];
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
}

export interface QuestListResponse {
  total: number;
  page: number;
  page_size: number;
  items: QuestListItem[];
}

// Editor mode types (mirrors app/db.py)

export type DraftStatus = "pending" | "applied" | "rejected" | "withdrawn";

export type EditableField =
  | "type"
  | "state_key"
  | "speaker_en"
  | "speaker_zh-Hans"
  | "speaker_ja"
  | "text_en"
  | "text_zh-Hans"
  | "text_ja"
  | "options";

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
  options: DialogueLineOption[];
  _op: "reorder";
}>;

export interface Draft {
  id: number;
  qid: number;
  line_id: number;
  position_after: number | null;
  patch_json: string;
  status: DraftStatus;
  created_at: string;
  updated_at: string;
  author_label: string | null;
  note: string | null;
  patch?: DraftPatch;
  original_json?: DialogueLine | null;
}

export interface LineSummary {
  id: number;
  type: string;
  state_key: string;
  speaker_en: string;
  text_en: string;
  is_edited: boolean;
}

export interface MeResponse {
  role: "anon" | "editor";
}
