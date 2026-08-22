export type SurfaceMode =
	| "reader"
	| "categories"
	| "workbench"
	| "operations"
	| "databases";

export type UserRole = "reader" | "translator" | "editor" | "admin";

export type LanguageCode = "en" | "id" | "zh-Hans" | "ja";

export interface MultilingualText {
	en: string;
	id?: string;
	"zh-Hans"?: string;
	ja?: string;
}

export interface ChoiceOption {
	id: string;
	text: MultilingualText;
	nextSpeakerId?: string;
}

export interface DialogueLine {
	id: string;
	lineNo: number;
	speaker: {
		id: string;
		name: MultilingualText;
		avatarUrl?: string;
		isPlayer?: boolean;
	};
	text: MultilingualText;
	type?: "dialogue" | "narration" | "scene_separator" | "choice";
	options?: ChoiceOption[];
	audioUrl?: string;
	hasDraft?: boolean;
}

export interface TranslationDraft {
	id: string;
	questId: string;
	questTitle: string;
	lineId: string;
	lineNo: number;
	speakerName: string;
	author: {
		name: string;
		role: string;
		avatarUrl?: string;
	};
	sourceText: string;
	previousText: string;
	proposedText: string;
	status: "pending" | "approved" | "rejected";
	rejectionReason?: string;
	createdAt: string;
}

export interface AppliedVersion {
	versionTag: string;
	versionType?: "translation" | "dataset";
	appliedAt: string;
	author: string;
	commitHash: string;
	sourceFingerprint?: string;
	sourceDatabaseCount?: number;
	sourceDatabaseBytes?: number;
	changedFiles?: number;
	addedFiles?: number;
	removedFiles?: number;
	previousVersionTag?: string;
	manifestPath?: string;
	totalLinesModified: number;
	description: string;
	diffSummary: Array<{
		questTitle: string;
		linesChanged: number;
		filesChanged?: number;
		addedFiles?: number;
		removedFiles?: number;
	}>;
}

export type TextVersionLanguage = "en" | "zh-Hans" | "ja";
export type TextDiffStatus = "added" | "removed" | "changed";

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

export interface TextDiffItem {
	status: TextDiffStatus;
	text_id: string;
	old_content: string | null;
	new_content: string | null;
	source_kind: "category" | "quest";
	source_ref: string;
	source_path: string;
	name: string;
}

export interface TextDiffResponse {
	base: string;
	target: string;
	language: TextVersionLanguage;
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
	language: TextVersionLanguage;
	summary: Record<TextDiffStatus, number>;
	exportable_rows: number;
	groups: TextDiffGroup[];
}

export interface LogEntry {
	id: string;
	level: "info" | "warn" | "error";
	client: "WuwaLauncher" | "WuwaMobile" | "WuwaWeb";
	clientVersion: string;
	deviceId: string;
	timestamp: string;
	category: string;
	message: string;
	details?: Record<string, unknown>;
}

export interface HeartbeatPoint {
	timestamp: string;
	activePlayers: number;
	heartbeatsPerMin: number;
}

export interface QuestDetail {
	id: string;
	chapterId: string;
	chapterTitle: string;
	title: MultilingualText;
	summary?: MultilingualText;
	type: "main" | "side" | "companion" | "event";
	totalLines: number;
	translatedLines?: number;
	translatedTextTotal?: number;
	lines: DialogueLine[];
	updatedAt: string;
}

export interface QuestSummary {
	id: string;
	title: MultilingualText;
	chapterId?: string;
	chapterTitle?: string;
	type: string;
	rawQuestType?: number;
	totalLines: number;
	translatedLines: {
		id: number;
		zh: number;
		ja: number;
	};
	translatedTextTotal?: number;
	updatedAt: string;
}

export interface Chapter {
	id: string;
	number: string;
	title: string;
	region?: string;
	questCount: number;
	totalLines: number;
	progressPercentage: number;
	description?: string;
}

export interface TextCategory {
	id: string;
	name: string;
	description: string;
	totalItems: number;
	translatedItems: number;
	translatedTextTotal?: number;
	progressPercentage?: number;
}

export interface SystemMetrics {
	totalQuests: number;
	totalDialogueLines: number;
	translationCoverageId: number;
	activeTranslators: number;
	activePlayers24h: number;
	serverStatus: "online" | "degraded" | "maintenance";
}
