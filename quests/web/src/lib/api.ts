import type {
  Chapter,
  Draft,
  DraftPatch,
  GlossaryMatch,
  LineSummary,
  MeResponse,
  Quest,
  QuestListResponse,
  Speaker,
  CategoryResponse,
  CategorySummary,
  CategorySingleResponse,
  CategoryEditorEntry,
  TextDiffResponse,
  TextDiffGroupsResponse,
  TextDiffStatus,
  TextVersion,
  AdminActivePlayer,
  AdminActiveSummary,
  AdminLogFilesResponse,
  AdminLogHistoryResponse,
  AdminLogUpload,
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

async function downloadPost(path: string, body: unknown): Promise<{ blob: Blob; filename: string }> {
  const r = await fetch(BASE + path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${path} ${await r.text()}`);
  const disposition = r.headers.get("Content-Disposition") ?? "";
  const encoded = disposition.match(/filename\*=utf-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  return {
    blob: await r.blob(),
    filename: encoded ? decodeURIComponent(encoded) : plain || "structured-diff.zip",
  };
}

async function getText(path: string): Promise<string> {
  const r = await fetch(BASE + path, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.text();
}

async function downloadGet(path: string): Promise<{ blob: Blob; disposition: string | null }> {
  const r = await fetch(BASE + path, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${path} ${await r.text()}`);
  return { blob: await r.blob(), disposition: r.headers.get("Content-Disposition") };
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
    sort?: "id" | "name" | "lines" | "lines_asc" | "translated" | "translated_asc";
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
    lang?: "en" | "zh" | "ja" | "id";
    side?: 0 | 1;
    quest_type?: number;
    scope?: "quest" | "category";
    limit?: number;
  }) => {
    const u = new URLSearchParams();
    u.set("q", params.q);
    if (params.lang) u.set("lang", params.lang);
    if (params.side !== undefined) u.set("side", String(params.side));
    if (params.quest_type !== undefined) u.set("quest_type", String(params.quest_type));
    if (params.scope) u.set("scope", params.scope);
    if (params.limit) u.set("limit", String(params.limit));
    return get<any>(`/search?${u.toString()}`);
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
  updateDraft: (id: number, patch: DraftPatch, note: string | null, authorLabel: string | null) =>
    send<{ ok: true }>("PUT", `/editor/drafts/${id}`, { patch, note }, {
      "X-Author-Label": authorLabel ?? "",
    }),
  glossaryMatches: (texts: string[]) =>
    send<GlossaryMatch[]>("POST", "/editor/glossary/matches", { texts }),
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
  adminLogin: (password: string) =>
    send<{ role: "admin" }>("POST", "/admin/login", { password }),
  logout: () => send<{ role: "anon" }>("POST", "/logout"),
  me: () => get<MeResponse>(`/me`),
  adminLogsActive: () => get<AdminActiveSummary>("/admin/logs/active"),
  adminLogPlayers: () => get<AdminActivePlayer[]>("/admin/logs/players"),
  adminLogHistory: (range: "1h" | "24h" | "7d" | "30d") =>
    get<AdminLogHistoryResponse>(`/admin/logs/history?range=${range}`),
  adminLogUploads: () => get<AdminLogUpload[]>("/admin/logs/uploads"),
  adminLogFiles: (uploadId: string) =>
    get<AdminLogFilesResponse>(`/admin/logs/uploads/${encodeURIComponent(uploadId)}/files`),
  adminLogFile: (uploadId: string, filename: string) =>
    getText(`/admin/logs/uploads/${encodeURIComponent(uploadId)}/files/${filename.split("/").map(encodeURIComponent).join("/")}`),
  downloadAdminLog: (uploadId: string) =>
    downloadGet(`/admin/logs/uploads/${encodeURIComponent(uploadId)}/download`),
  exportTranslations: (payload?: {
    quest_ids?: number[];
    category_names?: string[];
    export_mode?: "full" | "untranslated" | "english_full";
    only_untranslated?: boolean;
    prefix_filters?: string[];
    type_filters?: string[];
    search_filter?: string;
  }) =>
    send<{ ok: boolean; files?: string[] }>("POST", "/editor/export", payload),
  importTranslations: (db_path: string) =>
    send<{ ok: boolean; stats: any }>("POST", "/editor/import", { db_path }),
  categories: () => get<CategorySummary[]>(`/categories`),
  category: (name: string, params: { q?: string; page?: number; page_size?: number }) => {
    const u = new URLSearchParams();
    if (params.q) u.set("q", params.q);
    if (params.page !== undefined) u.set("page", String(params.page));
    if (params.page_size !== undefined) u.set("page_size", String(params.page_size));
    return get<CategoryResponse>(`/categories/${name}?${u.toString()}`);
  },
  categorySingle: (name: string) => get<CategorySingleResponse>(`/category/${name}`),
  editorCategoryEntries: (categoryName: string) =>
    get<CategoryEditorEntry[]>(`/editor/category/${categoryName}/entries`),
  createCategoryDraft: (
    params: { category: string; key: string; patch: { text_id: string }; note?: string },
    authorLabel: string | null,
  ) =>
    send<{ id: number }>("POST", "/editor/category/drafts", params, {
      "X-Author-Label": authorLabel ?? "",
    }),
  clearTranslations: () =>
    send<{ ok: boolean }>("POST", "/editor/clear-translations"),
  deleteQuestTranslation: (qid: number) =>
    send<{ ok: boolean }>("DELETE", `/editor/quest/${qid}/translation`),
  deleteCategoryTranslation: (categoryName: string) =>
    send<{ ok: boolean }>("DELETE", `/editor/category/${categoryName}/translation`),
  textVersions: () => get<TextVersion[]>(`/editor/versions`),
  createTextVersion: (tag: string, note?: string) =>
    send<TextVersion>("POST", `/editor/versions`, { tag, note: note || null }),
  textVersionDiff: (params: {
    base: string;
    target: string;
    lang: "en" | "zh-Hans" | "ja";
    status?: TextDiffStatus;
    q?: string;
    page?: number;
    page_size?: number;
  }) => {
    const u = new URLSearchParams();
    u.set("base", params.base);
    u.set("target", params.target);
    u.set("lang", params.lang);
    if (params.status) u.set("status", params.status);
    if (params.q) u.set("q", params.q);
    if (params.page) u.set("page", String(params.page));
    if (params.page_size) u.set("page_size", String(params.page_size));
    return get<TextDiffResponse>(`/editor/versions/diff?${u.toString()}`);
  },
  textVersionExportUrl: (params: {
    base: string;
    target: string;
    lang: "en" | "zh-Hans" | "ja";
    format: "sqlite" | "csv";
  }) => {
    const u = new URLSearchParams(params);
    return `${BASE}/editor/versions/diff/export?${u.toString()}`;
  },
  textVersionGroups: (params: {
    base: string;
    target: string;
    lang: "en" | "zh-Hans" | "ja";
  }) => {
    const u = new URLSearchParams(params);
    return get<TextDiffGroupsResponse>(`/editor/versions/diff/groups?${u.toString()}`);
  },
  downloadStructuredTextDiff: (params: {
    base: string;
    target: string;
    lang: "en" | "zh-Hans" | "ja";
    groups: string[];
  }) => downloadPost(`/editor/versions/diff/export-structured`, params),
};
