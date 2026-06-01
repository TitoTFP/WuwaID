// Types matching the dialogue.json schema from export_quest_ordered.py

export type QuestType = number; // 1=main, 2,3,4,7,9,10,11,14,100
export type Lang = "en" | "zh-Hans" | "ja";
export type LineType = "Talk" | "Option" | "CenterText" | "PhoneMessage" | "NoTextItem" | "SystemOption";

export interface DialogueLineOption {
  text_key: string;
  text_zh-Hans: string;
  text_en: string;
  text_ja: string;
}

export interface DialogueLine {
  id: number;
  type: LineType | string;
  state_key: string;
  text_key: string;
  speaker_zh-Hans: string;
  speaker_en: string;
  speaker_ja: string;
  text_zh-Hans: string;
  text_en: string;
  text_ja: string;
  options?: DialogueLineOption[];
}

export interface QuestFlow {
  flow_list_name: string;
  flow_id: number;
  state_id: number;
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
