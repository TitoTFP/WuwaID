import type {
  Chapter,
  Quest,
  QuestListResponse,
  SearchHit,
  Speaker,
} from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return (await r.json()) as T;
}

export const api = {
  chapters: () => get<Chapter[]>(`/chapters`),
  speakers: () => get<Speaker[]>(`/speakers`),
  quests: (params: {
    side?: 0 | 1;
    quest_type?: number;
    spk?: string;
    has_options?: boolean;
    q?: string;
    sort?: "id" | "name" | "lines" | "lines_asc";
    page?: number;
    page_size?: number;
  }) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== null) u.set(k, String(v));
    }
    return get<QuestListResponse>(`/quests?${u.toString()}`);
  },
  quest: (qid: number) => get<Quest>(`/quests/${qid}`),
  search: (params: {
    q: string;
    lang?: "en" | "zh" | "ja";
    side?: 0 | 1;
    quest_type?: number;
    limit?: number;
  }) => {
    const u = new URLSearchParams();
    u.set("q", params.q);
    if (params.lang) u.set("lang", params.lang);
    if (params.side !== undefined) u.set("side", String(params.side));
    if (params.quest_type !== undefined) u.set("quest_type", String(params.quest_type));
    if (params.limit) u.set("limit", String(params.limit));
    return get<SearchHit[]>(`/search?${u.toString()}`);
  },
};
