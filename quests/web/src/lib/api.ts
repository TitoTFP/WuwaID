import type {
  Chapter,
  Draft,
  DraftPatch,
  LineSummary,
  MeResponse,
  Quest,
  QuestListResponse,
  SearchHit,
  Speaker,
  CategoryResponse,
} from "./types";

const BASE = "/api";

async function get<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
  const r = await fetch(BASE + path, {
    credentials: "include",
    headers: extraHeaders,
  });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return (await r.json()) as T;
}

async function send<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const r = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(extraHeaders ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status} ${path} ${text}`);
  }
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

  editorQuest: (qid: number) => get<Quest>(`/editor/quest/${qid}`),
  editorQuestLines: (qid: number) => get<LineSummary[]>(`/editor/quest/${qid}/lines`),
  createDraft: (params: {
    qid: number;
    line_id: number;
    patch: DraftPatch;
    position_after?: number | null;
    note?: string;
  }, authorLabel: string) =>
    send<{ id: number }>("POST", "/editor/drafts", params, {
      "X-Author-Label": authorLabel,
    }),
  updateDraft: (id: number, patch: DraftPatch, authorLabel: string | null) =>
    send<{ ok: true }>("PUT", `/editor/drafts/${id}`, { patch }, {
      "X-Author-Label": authorLabel ?? "",
    }),
  deleteDraft: (id: number, authorLabel: string | null) =>
    send<{ ok: true }>("DELETE", `/editor/drafts/${id}`, undefined, {
      "X-Author-Label": authorLabel ?? "",
    }),
  listDrafts: (authorLabel?: string | null) =>
    get<Draft[]>(`/drafts`, authorLabel ? { "X-Author-Label": authorLabel } : undefined),
  getDraft: (id: number, authorLabel?: string | null) =>
    get<Draft>(`/drafts/${id}`, authorLabel ? { "X-Author-Label": authorLabel } : undefined),
  approveDraft: (id: number) =>
    send<{ ok: true }>("POST", `/drafts/${id}/approve`),
  rejectDraft: (id: number) =>
    send<{ ok: true }>("POST", `/drafts/${id}/reject`),
  login: (password: string) =>
    send<{ role: "editor" }>("POST", "/login", { password }),
  logout: () => send<{ role: "anon" }>("POST", "/logout"),
  me: () => get<MeResponse>(`/me`),
  categories: () => get<string[]>(`/categories`),
  category: (name: string, params: { q?: string; page?: number; page_size?: number }) => {
    const u = new URLSearchParams();
    if (params.q) u.set("q", params.q);
    if (params.page !== undefined) u.set("page", String(params.page));
    if (params.page_size !== undefined) u.set("page_size", String(params.page_size));
    return get<CategoryResponse>(`/categories/${name}?${u.toString()}`);
  },
};
