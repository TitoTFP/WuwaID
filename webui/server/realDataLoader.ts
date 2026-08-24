import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type {
	Chapter,
	QuestDetail,
	QuestDetailPage,
	QuestSummary,
	TextCategory,
	DialogueLine,
} from "../src/types/index.js";
import {
	CATEGORIES_JSON_DIR,
	REPO_ROOT as CATEGORY_REPO_ROOT,
	resolveCategoryFile,
} from "./categoryStore.js";
import { ensureTranslationStatsTable } from "./translationStatsStore.js";
import { ensureReaderIndex } from "./readerIndexStore.js";

// Path to canonical real data (data/quests)
const REPO_ROOT = CATEGORY_REPO_ROOT;
const QUESTS_DATA_DIR = path.join(REPO_ROOT, "data/quests");

const QUESTS_JSON_DIR = path.join(QUESTS_DATA_DIR, "quests");
const CHAPTERS_FILE = path.join(QUESTS_DATA_DIR, "chapters.json");
const CATEGORIES_MANIFEST_FILE = path.join(QUESTS_DATA_DIR, "categories.json");
const INDEX_DB_FILE = path.join(QUESTS_DATA_DIR, "index.db");

export interface CategoryDetailResult {
	name: string;
	totalItems: number;
	filteredItems: number;
	translatedItems: number;
	translatedTextTotal: number;
	progressPercentage: number;
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

interface TranslationStats {
	total: number;
	translated: number;
	textTotal: number;
	textTranslated: number;
}

interface TranslationCorpusStats {
	overall: TranslationStats;
	byChapter: Map<number, TranslationStats>;
	byQuest: Map<string, TranslationStats>;
}

export interface GlobalSearchOptions {
	lang?: "en" | "id" | "zh" | "ja";
	scope?: "all" | "dialogue" | "quest" | "category";
	speaker?: string;
	untranslated?: boolean;
	limit?: number;
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

function ftsQuery(value: string): string {
	return value
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((term) => `"${term.replaceAll('"', '""')}"`)
		.join(" AND ");
}

export class RealDataLoader {
	private loadedChapters: Chapter[] | null = null;
	private loadedCategories: TextCategory[] | null = null;
	private db: DatabaseSync | null = null;
	private questDetailCache: Map<string, QuestDetail> = new Map();
	private translationStatsCache: TranslationCorpusStats | null = null;
	private dataSignature = "";

	private getDataSignature(): string {
		return [INDEX_DB_FILE, CHAPTERS_FILE, CATEGORIES_MANIFEST_FILE]
			.map((filePath) => {
				if (!fs.existsSync(filePath)) return `${filePath}:missing`;
				const stats = fs.statSync(filePath);
				return `${filePath}:${stats.mtimeMs}:${stats.size}`;
			})
			.join("|");
	}

	private ensureFresh(): void {
		const nextSignature = this.getDataSignature();
		if (this.dataSignature && nextSignature !== this.dataSignature) {
			console.log("[RealDataLoader] Generated data changed; refreshing caches.");
			this.invalidateTranslationStats();
		}
		this.dataSignature = nextSignature;
	}

	private getLineTranslationStats(rows: any[]): TranslationStats {
		const textItems = rows
			.flatMap((row) => [row, ...(Array.isArray(row?.options) ? row.options : [])])
			.filter((item) => item?.text_key);
		const isTranslated = (item: any) =>
			[item?.text_id, item?.text_id_mt].some((value) =>
				typeof value === "string" ? value.trim().length > 0 : Boolean(value),
			);

		return {
			total: rows.length,
			translated: rows.filter(isTranslated).length,
			textTotal: textItems.length,
			textTranslated: textItems.filter(isTranslated).length,
		};
	}

	private getIndexedTranslationStats(): TranslationCorpusStats | null {
		if (!this.db) return null;

		try {
			let rows: Array<Record<string, unknown>>;
			try {
				rows = this.db
					.prepare(
						"SELECT qid, chapter_id, total, translated, text_total, text_translated FROM translation_stats",
					)
					.all() as Array<Record<string, unknown>>;
			} catch {
				rows = this.db
					.prepare(
						`SELECT d.qid, COALESCE(q.chapter_id, 0) AS chapter_id,
							COUNT(*) AS total,
							SUM(CASE WHEN TRIM(COALESCE(d.text_id, '')) <> '' THEN 1 ELSE 0 END) AS translated
						 FROM dialogue_idx d
						 LEFT JOIN quests q ON q.qid = d.qid
						 GROUP BY d.qid, COALESCE(q.chapter_id, 0)`,
					)
					.all() as Array<Record<string, unknown>>;
			}
			if (rows.length === 0) return null;

			const overall: TranslationStats = {
				total: 0,
				translated: 0,
				textTotal: 0,
				textTranslated: 0,
			};
			const byChapter = new Map<number, TranslationStats>();
			const byQuest = new Map<string, TranslationStats>();

			for (const row of rows) {
				const stats: TranslationStats = {
					total: Number(row.total || 0),
					translated: Number(row.translated || 0),
					textTotal: Number(row.text_total || row.total || 0),
					textTranslated: Number(row.text_translated || row.translated || 0),
				};
				const questId = String(row.qid || "");
				const chapterId = Number(row.chapter_id || 0);
				if (questId) byQuest.set(questId, stats);

				for (const [key, value] of Object.entries(stats)) {
					overall[key as keyof TranslationStats] += value;
				}
				const chapterStats = byChapter.get(chapterId) || {
					total: 0,
					translated: 0,
					textTotal: 0,
					textTranslated: 0,
				};
				for (const [key, value] of Object.entries(stats)) {
					chapterStats[key as keyof TranslationStats] += value;
				}
				byChapter.set(chapterId, chapterStats);
			}

			return { overall, byChapter, byQuest };
		} catch (error) {
			console.warn(
				"[RealDataLoader] Indexed translation stats unavailable:",
				error,
			);
			return null;
		}
	}

	private getTranslationStats(): TranslationCorpusStats {
		if (this.translationStatsCache) return this.translationStatsCache;

		const indexedStats = this.getIndexedTranslationStats();
		if (indexedStats) {
			this.translationStatsCache = indexedStats;
			return indexedStats;
		}

		const emptyStats: TranslationCorpusStats = {
			overall: { total: 0, translated: 0, textTotal: 0, textTranslated: 0 },
			byChapter: new Map(),
			byQuest: new Map(),
		};
		this.translationStatsCache = emptyStats;
		return emptyStats;
	}

	private getPercentage(stats: TranslationStats): number {
		return stats.total > 0
			? Math.round((stats.translated / stats.total) * 10000) / 100
			: 0;
	}

	private getTextPercentage(stats: TranslationStats): number {
		return stats.textTotal > 0
			? Math.round((stats.textTranslated / stats.textTotal) * 10000) / 100
			: 0;
	}

	public getTranslationProgress() {
		this.ensureFresh();
		const stats = this.getTranslationStats().overall;
		return {
			totalLines: stats.total,
			translatedLines: stats.translated,
			percentage: this.getTextPercentage(stats),
		};
	}

	private searchDialogueKeys(
		query: string,
		lang: "en" | "id" | "zh" | "ja",
		limit: number,
		options: { speaker?: string; untranslated?: boolean } = {},
	): GlobalSearchResult[] {
		if (
			!this.db ||
			query.length < 12 ||
			!/^[A-Za-z0-9]+(?:_[A-Za-z0-9]*)+$/.test(query)
		) {
			return [];
		}

		const keyQuery = ftsQuery(query);
		if (!keyQuery) return [];
		try {
			const clauses = ["dialogue_key_idx MATCH ?"];
			const params: Array<string | number> = [`text_key : ${keyQuery}`];
			if (options.speaker) {
				clauses.push("speaker_en LIKE ? ESCAPE '\\' COLLATE NOCASE");
				const speakerPattern = options.speaker.replace(/[\\%_]/g, "\\$&");
				params.push(`%${speakerPattern}%`);
			}
			if (options.untranslated) {
				clauses.push("(text_id IS NULL OR trim(text_id) = '')");
			}
			const rows = this.db
				.prepare(
					`SELECT qid, line_id, is_option, text_key, quest_name, chapter_name,
							speaker_en, text_en, text_zh, text_ja, text_id
					 FROM dialogue_key_idx
					 WHERE ${clauses.join(" AND ")}
					 ORDER BY rowid
					 LIMIT ?`,
				)
				.all(...params, limit) as Array<Record<string, unknown>>;

			return rows.map((row) => {
				const qid = String(row.qid);
				const lineId = String(row.line_id);
				const key = String(row.text_key || "");
				const textId = String(row.text_id || "");
				const textEn = String(row.text_en || row.text_zh || "");
				const textZh = String(row.text_zh || "");
				const textJa = String(row.text_ja || "");
				const text =
					lang === "en"
						? textEn
						: lang === "zh"
							? textZh
							: lang === "ja"
								? textJa
								: textId;
				return {
					kind: "dialogue",
					id: `${qid}:${lineId}:${key}`,
					questId: qid,
					questTitle: String(row.quest_name || `Quest ${qid}`),
					chapterTitle: String(row.chapter_name || ""),
					lineId,
					lineNo: Number(lineId),
					speakerName: String(
						row.speaker_en || (Number(row.is_option) ? "Player" : "Narrator"),
					),
					text: text || textEn,
					englishText: textEn,
					translated: textId.trim().length > 0,
					lang,
				};
			}) as GlobalSearchResult[];
		} catch (error) {
			console.warn("[RealDataLoader] Dialogue key search failed:", error);
			return [];
		}
	}

	public search(
		query: string,
		options: GlobalSearchOptions = {},
	): GlobalSearchResult[] {
		this.ensureFresh();
		if (!this.db) return [];

		const term = query.trim();
		const scope = options.scope || "all";
		const limit = Math.max(1, Math.min(20, options.limit || 8));
		const lang = options.lang || "id";
		const textColumn =
			lang === "en"
				? "text_en"
				: lang === "zh"
					? "text_zh"
					: lang === "ja"
						? "text_ja"
						: "text_id";
		const results: GlobalSearchResult[] = [];
		const dialogueQuery = ftsQuery(term);
		const categoryQuery = ftsQuery(term);
		const dialogueKeyResults =
			scope === "all" || scope === "dialogue"
				? this.searchDialogueKeys(term, lang, limit, {
						speaker: options.speaker,
						untranslated: options.untranslated,
					})
				: [];
		results.push(...dialogueKeyResults);

		if (scope === "all" || scope === "dialogue") {
			try {
				const clauses: string[] = [];
				const params: Array<string | number> = [];
				if (dialogueQuery) {
					clauses.push(`dialogue_idx MATCH ?`);
					params.push(
						options.speaker
							? `speaker_en : ${ftsQuery(options.speaker)} AND ${textColumn} : ${dialogueQuery}`
							: `${textColumn} : ${dialogueQuery}`,
					);
				} else if (options.speaker) {
					clauses.push("dialogue_idx MATCH ?");
					params.push(`speaker_en : ${ftsQuery(options.speaker)}`);
				}
				if (options.untranslated) {
					clauses.push("(text_id IS NULL OR trim(text_id) = '')");
				}
				if (clauses.length === 0) {
					clauses.push("1 = 1");
				}

				const rows = this.db
					.prepare(
						`SELECT qid, line_id, quest_name, chapter_name, speaker_en, text_en, text_id, text_zh, text_ja
						 FROM dialogue_idx WHERE ${clauses.join(" AND ")} LIMIT ?`,
					)
					.all(...params, Math.max(0, limit - dialogueKeyResults.length)) as Array<
					Record<string, unknown>
				>;
				for (const row of rows) {
					const translated = String(row.text_id || "").trim().length > 0;
					const text = String(row[textColumn] || row.text_en || "");
					const qid = String(row.qid);
					const lineId = String(row.line_id);
					results.push({
						kind: "dialogue",
						id: `${qid}:${lineId}`,
						questId: qid,
						questTitle: String(row.quest_name || `Quest ${qid}`),
						chapterTitle: String(row.chapter_name || ""),
						lineId,
						lineNo: Number(row.line_id),
						speakerName: String(row.speaker_en || "Narrator"),
						text: text || String(row.text_en || ""),
						englishText: String(row.text_en || ""),
						translated,
						lang,
					});
				}
			} catch (error) {
				console.warn("[RealDataLoader] Dialogue search failed:", error);
			}
		}

		if (scope === "all" || scope === "quest") {
			try {
				const questTerm = `%${term}%`;
				const rows = this.db
					.prepare(
						"SELECT qid, quest_name, chapter_id, chapter_name, quest_type, total_lines FROM quests WHERE CAST(qid AS TEXT) LIKE ? OR quest_name LIKE ? ORDER BY qid LIMIT ?",
					)
					.all(questTerm, questTerm, limit) as Array<Record<string, unknown>>;
				const stats = this.getTranslationStats().byQuest;
				for (const row of rows) {
					const qid = String(row.qid);
					const questStats = stats.get(qid);
					results.push({
						kind: "quest",
						id: qid,
						title: String(row.quest_name || `Quest ${qid}`),
						chapterTitle: String(row.chapter_name || `Chapter ${row.chapter_id}`),
						totalLines: Number(row.total_lines || 0),
						translatedLines: questStats?.textTranslated || 0,
						translatedTextTotal:
							questStats?.textTotal || Number(row.total_lines || 0),
					});
				}
			} catch (error) {
				console.warn("[RealDataLoader] Quest search failed:", error);
			}
		}

		if (scope === "all" || scope === "category") {
			try {
				const categoryRows = term
					? (this.db
							.prepare(
								"SELECT name, key_count, translated_count FROM categories WHERE name LIKE ? ORDER BY name LIMIT ?",
							)
							.all(`%${term}%`, limit) as Array<Record<string, unknown>>)
					: [];
				const categoryKeyRows = term
					? (this.db
							.prepare(
								`SELECT category, key, text_en, text_id, text_zh, text_ja
								 FROM category_text_idx WHERE key LIKE ? COLLATE NOCASE LIMIT ?`,
							)
							.all(`%${term}%`, limit) as Array<Record<string, unknown>>)
					: [];
				const textCategoryColumn =
					lang === "en"
						? "text_en"
						: lang === "zh"
							? "text_zh"
							: lang === "ja"
								? "text_ja"
								: "text_id";
				const textRows = categoryQuery
					? (this.db
							.prepare(
								`SELECT category, key, text_en, text_id, text_zh, text_ja
								 FROM category_text_idx WHERE category_text_idx MATCH ? LIMIT ?`,
							)
							.all(`${textCategoryColumn} : ${categoryQuery}`, limit) as Array<
							Record<string, unknown>
						>)
					: [];
				const seen = new Set<string>();
				for (const row of [...categoryRows, ...categoryKeyRows, ...textRows]) {
					const categoryName = String(row.name || row.category || "");
					const key = String(row.key || categoryName);
					const resultId = `${categoryName}:${key}`;
					if (!categoryName || seen.has(resultId)) continue;
					seen.add(resultId);
					results.push({
						kind: "category",
						id: resultId,
						categoryName,
						key: row.key ? key : undefined,
						title: row.key
							? String(row[textCategoryColumn] || row.text_en || key)
							: categoryName,
						text: row.key
							? String(row[textCategoryColumn] || row.text_en || "")
							: undefined,
						totalItems: Number(row.key_count || 0),
						translatedItems: Number(row.translated_count || 0),
						translated: String(row.text_id || "").trim().length > 0,
					});
				}
			} catch (error) {
				console.warn("[RealDataLoader] Category search failed:", error);
			}
		}

		return results.slice(0, limit);
	}

	public invalidateTranslationStats() {
		this.translationStatsCache = null;
		this.loadedChapters = null;
		this.loadedCategories = null;
		this.questDetailCache.clear();
		this.questSourceFileCache.clear();
		if (this.db) this.db.close();
		this.db = null;
		if (fs.existsSync(INDEX_DB_FILE)) {
			try {
				ensureTranslationStatsTable(INDEX_DB_FILE);
				this.db = new DatabaseSync(INDEX_DB_FILE, {
					open: true,
					readOnly: true,
				});
			} catch (error) {
				console.warn("[RealDataLoader] Failed reopening index.db:", error);
			}
		}
	}

	public isAvailable(): boolean {
		this.ensureFresh();
		return fs.existsSync(QUESTS_DATA_DIR);
	}

	constructor() {
		ensureReaderIndex(INDEX_DB_FILE);
		if (fs.existsSync(INDEX_DB_FILE)) {
			try {
				ensureTranslationStatsTable(INDEX_DB_FILE);
			} catch (error) {
				console.warn("[RealDataLoader] Failed preparing translation stats:", error);
			}

			try {
				this.db = new DatabaseSync(INDEX_DB_FILE, {
					open: true,
					readOnly: true,
				});
			} catch (e) {
				console.warn(
					"[RealDataLoader] Failed opening index.db with node:sqlite:",
					e,
				);
			}
		}
		this.translationStatsCache = this.getIndexedTranslationStats();
		this.dataSignature = this.getDataSignature();
	}

	public getChapters(): Chapter[] | null {
		this.ensureFresh();
		if (this.loadedChapters) return this.loadedChapters;

		try {
			if (fs.existsSync(CHAPTERS_FILE)) {
				const raw = fs.readFileSync(CHAPTERS_FILE, "utf-8");
				const data = JSON.parse(raw);

				if (Array.isArray(data)) {
					const statsByChapter = this.getTranslationStats().byChapter;
					this.loadedChapters = data.map((ch: any) => {
						const stats = statsByChapter.get(Number(ch.id)) || {
							total: 0,
							translated: 0,
							textTotal: 0,
							textTranslated: 0,
						};
						const totalLines = stats.total || ch.line_count || 0;

						return {
							id: `ch_${ch.id}`,
							number: ch.id === 0 ? "Side Quests" : `Chapter ${ch.id}`,
							title: ch.name,
							region:
								ch.id === 1
									? "Jinzhou"
									: ch.id === 2
										? "Central Plains"
										: ch.id === 3
											? "Mt. Firmament"
											: "Huanglong",
							questCount: ch.quest_count || 0,
							totalLines,
							progressPercentage: this.getPercentage({
								...stats,
								total: totalLines,
							}),
							description: `Chapter ${ch.name} data resmi game WuwaID (${ch.quest_count} quest, ${totalLines} baris dialog)`,
						};
					});
					return this.loadedChapters;
				}
			}
		} catch (e) {
			console.error("[RealDataLoader] Error reading chapters:", e);
		}
		return null;
	}

	public getQuestsSummary(opts?: {
		chapterId?: string;
		search?: string;
		type?: string;
		sort?: string;
		limit?: number;
		unbounded?: boolean;
	}): QuestSummary[] | null {
		this.ensureFresh();
		const chapterId = opts?.chapterId;
		const search = opts?.search?.trim();
		const type = opts?.type;
		const sort = opts?.sort || "id_asc";
		const targetChNum = chapterId
			? parseInt(chapterId.replace("ch_", "").replace("ch", ""), 10)
			: null;
		const requestedLimit =
			opts?.unbounded || opts?.limit === undefined || !Number.isFinite(opts.limit)
				? undefined
				: Math.max(1, Math.min(200, Math.floor(opts.limit)));
		const defaultLimit =
			!opts?.unbounded &&
			targetChNum === null &&
			!search &&
			(!type || type === "all")
				? 100
				: undefined;
		const resultLimit = requestedLimit ?? defaultLimit;

		// Fast path: SQLite query from index.db
		if (this.db) {
			try {
				let sql =
					"SELECT qid, quest_name, quest_type, side, chapter_id, chapter_name, total_lines, translated_count FROM quests";
				const conditions: string[] = [];
				const params: any[] = [];

				if (targetChNum !== null && !isNaN(targetChNum)) {
					conditions.push("chapter_id = ?");
					params.push(targetChNum);
				}

				if (type && type !== "all") {
					if (type === "main") {
						conditions.push("quest_type = 1");
					} else if (type === "side") {
						conditions.push("quest_type != 1");
					} else if (!isNaN(Number(type))) {
						conditions.push("quest_type = ?");
						params.push(Number(type));
					}
				}

				if (search) {
					if (isNaN(Number(search))) {
						conditions.push("quest_name LIKE ?");
						params.push(`%${search}%`);
					} else {
						conditions.push("(qid = ? OR quest_name LIKE ?)");
						params.push(Number(search), `%${search}%`);
					}
				}

				if (conditions.length > 0) {
					sql += " WHERE " + conditions.join(" AND ");
				}

				let orderBy = "ORDER BY qid ASC";
				if (sort === "id_desc") orderBy = "ORDER BY qid DESC";
				else if (sort === "name_asc") orderBy = "ORDER BY quest_name ASC";
				else if (sort === "name_desc") orderBy = "ORDER BY quest_name DESC";
				else if (sort === "lines_desc") orderBy = "ORDER BY total_lines DESC";
				else if (sort === "lines_asc") orderBy = "ORDER BY total_lines ASC";

				sql += ` ${orderBy}`;
				if (resultLimit !== undefined) {
					sql += " LIMIT ?";
					params.push(resultLimit);
				}

				const rows: any[] = this.db.prepare(sql).all(...params);

				if (rows) {
					return rows.map((r: any) => ({
						id: String(r.qid),
						chapterId: `ch_${r.chapter_id}`,
						chapterTitle: r.chapter_name || `Chapter ${r.chapter_id}`,
						title: {
							en: r.quest_name || `Quest ${r.qid}`,
							id: r.quest_name || `Quest ${r.qid}`,
							"zh-Hans": r.quest_name || `Quest ${r.qid}`,
							ja: r.quest_name || `Quest ${r.qid}`,
						},
						type: r.quest_type === 1 ? "main" : "side",
						rawQuestType: r.quest_type === undefined ? 1 : r.quest_type,
						totalLines: r.total_lines || 0,
						translatedLines: {
							id:
								this.getTranslationStats().byQuest.get(String(r.qid))?.textTranslated ??
								0,
							zh: r.total_lines || 0,
							ja: r.total_lines || 0,
						},
						translatedTextTotal:
							this.getTranslationStats().byQuest.get(String(r.qid))?.textTotal ??
							(r.total_lines || 0),
						updatedAt: new Date().toISOString(),
					}));
				}
			} catch (e) {
				console.warn(
					"[RealDataLoader] index.db query failed, falling back to JSON scan:",
					e,
				);
			}
		}

		// The request path is read-model-only. A missing or corrupt index is handled by
		// the route's compatibility database, never by scanning the raw corpus.
		return null;
	}

	private questSourceFileCache = new Map<string, string | null>();

	public getQuestSourceFile(id: string): string | null {
		this.ensureFresh();
		if (this.questSourceFileCache.has(id)) {
			return this.questSourceFileCache.get(id) || null;
		}

		let result: string | null = null;
		if (this.db) {
			try {
				const row = this.db
					.prepare("SELECT file FROM quest_sources WHERE qid = ?")
					.get(id) as { file?: string } | undefined;
				const filePath = String(row?.file || "");
				const root = `${path.resolve(QUESTS_JSON_DIR)}${path.sep}`;
				if (
					filePath.startsWith(root) &&
					fs.existsSync(filePath) &&
					fs.statSync(filePath).isFile()
				) {
					result = filePath;
				}
			} catch {
				// A missing source index is handled as unavailable, never by scanning the corpus.
			}
		}
		this.questSourceFileCache.set(id, result);
		return result;
	}

	public getQuestDetail(id: string): QuestDetail | null {
		this.ensureFresh();
		if (this.questDetailCache.has(id)) {
			return this.questDetailCache.get(id)!;
		}

		const filePath = this.getQuestSourceFile(id);
		if (!filePath) {
			return null;
		}

		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			const data = JSON.parse(raw);

			let rawDialogue: any[] = [];
			if (Array.isArray(data.all_lines)) {
				rawDialogue = data.all_lines;
			} else if (Array.isArray(data.dialogue)) {
				rawDialogue = data.dialogue;
			} else if (Array.isArray(data.flows)) {
				for (const flow of data.flows) {
					if (Array.isArray(flow.dialogue)) {
						rawDialogue.push(...flow.dialogue);
					}
				}
			}

			const dialogueLines: DialogueLine[] = [];

			for (let i = 0; i < rawDialogue.length; i++) {
				const item = rawDialogue[i];
				const speakerZh =
					item["speaker_zh-Hans"] || item.speaker_zh || item.speaker || "N/A";
				const speakerEn = item.speaker_en || speakerZh;
				const speakerJa = item.speaker_ja || speakerZh;
				const speakerId =
					item.speaker_id || item["speaker_zh-Hans"] || "speaker_" + i;

				const textZh = item["text_zh-Hans"] || item.text_zh || "";
				const textEn = item.text_en || textZh;
				const textJa = item.text_ja || textZh;
				const textId = item.text_id || item.text_id_mt || "";

				dialogueLines.push({
					id: `line_${item.id || i + 1}`,
					lineNo: i + 1,
					type:
						item.type === "Option" || item.options
							? "choice"
							: item.type === "SceneSeparator"
								? "scene_separator"
								: "dialogue",
					speaker: {
						id: String(speakerId),
						name: {
							en: speakerEn,
							id: item.speaker_id || speakerEn,
							"zh-Hans": speakerZh,
							ja: speakerJa,
						},
					},
					text: {
						en: textEn,
						id: textId,
						"zh-Hans": textZh,
						ja: textJa,
					},
					options: Array.isArray(item.options)
						? item.options.map((opt: any, idx: number) => ({
								id: `opt_${idx + 1}`,
								text: {
									en: opt.text_en || opt["text_zh-Hans"] || opt.text_zh || "",
									id: opt.text_id || opt.text_id_mt || "",
									"zh-Hans": opt["text_zh-Hans"] || opt.text_zh || "",
									ja: opt.text_ja || "",
								},
							}))
						: undefined,
				});
			}

			const questStats = this.getLineTranslationStats(rawDialogue);
			const detail: QuestDetail = {
				id: String(data.quest_id || id),
				chapterId: `ch_${data.chapter_id === undefined ? 1 : data.chapter_id}`,
				chapterTitle: data.chapter_name || "Chapter I",
				title: {
					en: data.quest_name || `Quest ${id}`,
					id: data.quest_name || `Quest ${id}`,
					"zh-Hans": data.quest_name || `Quest ${id}`,
					ja: data.quest_name || `Quest ${id}`,
				},
				summary: {
					en: `Official quest data: ${data.quest_name || id}`,
					id: `Arsip quest resmi game WuwaID: ${data.quest_name || id}`,
				},
				type: data.chapter_id === 0 ? "side" : "main",
				totalLines: dialogueLines.length,
				translatedLines: questStats.textTranslated,
				translatedTextTotal: questStats.textTotal,
				lines: dialogueLines,
				updatedAt: new Date().toISOString(),
			};

			this.questDetailCache.set(id, detail);
			return detail;
		} catch (e) {
			console.error(`[RealDataLoader] Error reading quest ${id}:`, e);
		}

		return null;
	}

	public async getQuestDetailPage(
		id: string,
		opts: { page?: number; pageSize?: number; q?: string; speaker?: string } = {},
	): Promise<QuestDetailPage | null> {
		if (!this.db) return null;

		try {
			const metadata = this.db
				.prepare(
					"SELECT qid, quest_name, quest_type, chapter_id, chapter_name, total_lines FROM quests WHERE qid = ?",
				)
				.get(id) as Record<string, unknown> | undefined;
			if (!metadata) return null;

			const questId = Number(metadata.qid);
			const stats = this.getTranslationStats().byQuest.get(String(questId));
			const query = (opts.q || "").trim().toLocaleLowerCase();
			const speaker = (opts.speaker || "").trim();
			const pageSize = Math.max(
				1,
				Math.min(200, Math.floor(opts.pageSize || 200)),
			);
			const requestedPage = Math.max(1, Math.floor(opts.page || 1));
			const clauses = ["qid = ?"];
			const params: Array<string | number> = [questId];
			if (speaker && speaker !== "all") {
				clauses.push("speaker_search LIKE ? ESCAPE '\\'");
				const escapedSpeaker = speaker
					.toLocaleLowerCase()
					.replace(/[\\%_]/g, "\\$&");
				params.push(`%${escapedSpeaker}%`);
			}
			if (query) {
				clauses.push("search_text LIKE ? ESCAPE '\\'");
				const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
				params.push(`%${escapedQuery}%`);
			}
			const whereClause = clauses.join(" AND ");
			const filteredLines = Number(
				(
					this.db
						.prepare(
							`SELECT COUNT(*) AS count FROM quest_page_idx WHERE ${whereClause}`,
						)
						.get(...params) as { count?: number }
				)?.count || 0,
			);
			const totalPages = Math.max(1, Math.ceil(filteredLines / pageSize));
			const page = Math.min(totalPages, requestedPage);
			const readParams = [...params, pageSize, (page - 1) * pageSize];
			const rows = this.db
				.prepare(
					`SELECT line_no, line_id, line_type, speaker_id, speaker_name_id,
							speaker_en, speaker_zh, speaker_ja, text_en, text_zh, text_ja,
							text_id, options_json
					 FROM quest_page_idx
					 WHERE ${whereClause}
					 ORDER BY line_no
					 LIMIT ? OFFSET ?`,
				)
				.all(...readParams) as Array<Record<string, unknown>>;

			const readString = (
				row: Record<string, unknown>,
				...keys: string[]
			): string => {
				for (const key of keys) {
					const value = row[key];
					if (typeof value === "string") return value;
					if (typeof value === "number") return String(value);
				}
				return "";
			};
			const lines = rows.map((row) => {
				let rawOptions: unknown = undefined;
				if (String(row.options_json || "")) {
					try {
						rawOptions = JSON.parse(String(row.options_json));
					} catch {
						rawOptions = undefined;
					}
				}
				const options = Array.isArray(rawOptions)
					? rawOptions
							.filter((value): value is Record<string, unknown> =>
								Boolean(value && typeof value === "object" && !Array.isArray(value)),
							)
							.map((option, optionIndex) => ({
								id: `opt_${optionIndex + 1}`,
								text: {
									en: readString(option, "text_en", "text_zh-Hans", "text_zh"),
									id: readString(option, "text_id", "text_id_mt"),
									"zh-Hans": readString(option, "text_zh-Hans", "text_zh"),
									ja: readString(option, "text_ja"),
								},
							}))
					: undefined;
				const rawType = readString(row, "line_type");
				return {
					id: `line_${readString(row, "line_id") || row.line_no}`,
					lineNo: Number(row.line_no),
					type:
						rawType === "Option" || options
							? "choice"
							: rawType === "SceneSeparator"
								? "scene_separator"
								: "dialogue",
					speaker: {
						id: readString(row, "speaker_id"),
						name: {
							en: readString(row, "speaker_en"),
							id: readString(row, "speaker_name_id", "speaker_en"),
							"zh-Hans": readString(row, "speaker_zh"),
							ja: readString(row, "speaker_ja"),
						},
					},
					text: {
						en: readString(row, "text_en"),
						id: readString(row, "text_id"),
						"zh-Hans": readString(row, "text_zh"),
						ja: readString(row, "text_ja"),
					},
					options,
				};
			}) as DialogueLine[];
			const questIdText = String(metadata.qid || id);
			const questTitle = String(metadata.quest_name || `Quest ${questIdText}`);
			const chapterId = Number(metadata.chapter_id ?? 1);
			const totalLines = Number(metadata.total_lines || stats?.total || 0);

			return {
				id: questIdText,
				chapterId: `ch_${chapterId}`,
				chapterTitle: String(metadata.chapter_name || `Chapter ${chapterId}`),
				title: {
					en: questTitle,
					id: questTitle,
					"zh-Hans": questTitle,
					ja: questTitle,
				},
				summary: {
					en: `Official quest data: ${questTitle}`,
					id: `Arsip quest resmi game WuwaID: ${questTitle}`,
				},
				type: Number(metadata.quest_type || 0) === 1 ? "main" : "side",
				totalLines,
				translatedLines: stats?.textTranslated || 0,
				translatedTextTotal: stats?.textTotal || totalLines,
				lines,
				updatedAt: new Date().toISOString(),
				page,
				pageSize,
				filteredLines,
				totalPages,
				hasNextPage: page < totalPages,
				hasPreviousPage: page > 1,
			};
		} catch (error) {
			console.error(`[RealDataLoader] Error reading indexed quest ${id}:`, error);
			return null;
		}
	}

	public getCategories(opts?: {
		q?: string;
		limit?: number;
	}): TextCategory[] | null {
		this.ensureFresh();
		const query = opts?.q?.trim().toLowerCase() || "";
		const limit =
			opts?.limit === undefined || !Number.isFinite(opts.limit)
				? undefined
				: Math.max(1, Math.min(200, Math.floor(opts.limit)));
		const applyCategoryOptions = (categories: TextCategory[]) => {
			const filtered = query
				? categories.filter((category) =>
						category.name.toLowerCase().includes(query),
					)
				: categories;
			return limit === undefined ? filtered : filtered.slice(0, limit);
		};

		if (this.loadedCategories) return applyCategoryOptions(this.loadedCategories);
		if (!this.db) return null;

		{
			try {
				const rows = this.db
					.prepare(
						"SELECT name, file, key_count, translated_count FROM categories ORDER BY name",
					)
					.all() as Array<Record<string, unknown>>;
				if (rows.length > 0) {
					this.loadedCategories = rows.map((row) => {
						const name = String(row.name || "");
						const relativePath = String(row.file || `${name}.json`);
						const filePath = path.resolve(CATEGORIES_JSON_DIR, relativePath);
						const root = `${path.resolve(CATEGORIES_JSON_DIR)}${path.sep}`;
						const size =
							filePath.startsWith(root) && fs.existsSync(filePath)
								? fs.statSync(filePath).size
								: 0;
						const totalItems = Number(row.key_count || 0);
						const translatedItems = Number(row.translated_count || 0);
						return {
							id: `cat_${name.replaceAll("/", "_")}`,
							name,
							description: `Kategori teks resmi game: ${name} (${Math.round(size / 1024)} KB)`,
							totalItems,
							translatedItems,
							progressPercentage:
								totalItems > 0
									? Math.round((translatedItems / totalItems) * 10000) / 100
									: 0,
						};
					});
					return applyCategoryOptions(this.loadedCategories);
				}
			} catch (error) {
				console.warn("[RealDataLoader] Indexed categories unavailable:", error);
			}
		}

		return null;
	}

	public getCategoryDetail(
		categoryName: string,
		opts?: { q?: string; page?: number; limit?: number },
	): CategoryDetailResult | null {
		this.ensureFresh();
		if (!this.db) return null;
		const file = resolveCategoryFile(categoryName);
		if (!file) return null;
		const cleanName = file.name;

		try {
			const category = this.db
				.prepare(
					"SELECT key_count, translated_count FROM categories WHERE name = ?",
				)
				.get(cleanName) as
				| { key_count?: number; translated_count?: number }
				| undefined;
			if (!category) return null;

			const q = (opts?.q || "").toLowerCase().trim();
			const page = Math.max(1, Math.floor(opts?.page || 1));
			const limit = Math.max(1, Math.min(200, Math.floor(opts?.limit || 50)));
			const like = `%${q}%`;
			const where = q
				? `category = ? AND (
					key LIKE ? COLLATE NOCASE OR
					text_en LIKE ? COLLATE NOCASE OR
					text_zh LIKE ? COLLATE NOCASE OR
					text_ja LIKE ? COLLATE NOCASE OR
					text_id LIKE ? COLLATE NOCASE
				)`
				: "category = ?";
			const filterParams = q
				? [cleanName, like, like, like, like, like]
				: [cleanName];
			const filteredItems = q
				? Number(
						(
							this.db
								.prepare(
									`SELECT COUNT(*) AS count FROM category_text_idx WHERE ${where}`,
								)
								.get(...filterParams) as { count?: number }
						)?.count || 0,
					)
				: Number(category.key_count || 0);
			const totalItems = Number(category.key_count || 0);
			const totalPages = Math.ceil(filteredItems / limit) || 1;
			const validPage = Math.min(page, totalPages);
			const startIndex = (validPage - 1) * limit;
			const rows = this.db
				.prepare(
					`SELECT key, text_en, text_id, text_zh, text_ja
					 FROM category_text_idx
					 WHERE ${where}
					 ORDER BY rowid
					 LIMIT ? OFFSET ?`,
				)
				.all(...filterParams, limit, startIndex) as Array<Record<string, unknown>>;
			const items = rows.map((row) => ({
				key: String(row.key || ""),
				text: {
					en: String(row.text_en || ""),
					id: String(row.text_id || ""),
					"zh-Hans": String(row.text_zh || ""),
					ja: String(row.text_ja || ""),
				},
			}));
			const translatedItems = Number(category.translated_count || 0);

			return {
				name: cleanName,
				totalItems,
				filteredItems,
				translatedItems,
				translatedTextTotal: totalItems,
				progressPercentage:
					totalItems > 0
						? Math.round((translatedItems / totalItems) * 10000) / 100
						: 0,
				page: validPage,
				limit,
				totalPages,
				items,
			};
		} catch (error) {
			console.error(
				`[RealDataLoader] Error reading indexed category detail for ${categoryName}:`,
				error,
			);
			return null;
		}
	}
}

export const realDataLoader = new RealDataLoader();
