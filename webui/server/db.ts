import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
	Chapter,
	QuestDetail,
	TextCategory,
	TranslationDraft,
	AppliedVersion,
	LogEntry,
	HeartbeatPoint,
	SystemMetrics,
} from "../src/types/index.js";
import { realDataLoader } from "./realDataLoader.js";
import { invalidateTextVersionWorkingSet } from "./textVersions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface UploadArchive {
	id: string;
	appVersion: string;
	os: string;
	filename: string;
	fileCount: number;
	sizeBytes: number;
	uploadedAt: string;
	files: Array<{ name: string; size: number; content?: string }>;
}

export interface UserSession {
	token: string;
	username: string;
	role: "reader" | "translator" | "editor" | "admin";
	createdAt: string;
}

class WebUIDatabase {
	public chapters: Chapter[] = [
		{
			id: "ch1",
			number: "Chapter I",
			title: "Utterance of Frost & Thunder",
			region: "Jinzhou City",
			questCount: 18,
			totalLines: 4200,
			progressPercentage: 100,
			description:
				"Awal perjalanan Rover terbangun di lembah Huanglong dan bertemu Yangyang & Chixia di Jinzhou.",
		},
		{
			id: "ch2",
			number: "Chapter II",
			title: "Beneath the Crescent Moon",
			region: "Central Plains",
			questCount: 24,
			totalLines: 6100,
			progressPercentage: 98,
			description:
				"Menelusuri anomali gelombang Tacet Discords di Dataran Tengah Huanglong.",
		},
	];

	public quests: Record<string, QuestDetail> = {};

	public categories: TextCategory[] = [];

	public glossary: Record<
		string,
		{ term: string; translation: string; category?: string }
	> = {
		Resonator: { term: "Resonator", translation: "Resonator" },
		"Tacet Discord": { term: "Tacet Discord", translation: "Tacet Discord" },
		Frequency: { term: "Frequency", translation: "Frekuensi" },
		"Midnight Rangers": {
			term: "Midnight Rangers",
			translation: "Midnight Rangers",
		},
		"Gorges of Spirits": {
			term: "Gorges of Spirits",
			translation: "Ngarai Roh",
		},
		"Sentinel Jue": { term: "Sentinel Jue", translation: "Sentinel Jue" },
		Overclocking: {
			term: "Overclocking",
			translation: "Overclocking (Kelebihan Beban Frekuensi)",
		},
	};

	public drafts: TranslationDraft[] = [
		{
			id: "draft_101",
			questId: "102000000",
			questTitle: "Starlights from Yesterdays",
			lineId: "line_1",
			lineNo: 1,
			speakerName: "Luuk Herssen",
			author: {
				name: "ResonatorTranslator_ID",
				role: "Translator",
			},
			sourceText: "Hello, {Male=golden boy;Female=golden girl}.",
			previousText: "Hello, {Male=golden boy;Female=golden girl}.",
			proposedText:
				"Halo, {Male=pria emas;Female=gadis emas}. Selamat datang di Huanglong.",
			status: "pending",
			createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
		},
		{
			id: "draft_102",
			questId: "121000040",
			questTitle: "Starlights from Yesterdays",
			lineId: "line_2",
			lineNo: 2,
			speakerName: "Luuk Herssen",
			author: {
				name: "MidnightEditor_S",
				role: "Editor",
			},
			sourceText:
				"Now that the Dark Side incident is wrapped up, management work in the hospital has returned to normal.",
			previousText:
				"Sekarang insiden Sisi Gelap telah usai, pekerjaan manajemen di rumah sakit telah kembali normal.",
			proposedText:
				"Setelah insiden Sisi Gelap terselesaikan, pengelolaan di rumah sakit kini kembali berjalan normal.",
			status: "pending",
			createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
		},
		{
			id: "draft_103",
			questId: "102000000",
			questTitle: "Jinzhou Main Quest",
			lineId: "line_3",
			lineNo: 3,
			speakerName: "Jiyan",
			author: {
				name: "HuanglongLinguist",
				role: "Senior Translator",
			},
			sourceText:
				"Welcome to Jinzhou, Resonator. Your awakening heralds a shift in the tide.",
			previousText:
				"Selamat datang di Jinzhou, Resonator. Kebangkitanmu menandai perubahan pasang surut.",
			proposedText:
				"Selamat datang di Jinzhou, Resonator. Kebangkitanmu menandai perubahan arah angin gelombang.",
			status: "approved",
			createdAt: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
		},
		{
			id: "draft_104",
			questId: "102000000",
			questTitle: "Jinzhou Main Quest",
			lineId: "line_5",
			lineNo: 5,
			speakerName: "Chixia",
			author: {
				name: "DraftUser99",
				role: "Contributor",
			},
			sourceText: "Yangyang! Hey! Is our new friend awake now?",
			previousText: "Yangyang! Hei! Apakah teman baru kita sudah bangun?",
			proposedText: "Woy Yangyang! Teman baru bangun gak tuh?",
			status: "rejected",
			rejectionReason:
				"Gaya bahasa terlalu informal/gaul, tidak sesuai pedoman tata bahasa resmi game.",
			createdAt: new Date(Date.now() - 1000 * 60 * 480).toISOString(),
		},
	];

	public appliedVersions: AppliedVersion[] = [];

	public logEntries: LogEntry[] = [];
	public heartbeatHistory: HeartbeatPoint[] = [];
	public heartbeats: HeartbeatPoint[] = [];
	public archives: UploadArchive[] = [];
	public uploads: UploadArchive[] = [];
	public sessions: Map<string, UserSession> = new Map();
	private versionsSignature = "";

	constructor() {
		this.loadDrafts();
		this.loadVersions();
	}

	private loadDrafts() {
		const draftsFile = path.resolve(__dirname, "../../data/quests/drafts.json");
		if (fs.existsSync(draftsFile)) {
			try {
				const raw = fs.readFileSync(draftsFile, "utf-8");
				const list = JSON.parse(raw);
				if (Array.isArray(list) && list.length > 0) {
					this.drafts = list;
				}
			} catch (e) {
				console.error("[db] Failed loading drafts.json:", e);
			}
		} else {
			this.saveDrafts();
		}
	}

	public saveDrafts() {
		const draftsFile = path.resolve(__dirname, "../../data/quests/drafts.json");
		try {
			const dir = path.dirname(draftsFile);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				draftsFile,
				JSON.stringify(this.drafts, null, 2),
				"utf-8",
			);
		} catch (e) {
			console.error("[db] Failed saving drafts.json:", e);
		}
	}

	private getVersionsFile() {
		return path.resolve(__dirname, "../../data/version_history.json");
	}

	private getVersionsSignature() {
		const versionsFile = this.getVersionsFile();
		if (!fs.existsSync(versionsFile)) return "";
		const stats = fs.statSync(versionsFile);
		return `${stats.mtimeMs}:${stats.size}`;
	}

	private loadVersions() {
		const versionsFile = this.getVersionsFile();
		if (fs.existsSync(versionsFile)) {
			try {
				const raw = fs.readFileSync(versionsFile, "utf-8");
				const list = JSON.parse(raw);
				if (Array.isArray(list)) {
					this.appliedVersions = list;
				}
			} catch (e) {
				console.error("[db] Failed loading versions.json:", e);
			}
		} else {
			this.saveVersions();
		}
		this.versionsSignature = this.getVersionsSignature();
	}

	private refreshVersions() {
		const signature = this.getVersionsSignature();
		if (signature !== this.versionsSignature) {
			this.loadVersions();
		}
	}

	public getAppliedVersions() {
		this.refreshVersions();
		return this.appliedVersions;
	}

	public saveVersions() {
		const versionsFile = this.getVersionsFile();
		try {
			const dir = path.dirname(versionsFile);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				versionsFile,
				JSON.stringify(this.appliedVersions, null, 2),
				"utf-8",
			);
		} catch (e) {
			console.error("[db] Failed saving versions.json:", e);
		}
		this.versionsSignature = this.getVersionsSignature();
	}

	public createSession(
		role: "editor" | "admin",
		username: string,
	): UserSession {
		const token = `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const session: UserSession = {
			token,
			role,
			username,
			createdAt: new Date().toISOString(),
		};
		this.sessions.set(token, session);
		return session;
	}

	public createDraft(data: Partial<TranslationDraft>): TranslationDraft {
		const questId = data.questId || "102000000";
		let questTitle = data.questTitle;

		if (!questTitle && realDataLoader.isAvailable()) {
			const detail = realDataLoader.getQuestDetail(questId);
			if (detail) {
				questTitle = detail.title.id || detail.title.en;
			}
		}

		const newDraft: TranslationDraft = {
			id: `draft_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
			questId,
			questTitle: questTitle || `Quest #${questId}`,
			lineId: data.lineId || "line_1",
			lineNo: data.lineNo || 1,
			speakerName: data.speakerName || "N/A",
			author: data.author || { name: "Penerjemah WuwaID", role: "Translator" },
			sourceText: data.sourceText || "",
			previousText: data.previousText || "",
			proposedText: data.proposedText || "",
			status: "pending",
			createdAt: new Date().toISOString(),
		};

		this.drafts.unshift(newDraft);
		this.saveDrafts();
		return newDraft;
	}

	public updateDraftStatus(
		id: string,
		status: "approved" | "rejected",
		_reviewerName: string,
		reason?: string,
	): TranslationDraft | null {
		const draft = this.drafts.find((d) => d.id === id);
		if (!draft) return null;

		draft.status = status;
		if (reason) {
			draft.rejectionReason = reason;
		}
		this.saveDrafts();
		return draft;
	}

	public applyApprovedDrafts(): {
		status: string;
		appliedCount: number;
		versionTag: string;
	} {
		this.refreshVersions();
		const approvedDrafts = this.drafts.filter((d) => d.status === "approved");
		if (approvedDrafts.length === 0) {
			return { status: "none", appliedCount: 0, versionTag: "" };
		}

		const REPO_ROOT = path.resolve(__dirname, "../../");
		const QUESTS_DIR = path.join(REPO_ROOT, "data/quests/quests");

		const grouped = new Map<string, TranslationDraft[]>();
		for (const d of approvedDrafts) {
			const list = grouped.get(d.questId) || [];
			list.push(d);
			grouped.set(d.questId, list);
		}

		let appliedCount = 0;
		const diffSummary: Array<{ questTitle: string; linesChanged: number }> = [];

		for (const [questId, drafts] of grouped.entries()) {
			const filePath = path.join(QUESTS_DIR, `${questId}.json`);
			let linesChangedInQuest = 0;

			if (fs.existsSync(filePath)) {
				try {
					const rawText = fs.readFileSync(filePath, "utf-8");
					const questJson = JSON.parse(rawText);

					let dialogueList: any[] = [];
					if (Array.isArray(questJson.all_lines))
						dialogueList = questJson.all_lines;
					else if (Array.isArray(questJson.dialogue))
						dialogueList = questJson.dialogue;

					for (const d of drafts) {
						const line = dialogueList.find(
							(item: any, idx: number) =>
								(d.lineNo && idx + 1 === d.lineNo) ||
								(d.lineId &&
									(`line_${item.id || idx + 1}` === d.lineId ||
										String(item.id) === d.lineId)) ||
								item.text_en === d.sourceText,
						);

						if (line) {
							line.text_id = d.proposedText;
							line.text_id_mt = d.proposedText;
							d.status = "approved";
							linesChangedInQuest++;
							appliedCount++;
						}
					}

					fs.writeFileSync(
						filePath,
						JSON.stringify(questJson, null, 2),
						"utf-8",
					);
					diffSummary.push({
						questTitle: drafts[0].questTitle || `Quest ${questId}`,
						linesChanged: linesChangedInQuest,
					});
				} catch (e) {
					console.error(`[db] Error applying drafts to quest ${questId}:`, e);
				}
			}
		}

		this.saveDrafts();
		realDataLoader.invalidateTranslationStats();
		invalidateTextVersionWorkingSet();

		const versionTag = `v1.2.${Date.now().toString().slice(-4)}-ID`;
		const newVersion: AppliedVersion = {
			versionTag,
			appliedAt: new Date().toISOString(),
			author: "Reviewer Admin",
			commitHash: Math.random().toString(36).substring(2, 9),
			totalLinesModified: appliedCount,
			description: `Penerapan Draf Terjemahan disetujui (${appliedCount} baris dialog ter-update ke berkas resmi).`,
			diffSummary,
		};

		this.appliedVersions.unshift(newVersion);
		this.saveVersions();

		return { status: "success", appliedCount, versionTag };
	}

	public getSystemMetrics(): SystemMetrics {
		const chapters = realDataLoader.getChapters();
		const translationProgress = realDataLoader.getTranslationProgress();
		let totalQuests = 1065;
		let totalDialogueLines = translationProgress.totalLines || 249293;

		if (chapters && chapters.length > 0) {
			totalQuests = chapters.reduce((acc, ch) => acc + ch.questCount, 0);
			totalDialogueLines =
				translationProgress.totalLines ||
				chapters.reduce((acc, ch) => acc + ch.totalLines, 0);
		}

		return {
			totalQuests,
			totalDialogueLines,
			translationCoverageId: translationProgress.percentage,
			activeTranslators: 12,
			activePlayers24h: 3420,
			serverStatus: "online",
		};
	}
}

export const db = new WebUIDatabase();
