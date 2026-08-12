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
	appliedAt: string;
	author: string;
	commitHash: string;
	totalLinesModified: number;
	description: string;
	diffSummary: Array<{
		questTitle: string;
		linesChanged: number;
	}>;
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
