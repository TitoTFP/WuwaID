export type SurfaceMode =
	| "reader"
	| "categories"
	| "workbench"
	| "qa"
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

export type QuestDetailPage = Omit<QuestDetail, "lines"> & {
	lines: DialogueLine[];
	page: number;
	pageSize: number;
	filteredLines: number;
	totalPages: number;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
};

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

export type TranslationQAStatus = "pass" | "review" | "approved";
export type TranslationQASourceKind = "quest" | "category";

export interface TranslationQAIssue {
	code: string;
	severity: "error" | "warning" | "info";
	message: string;
}

export type TranslationQAAttachmentConfidence = "high" | "medium" | "low";

export interface TranslationQAAttachmentReason {
	code: string;
	message: string;
}

export interface TranslationQAAttachmentCandidate {
	occurrenceId: string;
	key: string;
	sourceKind: TranslationQASourceKind;
	sourceRef: string;
	sourcePath: string;
	questId?: string;
	questTitle?: string;
	chapterTitle?: string;
	lineNo?: number;
	lineId?: string;
	speaker?: string;
	sourceText: string;
	score: number;
	confidence: TranslationQAAttachmentConfidence;
	sameQuest: boolean;
	reasons: TranslationQAAttachmentReason[];
}

export interface TranslationQAAttachmentEvidence {
	occurrenceId: string;
	key: string;
	lineNo?: number;
	lineId?: string;
	sourceText: string;
	targetText: string;
	targetVariant?: string;
	currentScore: number;
	score: number;
	margin: number;
	confidence: TranslationQAAttachmentConfidence;
	reasons: TranslationQAAttachmentReason[];
	candidates: TranslationQAAttachmentCandidate[];
}

export interface TranslationQAGlossaryMatch {
	term: string;
	translation: string;
	category?: string;
	present: boolean;
}

export interface TranslationQAContext {
	id: string;
	lineNo?: number;
	lineId?: string;
	speaker?: string;
	sourceText: string;
	targetText: string;
	previousText?: string;
	nextText?: string;
	attachmentEvidence?: TranslationQAAttachmentEvidence[];
}

export interface TranslationQAReview {
	status: "review" | "approved";
	comment: string;
	reviewer: string;
	updatedAt: string;
	fingerprint: string;
}

export interface TranslationQAItem {
	id: string;
	key: string;
	sourceKind: TranslationQASourceKind;
	sourceRef: string;
	sourcePath: string;
	questId?: string;
	questTitle?: string;
	chapterTitle?: string;
	lineNo?: number;
	speaker?: string;
	sourceText: string;
	targetText: string;
	targetVariant?: string;
	occurrences: number;
	contexts: TranslationQAContext[];
	issues: TranslationQAIssue[];
	glossaryMatches: TranslationQAGlossaryMatch[];
	attachmentEvidence: TranslationQAAttachmentEvidence[];
	autoStatus: "pass" | "review";
	status: TranslationQAStatus;
	review?: TranslationQAReview;
	fingerprint: string;
}

export interface TranslationQASummary {
	generatedAt: string;
	dataFingerprint: string;
	totalItems: number;
	totalOccurrences: number;
	parseErrors: number;
	statusCounts: Record<TranslationQAStatus, number>;
	issueCounts: Record<string, number>;
	sourceKindCounts: Record<TranslationQASourceKind, number>;
}

export interface TranslationQAReport {
	summary: TranslationQASummary;
	items: TranslationQAItem[];
}

export interface TranslationQAListResponse {
	summary: TranslationQASummary;
	items: TranslationQAItem[];
	page: number;
	pageSize: number;
	total: number;
}

export type TranslationQAScanJobStatus = "running" | "completed" | "failed";
export type TranslationQAScanStage =
	| "prepare"
	| "parse"
	| "alignment"
	| "snapshot"
	| "finalize";

export interface TranslationQAScanProgress {
	stage: TranslationQAScanStage;
	current: number;
	total: number;
	percent: number;
	detail: string;
}

export interface TranslationQAScanJob {
	id: string;
	status: TranslationQAScanJobStatus;
	startedAt: string;
	finishedAt?: string;
	progress: TranslationQAScanProgress;
	summary?: TranslationQASummary;
	error?: string;
}
