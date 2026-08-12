import type {
	Chapter,
	QuestDetail,
	QuestSummary,
	TextCategory,
	TranslationDraft,
	AppliedVersion,
	LogEntry,
	HeartbeatPoint,
	SystemMetrics,
} from "../types";

const API_BASE = "/api";

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
	const token = localStorage.getItem("wuwaid_token");
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(options?.headers as Record<string, string>),
	};

	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	const res = await fetch(`${API_BASE}${endpoint}`, {
		...options,
		headers,
	});

	if (!res.ok) {
		const errorData = await res
			.json()
			.catch(() => ({ error: "Request failed" }));
		throw new Error(errorData.error || `HTTP ${res.status}`);
	}

	return res.json();
}

// Health & System Metrics
export async function fetchHealth() {
	return request<{ status: string; service: string }>("/health");
}

export async function fetchMetrics(): Promise<SystemMetrics> {
	return request<SystemMetrics>("/reader/metrics");
}

// ==========================================
// 1. READER TAB ENDPOINTS (/api/reader/*)
// ==========================================

export async function fetchChapters(): Promise<{ chapters: Chapter[] }> {
	return request<{ chapters: Chapter[] }>("/reader/chapters");
}

export async function fetchQuests(
	params?:
		| string
		| { chapterId?: string; q?: string; type?: string; sort?: string },
): Promise<{ quests: QuestSummary[] }> {
	const searchParams = new URLSearchParams();

	if (typeof params === "string") {
		if (params) searchParams.append("chapterId", params);
	} else if (params) {
		if (params.chapterId) searchParams.append("chapterId", params.chapterId);
		if (params.q) searchParams.append("q", params.q);
		if (params.type) searchParams.append("type", params.type);
		if (params.sort) searchParams.append("sort", params.sort);
	}

	const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
	return request<{ quests: QuestSummary[] }>(`/reader/quests${query}`);
}

export async function fetchQuestDetail(id: string): Promise<QuestDetail> {
	return request<QuestDetail>(`/reader/quests/${encodeURIComponent(id)}`);
}

export async function fetchCategories(): Promise<{
	categories: TextCategory[];
}> {
	return request<{ categories: TextCategory[] }>("/reader/categories");
}

export interface CategoryDetailResponse {
	name: string;
	totalItems: number;
	filteredItems: number;
	translatedItems?: number;
	translatedTextTotal?: number;
	progressPercentage?: number;
	page: number;
	limit: number;
	totalPages: number;
	items: Array<{
		key: string;
		text: {
			en: string;
			id: string;
			"zh-Hans": string;
			ja: string;
		};
	}>;
}

export async function fetchCategoryDetail(
	categoryName: string,
	params?: { q?: string; page?: number; limit?: number },
): Promise<CategoryDetailResponse> {
	const searchParams = new URLSearchParams();
	if (params?.q) searchParams.append("q", params.q);
	if (params?.page) searchParams.append("page", String(params.page));
	if (params?.limit) searchParams.append("limit", String(params.limit));

	const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
	return request<CategoryDetailResponse>(
		`/reader/categories/${categoryName.split("/").map(encodeURIComponent).join("/")}${query}`,
	);
}

export interface GlobalSearchResult {
	kind: "dialogue" | "quest" | "category";
	id: string;
	questId?: string;
	questTitle?: string;
	chapterTitle?: string;
	lineId?: string;
	lineNo?: number;
	speakerName?: string;
	text?: string;
	englishText?: string;
	translated?: boolean;
	lang?: string;
	title?: string;
	categoryName?: string;
	key?: string;
	totalLines?: number;
	translatedLines?: number;
	translatedTextTotal?: number;
	totalItems?: number;
	translatedItems?: number;
}

export async function searchGlobal(params: {
	q?: string;
	lang?: "en" | "id" | "zh" | "ja";
	scope?: "all" | "dialogue" | "quest" | "category";
	speaker?: string;
	untranslated?: boolean;
	limit?: number;
}) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") query.set(key, String(value));
	}
	return request<{
		query: string;
		scope: string;
		lang: string;
		total: number;
		results: GlobalSearchResult[];
	}>(`/reader/search?${query.toString()}`);
}

export async function searchQuests(
	q: string,
	lang: "en" | "id" | "zh" | "ja" = "id",
) {
	return searchGlobal({ q, lang, scope: "dialogue" });
}

// ==========================================
// 2. WORKBENCH TAB ENDPOINTS (/api/workbench/*)
// ==========================================

export async function fetchDrafts(
	status?: string,
): Promise<{ drafts: TranslationDraft[] }> {
	const query = status ? `?status=${encodeURIComponent(status)}` : "";
	return request<{ drafts: TranslationDraft[] }>(`/workbench/drafts${query}`);
}

export async function fetchDraftDetail(id: string): Promise<TranslationDraft> {
	return request<TranslationDraft>(
		`/workbench/drafts/${encodeURIComponent(id)}`,
	);
}

export async function approveDraft(
	id: string,
): Promise<{ status: string; draft: TranslationDraft }> {
	return request<{ status: string; draft: TranslationDraft }>(
		`/workbench/drafts/${encodeURIComponent(id)}/approve`,
		{
			method: "POST",
		},
	);
}

export async function rejectDraft(
	id: string,
	reason?: string,
): Promise<{ status: string; draft: TranslationDraft }> {
	return request<{ status: string; draft: TranslationDraft }>(
		`/workbench/drafts/${encodeURIComponent(id)}/reject`,
		{
			method: "POST",
			body: JSON.stringify({ reason }),
		},
	);
}

export async function batchApproveDrafts(): Promise<{
	status: string;
	approvedCount: number;
}> {
	return request<{ status: string; approvedCount: number }>(
		"/workbench/drafts/batch-approve",
		{
			method: "POST",
		},
	);
}

export async function applyApprovedDrafts(): Promise<{
	status: string;
	appliedCount: number;
	versionTag: string;
}> {
	return request<{ status: string; appliedCount: number; versionTag: string }>(
		"/workbench/drafts/apply",
		{
			method: "POST",
		},
	);
}

export async function submitDraft(payload: {
	questId: string;
	lineId?: string;
	lineNo?: number;
	speakerName?: string;
	sourceText?: string;
	previousText?: string;
	proposedText: string;
}): Promise<{ status: string; draft: TranslationDraft }> {
	return request<{ status: string; draft: TranslationDraft }>(
		"/workbench/drafts",
		{
			method: "POST",
			body: JSON.stringify(payload),
		},
	);
}

export async function fetchGlossaryMatches(
	text: string,
): Promise<{ matches: Array<{ term: string; translation: string }> }> {
	return request<{ matches: Array<{ term: string; translation: string }> }>(
		"/workbench/glossary/matches",
		{
			method: "POST",
			body: JSON.stringify({ text }),
		},
	);
}

export async function fetchVersions(): Promise<{ versions: AppliedVersion[] }> {
	return request<{ versions: AppliedVersion[] }>("/workbench/versions");
}

export async function fetchVersionDiff(versionTag?: string) {
	const query = versionTag ? `?version=${encodeURIComponent(versionTag)}` : "";
	return request<any>(`/workbench/versions/diff${query}`);
}

// ==========================================
// 3. OPERATIONS TAB ENDPOINTS (/api/ops/*)
// ==========================================

export async function fetchOpsActive() {
	return request<{
		status: string;
		activePlayers: number;
		heartbeatsPerMin: number;
		errorCount24h: number;
		warnCount24h: number;
	}>("/ops/active");
}

export async function fetchHeartbeats(): Promise<{
	heartbeats: HeartbeatPoint[];
}> {
	return request<{ heartbeats: HeartbeatPoint[] }>("/ops/players");
}

export async function fetchOpsLogs(
	level?: string,
	client?: string,
): Promise<{ logs: LogEntry[] }> {
	const params = new URLSearchParams();
	if (level) params.append("level", level);
	if (client) params.append("client", client);

	const query = params.toString() ? `?${params.toString()}` : "";
	return request<{ logs: LogEntry[] }>(`/ops/history${query}`);
}

export async function fetchLogUploads() {
	return request<{ uploads: any[] }>("/ops/uploads");
}

export async function fetchUploadFiles(id: string) {
	return request<{
		files: Array<{ name: string; size: number; content?: string }>;
	}>(`/ops/uploads/${encodeURIComponent(id)}/files`);
}

export function getDownloadUploadZipUrl(id: string): string {
	return `${API_BASE}/ops/uploads/${encodeURIComponent(id)}/download`;
}

export async function fetchConfigDbs(): Promise<{ exportFiles: string[] }> {
	return request<{ exportFiles: string[] }>("/ops/databases");
}

export async function importConfigDb(file: File) {
	const token = localStorage.getItem("wuwaid_token");
	const query = new URLSearchParams({ filename: file.name });

	const headers: Record<string, string> = {
		"Content-Type": "application/octet-stream",
	};
	if (token) headers.Authorization = `Bearer ${token}`;

	const res = await fetch(
		`${API_BASE}/ops/databases/import?${query.toString()}`,
		{
			method: "POST",
			headers,
			body: file,
		},
	);

	if (!res.ok) {
		const errorData = await res
			.json()
			.catch(() => ({ error: "Import failed" }));
		throw new Error(errorData.error || `HTTP ${res.status}`);
	}

	return res.json() as Promise<{
		status: string;
		file: { name: string; sizeBytes: number };
		updatedQuestFiles: number;
		updatedQuestLines: number;
		updatedCategoryFiles: number;
		updatedCategoryItems: number;
	}>;
}

export function resetIdTranslations() {
	return request<{
		status: string;
		updatedQuestFiles: number;
		updatedQuestLines: number;
		updatedCategoryFiles: number;
		updatedCategoryItems: number;
	}>("/ops/databases/reset-id", { method: "POST" });
}

export function getDownloadExportDbUrl(name: string): string {
	return `${API_BASE}/ops/databases/export/${encodeURIComponent(name)}`;
}

export type ExportMode = "id" | "untranslated" | "en";

function exportModeQuery(mode: ExportMode): string {
	return mode === "id" ? "" : `?mode=${encodeURIComponent(mode)}`;
}

export function getDownloadQuestDbUrl(
	id: string,
	mode: ExportMode = "id",
): string {
	return `${API_BASE}/ops/databases/export/quest/${encodeURIComponent(id)}${exportModeQuery(mode)}`;
}

export function getDownloadCategoryDbUrl(
	name: string,
	mode: ExportMode = "id",
): string {
	const encodedName = name.split("/").map(encodeURIComponent).join("/");
	return `${API_BASE}/ops/databases/export/category/${encodedName}${exportModeQuery(mode)}`;
}

async function downloadDb(url: string, name: string): Promise<void> {
	const token = localStorage.getItem("wuwaid_token");
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;

	const res = await fetch(url, { headers });
	if (!res.ok) {
		const errorData = await res
			.json()
			.catch(() => ({ error: "Export failed" }));
		throw new Error(errorData.error || `HTTP ${res.status}`);
	}

	const objectUrl = URL.createObjectURL(await res.blob());
	const link = document.createElement("a");
	link.href = objectUrl;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function downloadExportDb(name: string): Promise<void> {
	return downloadDb(getDownloadExportDbUrl(name), name);
}

export function downloadQuestDb(
	id: string,
	mode: ExportMode = "id",
): Promise<void> {
	const suffix = mode === "id" ? "" : `_${mode}`;
	return downloadDb(getDownloadQuestDbUrl(id, mode), `quest_${id}${suffix}.db`);
}

export function downloadCategoryDb(
	name: string,
	mode: ExportMode = "id",
): Promise<void> {
	const suffix = mode === "id" ? "" : `_${mode}`;
	return downloadDb(
		getDownloadCategoryDbUrl(name, mode),
		`category_${name}${suffix}.db`,
	);
}

// ==========================================
// 4. AUTH & SESSION ENDPOINTS (/api/auth/*)
// ==========================================

export async function loginUser(password?: string) {
	const data = await request<{
		status: string;
		token: string;
		role: "editor" | "admin";
		username: string;
	}>("/auth/login", {
		method: "POST",
		body: JSON.stringify({ password }),
	});
	if (data.token) {
		localStorage.setItem("wuwaid_token", data.token);
		localStorage.setItem("wuwaid_role", data.role);
	}
	return data;
}

export async function loginAdmin(password?: string) {
	const data = await request<{
		status: string;
		token: string;
		role: "admin";
		username: string;
	}>("/auth/admin/login", {
		method: "POST",
		body: JSON.stringify({ password }),
	});
	if (data.token) {
		localStorage.setItem("wuwaid_token", data.token);
		localStorage.setItem("wuwaid_role", "admin");
	}
	return data;
}

export async function logoutUser() {
	try {
		await request<{ status: string }>("/auth/logout", { method: "POST" });
	} finally {
		localStorage.removeItem("wuwaid_token");
		localStorage.removeItem("wuwaid_role");
	}
}

export async function fetchMe() {
	return request<{ authenticated: boolean; role: string; username: string }>(
		"/auth/me",
	);
}
