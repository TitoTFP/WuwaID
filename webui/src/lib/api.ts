import type {
	Chapter,
	QuestDetail,
	QuestDetailPage,
	QuestSummary,
	TextCategory,
	TranslationDraft,
	TextDiffGroupsResponse,
	TextDiffResponse,
	TextDiffStatus,
	TextVersion,
	TextVersionLanguage,
	LogEntry,
	HeartbeatPoint,
	SystemMetrics,
	TranslationQAItem,
	TranslationQAListResponse,
	TranslationQASourceKind,
	TranslationQAScanJob,
	TranslationQASummary,
	TranslationQAStatus,
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
		const errorData = await res.json().catch(() => ({ error: "Request failed" }));
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
// TRANSLATION QA ENDPOINTS (/api/qa/*)
// ==========================================

export async function fetchTranslationQASummary(): Promise<TranslationQASummary> {
	return request<TranslationQASummary>("/qa/summary");
}

export async function startTranslationQAScan(): Promise<TranslationQAScanJob> {
	return request<TranslationQAScanJob>("/qa/scan", { method: "POST" });
}

export async function fetchTranslationQAScan(
	id: string,
): Promise<TranslationQAScanJob> {
	return request<TranslationQAScanJob>(`/qa/scan/${encodeURIComponent(id)}`);
}

export async function scanTranslationQA(): Promise<TranslationQASummary> {
	let job = await startTranslationQAScan();
	for (let attempt = 0; attempt < 360; attempt++) {
		if (job.status === "completed" && job.summary) return job.summary;
		if (job.status === "failed")
			throw new Error(job.error || "Translation QA scan gagal.");
		await new Promise((resolve) => window.setTimeout(resolve, 2000));
		job = await fetchTranslationQAScan(job.id);
	}
	throw new Error("Translation QA scan melebihi batas waktu 12 menit.");
}

export async function fetchTranslationQAItems(params: {
	status?: TranslationQAStatus | "all";
	kind?: TranslationQASourceKind | "all";
	q?: string;
	issue?: string;
	sample?: boolean;
	page?: number;
	pageSize?: number;
}): Promise<TranslationQAListResponse> {
	const query = new URLSearchParams();
	if (params.status) query.set("status", params.status);
	if (params.kind) query.set("kind", params.kind);
	if (params.q) query.set("q", params.q);
	if (params.issue) query.set("issue", params.issue);
	if (params.sample) query.set("sample", "true");
	if (params.page) query.set("page", String(params.page));
	if (params.pageSize) query.set("page_size", String(params.pageSize));
	return request<TranslationQAListResponse>(`/qa/items?${query.toString()}`);
}

export async function fetchTranslationQAItem(
	id: string,
): Promise<TranslationQAItem> {
	return request<TranslationQAItem>(`/qa/items/${encodeURIComponent(id)}`);
}

export async function updateTranslationQAReview(
	id: string,
	payload: { status: "review" | "approved" | "reset"; comment?: string },
): Promise<{ item: TranslationQAItem }> {
	return request<{ item: TranslationQAItem }>(
		`/qa/items/${encodeURIComponent(id)}`,
		{
			method: "PATCH",
			body: JSON.stringify(payload),
		},
	);
}

export async function downloadTranslationQAReport(params: {
	format: "json" | "csv";
	status?: TranslationQAStatus | "all";
	kind?: TranslationQASourceKind | "all";
	q?: string;
	issue?: string;
}): Promise<{ blob: Blob; filename: string }> {
	const query = new URLSearchParams({ format: params.format });
	if (params.status) query.set("status", params.status);
	if (params.kind) query.set("kind", params.kind);
	if (params.q) query.set("q", params.q);
	if (params.issue) query.set("issue", params.issue);
	const token = localStorage.getItem("wuwaid_token");
	const response = await fetch(`${API_BASE}/qa/export?${query.toString()}`, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});
	if (!response.ok) {
		const errorData = await response
			.json()
			.catch(() => ({ error: "QA export failed" }));
		throw new Error(errorData.error || `HTTP ${response.status}`);
	}
	const disposition = response.headers.get("Content-Disposition") || "";
	const filename =
		disposition.match(/filename="([^"]+)"/)?.[1] ||
		`wuwaid-translation-qa.${params.format}`;
	return { blob: await response.blob(), filename };
}

// ==========================================
// 1. READER TAB ENDPOINTS (/api/reader/*)
// ==========================================

export async function fetchChapters(): Promise<{ chapters: Chapter[] }> {
	return request<{ chapters: Chapter[] }>("/reader/chapters");
}

export interface ReaderOverviewResponse {
	chapters: Chapter[];
	categories: TextCategory[];
	metrics: SystemMetrics;
}

export async function fetchReaderOverview(): Promise<ReaderOverviewResponse> {
	return request<ReaderOverviewResponse>("/reader/overview");
}

export interface QuestListResponse {
	quests: QuestSummary[];
	page?: number;
	pageSize?: number;
	filteredQuests?: number;
	totalPages?: number;
	hasNextPage?: boolean;
	hasPreviousPage?: boolean;
}

export async function fetchQuests(
	params?:
		| string
		| {
				chapterId?: string;
				q?: string;
				type?: string;
				sort?: string;
				limit?: number;
				page?: number;
				pageSize?: number;
		  },
): Promise<QuestListResponse> {
	const searchParams = new URLSearchParams();

	if (typeof params === "string") {
		if (params) searchParams.append("chapterId", params);
	} else if (params) {
		if (params.chapterId) searchParams.append("chapterId", params.chapterId);
		if (params.q) searchParams.append("q", params.q);
		if (params.type) searchParams.append("type", params.type);
		if (params.sort) searchParams.append("sort", params.sort);
		if (params.limit) searchParams.append("limit", String(params.limit));
		if (params.page !== undefined)
			searchParams.append("page", String(params.page));
		if (params.pageSize !== undefined)
			searchParams.append("pageSize", String(params.pageSize));
	}

	const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
	return request<QuestListResponse>(`/reader/quests${query}`);
}

export async function fetchQuestDetail(id: string): Promise<QuestDetail> {
	return request<QuestDetail>(`/reader/quests/${encodeURIComponent(id)}`);
}

export async function fetchQuestDetailPage(
	id: string,
	params: {
		page?: number;
		pageSize?: number;
		q?: string;
		speaker?: string;
	} = {},
): Promise<QuestDetailPage> {
	const query = new URLSearchParams();
	if (params.page !== undefined) query.set("page", String(params.page));
	if (params.pageSize !== undefined)
		query.set("pageSize", String(params.pageSize));
	if (params.q) query.set("q", params.q);
	if (params.speaker && params.speaker !== "all")
		query.set("speaker", params.speaker);
	const suffix = query.toString() ? `?${query.toString()}` : "";
	return request<QuestDetailPage>(
		`/reader/quests/${encodeURIComponent(id)}${suffix}`,
	);
}

export async function fetchCategories(params?: {
	q?: string;
	limit?: number;
}): Promise<{ categories: TextCategory[] }> {
	const query = new URLSearchParams();
	if (params?.q) query.set("q", params.q);
	if (params?.limit) query.set("limit", String(params.limit));
	const suffix = query.toString() ? `?${query.toString()}` : "";
	return request<{ categories: TextCategory[] }>(`/reader/categories${suffix}`);
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

export async function fetchVersions(): Promise<{ versions: TextVersion[] }> {
	return request<{ versions: TextVersion[] }>("/workbench/versions");
}

export async function fetchVersionDiff(versionTag?: string) {
	const query = versionTag ? `?version=${encodeURIComponent(versionTag)}` : "";
	return request<any>(`/workbench/versions/diff${query}`);
}

export async function createTextVersion(
	tag: string,
	note?: string,
): Promise<{ version: TextVersion }> {
	return request<{ version: TextVersion }>("/workbench/versions", {
		method: "POST",
		body: JSON.stringify({ tag, note: note || null }),
	});
}

export async function fetchTextVersionDiff(params: {
	base: string;
	target: string;
	language: TextVersionLanguage;
	status?: TextDiffStatus;
	query?: string;
	page?: number;
	pageSize?: number;
}): Promise<TextDiffResponse> {
	const query = new URLSearchParams({
		base: params.base,
		target: params.target,
		lang: params.language,
	});
	if (params.status) query.set("status", params.status);
	if (params.query) query.set("q", params.query);
	if (params.page) query.set("page", String(params.page));
	if (params.pageSize) query.set("page_size", String(params.pageSize));
	return request<TextDiffResponse>(
		`/workbench/versions/diff?${query.toString()}`,
	);
}

export async function fetchTextVersionGroups(params: {
	base: string;
	target: string;
	language: TextVersionLanguage;
}): Promise<TextDiffGroupsResponse> {
	const query = new URLSearchParams({
		base: params.base,
		target: params.target,
		lang: params.language,
	});
	return request<TextDiffGroupsResponse>(
		`/workbench/versions/diff/groups?${query.toString()}`,
	);
}

async function downloadTextVersionFile(
	endpoint: string,
): Promise<{ blob: Blob; filename: string }> {
	const token = localStorage.getItem("wuwaid_token");
	const headers: Record<string, string> = token
		? { Authorization: `Bearer ${token}` }
		: {};
	const response = await fetch(`${API_BASE}${endpoint}`, { headers });
	if (!response.ok) {
		const errorData = await response
			.json()
			.catch(() => ({ error: "Download failed" }));
		throw new Error(errorData.error || `HTTP ${response.status}`);
	}
	const disposition = response.headers.get("Content-Disposition") || "";
	const filename =
		disposition.match(/filename="([^"]+)"/)?.[1] || "wuwaid-text-diff";
	return { blob: await response.blob(), filename };
}

export function textVersionExportUrl(params: {
	base: string;
	target: string;
	language: TextVersionLanguage;
	format: "sqlite" | "csv";
}): string {
	const query = new URLSearchParams({
		base: params.base,
		target: params.target,
		lang: params.language,
		format: params.format,
	});
	return `${API_BASE}/workbench/versions/diff/export?${query.toString()}`;
}

export async function downloadStructuredTextDiff(params: {
	base: string;
	target: string;
	language: TextVersionLanguage;
	groups: string[];
}): Promise<{ blob: Blob; filename: string }> {
	const token = localStorage.getItem("wuwaid_token");
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
	const response = await fetch(
		`${API_BASE}/workbench/versions/diff/export-structured`,
		{
			method: "POST",
			headers,
			body: JSON.stringify(params),
		},
	);
	if (!response.ok) {
		const errorData = await response
			.json()
			.catch(() => ({ error: "Download failed" }));
		throw new Error(errorData.error || `HTTP ${response.status}`);
	}
	const disposition = response.headers.get("Content-Disposition") || "";
	const filename =
		disposition.match(/filename="([^"]+)"/)?.[1] || "wuwaid-structured-diff.zip";
	return { blob: await response.blob(), filename };
}

export async function downloadTextVersionDiff(params: {
	base: string;
	target: string;
	language: TextVersionLanguage;
	format: "sqlite" | "csv";
}): Promise<{ blob: Blob; filename: string }> {
	const query = new URLSearchParams({
		base: params.base,
		target: params.target,
		lang: params.language,
		format: params.format,
	});
	return downloadTextVersionFile(
		`/workbench/versions/diff/export?${query.toString()}`,
	);
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

export type DatabaseJobStatus =
	| "staging"
	| "queued"
	| "running"
	| "completed"
	| "failed";

export interface DatabaseJobProgress {
	stage: string;
	current: number;
	total: number;
	detail?: string;
}

export interface DatabaseJobResult {
	status: "imported" | "reset";
	fileCount?: number;
	updatedQuestFiles: number;
	updatedQuestLines: number;
	updatedCategoryFiles: number;
	updatedCategoryItems: number;
	indexedCategoryRows: number;
	indexedDialogueRows: number;
	indexedStatsRows: number;
}

export interface DatabaseJob {
	id: string;
	kind: "import" | "reset";
	status: DatabaseJobStatus;
	createdAt: string;
	updatedAt: string;
	expectedFiles: number;
	receivedFiles: number;
	progress: DatabaseJobProgress;
	result?: DatabaseJobResult;
	error?: string;
}

export async function startConfigDbImportBatch(expectedFiles: number) {
	return request<DatabaseJob>("/ops/databases/import-batch", {
		method: "POST",
		body: JSON.stringify({ expectedFiles }),
	});
}

export async function uploadConfigDbImportFile(
	batchId: string,
	file: File,
	index: number,
): Promise<DatabaseJob> {
	const token = localStorage.getItem("wuwaid_token");
	const query = new URLSearchParams({
		filename: file.name,
		index: String(index),
	});
	const headers: Record<string, string> = {
		"Content-Type": "application/octet-stream",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(
		`${API_BASE}/ops/databases/import-batch/${encodeURIComponent(batchId)}/file?${query.toString()}`,
		{ method: "POST", headers, body: file },
	);
	if (!res.ok) {
		const errorData = await res.json().catch(() => ({ error: "Import failed" }));
		throw new Error(errorData.error || `HTTP ${res.status}`);
	}
	return res.json() as Promise<DatabaseJob>;
}

export async function finishConfigDbImportBatch(batchId: string) {
	return request<DatabaseJob>(
		`/ops/databases/import-batch/${encodeURIComponent(batchId)}/finish`,
		{ method: "POST" },
	);
}

/** Legacy single-file API; new UI uses the batch endpoints above. */
export async function importConfigDb(file: File): Promise<DatabaseJob> {
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
		const errorData = await res.json().catch(() => ({ error: "Import failed" }));
		throw new Error(errorData.error || `HTTP ${res.status}`);
	}
	return res.json() as Promise<DatabaseJob>;
}

export function fetchDatabaseJob(id: string) {
	return request<DatabaseJob>(`/ops/jobs/${encodeURIComponent(id)}`);
}

export function resetIdTranslations() {
	return request<DatabaseJob>("/ops/databases/reset-id", { method: "POST" });
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
		const errorData = await res.json().catch(() => ({ error: "Export failed" }));
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
