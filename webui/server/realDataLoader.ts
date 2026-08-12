import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type {
	Chapter,
	QuestDetail,
	QuestSummary,
	TextCategory,
	DialogueLine,
} from "../src/types/index.js";
import {
	CATEGORIES_JSON_DIR,
	REPO_ROOT as CATEGORY_REPO_ROOT,
	listCategoryFiles,
	readCategoryDocument,
	resolveCategoryFile,
} from "./categoryStore.js";

// Path to canonical real data (data/quests)
const REPO_ROOT = CATEGORY_REPO_ROOT;
const QUESTS_DATA_DIR = path.join(REPO_ROOT, "data/quests");

const QUESTS_JSON_DIR = path.join(QUESTS_DATA_DIR, "quests");
const CHAPTERS_FILE = path.join(QUESTS_DATA_DIR, "chapters.json");
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
	private categoryCache: Map<string, any> = new Map();
	private translationStatsCache: TranslationCorpusStats | null = null;

	private getDialogueRows(data: any): any[] {
		if (Array.isArray(data.all_lines)) return data.all_lines;
		if (Array.isArray(data.dialogue)) return data.dialogue;
		if (Array.isArray(data.flows)) {
			return data.flows.flatMap((flow: any) =>
				Array.isArray(flow.dialogue) ? flow.dialogue : [],
			);
		}
		return [];
	}

	private getLineTranslationStats(rows: any[]): TranslationStats {
		const textItems = rows
			.flatMap((row) => [
				row,
				...(Array.isArray(row?.options) ? row.options : []),
			])
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

	private getTranslationStats(): TranslationCorpusStats {
		if (this.translationStatsCache) return this.translationStatsCache;

		const overall: TranslationStats = {
			total: 0,
			translated: 0,
			textTotal: 0,
			textTranslated: 0,
		};
		const byChapter = new Map<number, TranslationStats>();
		const byQuest = new Map<string, TranslationStats>();

		if (fs.existsSync(QUESTS_JSON_DIR)) {
			for (const file of fs
				.readdirSync(QUESTS_JSON_DIR)
				.filter((f) => f.endsWith(".json"))) {
				try {
					const data = JSON.parse(
						fs.readFileSync(path.join(QUESTS_JSON_DIR, file), "utf-8"),
					);
					const questId = String(data.quest_id || file.replace(".json", ""));
					const chapterId = Number(data.chapter_id ?? 0);
					const stats = this.getLineTranslationStats(
						this.getDialogueRows(data),
					);
					byQuest.set(questId, stats);

					overall.total += stats.total;
					overall.translated += stats.translated;
					overall.textTotal += stats.textTotal;
					overall.textTranslated += stats.textTranslated;
					const chapterStats = byChapter.get(chapterId) || {
						total: 0,
						translated: 0,
						textTotal: 0,
						textTranslated: 0,
					};
					chapterStats.total += stats.total;
					chapterStats.translated += stats.translated;
					chapterStats.textTotal += stats.textTotal;
					chapterStats.textTranslated += stats.textTranslated;
					byChapter.set(chapterId, chapterStats);
				} catch (error) {
					console.warn(
						`[RealDataLoader] Skipping translation stats for ${file}:`,
						error,
					);
				}
			}
		}

		this.translationStatsCache = { overall, byChapter, byQuest };
		return this.translationStatsCache;
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
		const stats = this.getTranslationStats().overall;
		return {
			totalLines: stats.total,
			translatedLines: stats.translated,
			percentage: this.getTextPercentage(stats),
		};
	}

	public search(
		query: string,
		options: GlobalSearchOptions = {},
	): GlobalSearchResult[] {
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
					.all(...params, limit) as Array<Record<string, unknown>>;
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
						chapterTitle: String(
							row.chapter_name || `Chapter ${row.chapter_id}`,
						),
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

		return results;
	}

	public invalidateTranslationStats() {
		this.translationStatsCache = null;
		this.loadedChapters = null;
		this.loadedCategories = null;
		this.questDetailCache.clear();
		this.categoryCache.clear();
		if (this.db) {
			this.db.close();
			this.db = null;
			try {
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
		return fs.existsSync(QUESTS_DATA_DIR);
	}

	constructor() {
		if (fs.existsSync(INDEX_DB_FILE)) {
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
	}

	public getChapters(): Chapter[] | null {
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
	}): QuestSummary[] | null {
		const chapterId = opts?.chapterId;
		const search = opts?.search?.trim();
		const type = opts?.type;
		const sort = opts?.sort || "id_asc";

		const targetChNum = chapterId
			? parseInt(chapterId.replace("ch_", "").replace("ch", ""), 10)
			: null;

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
					if (!isNaN(Number(search))) {
						conditions.push("(qid = ? OR quest_name LIKE ?)");
						params.push(Number(search), `%$search%`);
					} else {
						conditions.push("quest_name LIKE ?");
						params.push(`%${search}%`);
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

				if (targetChNum === null && !search && (!type || type === "all")) {
					sql += " LIMIT 100";
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
						rawQuestType: r.quest_type !== undefined ? r.quest_type : 1,
						totalLines: r.total_lines || 0,
						translatedLines: {
							id:
								this.getTranslationStats().byQuest.get(String(r.qid))
									?.textTranslated ?? 0,
							zh: r.total_lines || 0,
							ja: r.total_lines || 0,
						},
						translatedTextTotal:
							this.getTranslationStats().byQuest.get(String(r.qid))
								?.textTotal ??
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

		// Fallback path: JSON directory scan
		if (!fs.existsSync(QUESTS_JSON_DIR)) return null;

		try {
			const files = fs
				.readdirSync(QUESTS_JSON_DIR)
				.filter((f) => f.endsWith(".json"));
			const summaries: QuestSummary[] = [];

			for (const file of files) {
				const filePath = path.join(QUESTS_JSON_DIR, file);
				try {
					const raw = fs.readFileSync(filePath, "utf-8");
					const questData = JSON.parse(raw);

					const qid = String(questData.quest_id || file.replace(".json", ""));
					const questChNum =
						questData.chapter_id !== undefined
							? Number(questData.chapter_id)
							: 0;

					if (targetChNum !== null && questChNum !== targetChNum) {
						continue;
					}

					let lineCount = questData.total_lines || 0;
					if (!lineCount) {
						if (Array.isArray(questData.all_lines))
							lineCount = questData.all_lines.length;
						else if (Array.isArray(questData.dialogue))
							lineCount = questData.dialogue.length;
						else if (Array.isArray(questData.flows)) {
							lineCount = questData.flows.reduce(
								(acc: number, f: any) =>
									acc + (f.dialogue ? f.dialogue.length : 0),
								0,
							);
						}
					}

					const rawQType =
						questData.quest_type !== undefined
							? questData.quest_type
							: questChNum === 0
								? 2
								: 1;

					if (type && type !== "all") {
						if (type === "main" && rawQType !== 1) continue;
						if (type === "side" && rawQType === 1) continue;
						if (!isNaN(Number(type)) && rawQType !== Number(type)) continue;
					}

					if (search) {
						const qName = (questData.quest_name || "").toLowerCase();
						if (
							!qName.includes(search.toLowerCase()) &&
							!qid.includes(search)
						) {
							continue;
						}
					}

					const questStats = this.getTranslationStats().byQuest.get(qid);
					const translatedCount = questStats?.textTranslated ?? 0;
					const summary: QuestSummary = {
						id: qid,
						chapterId: `ch_${questChNum}`,
						chapterTitle: questData.chapter_name || `Chapter ${questChNum}`,
						title: {
							en: questData.quest_name || `Quest ${qid}`,
							id: questData.quest_name || `Quest ${qid}`,
							"zh-Hans": questData.quest_name || `Quest ${qid}`,
							ja: questData.quest_name || `Quest ${qid}`,
						},
						type: rawQType === 1 ? "main" : "side",
						rawQuestType: rawQType,
						totalLines: lineCount,
						translatedLines: {
							id: translatedCount,
							zh: lineCount,
							ja: lineCount,
						},
						translatedTextTotal: questStats?.textTotal ?? lineCount,
						updatedAt: new Date().toISOString(),
					};

					summaries.push(summary);

					if (
						targetChNum === null &&
						!search &&
						(!type || type === "all") &&
						summaries.length >= 100
					) {
						break;
					}
				} catch (error) {
					console.warn(`[RealDataLoader] Skipping quest file ${file}:`, error);
				}
			}

			// Sort fallback
			summaries.sort((a, b) => {
				if (sort === "id_desc") return Number(b.id) - Number(a.id);
				if (sort === "name_asc")
					return (a.title.en || "").localeCompare(b.title.en || "");
				if (sort === "name_desc")
					return (b.title.en || "").localeCompare(a.title.en || "");
				if (sort === "lines_desc") return b.totalLines - a.totalLines;
				if (sort === "lines_asc") return a.totalLines - b.totalLines;
				return Number(a.id) - Number(b.id);
			});

			return summaries;
		} catch (e) {
			console.error("[RealDataLoader] Error scanning quests:", e);
		}
		return null;
	}

	private questFileMap: Map<string, string> | null = null;

	private getQuestFileMap(): Map<string, string> {
		if (this.questFileMap) return this.questFileMap;

		const map = new Map<string, string>();
		if (!fs.existsSync(QUESTS_JSON_DIR)) {
			this.questFileMap = map;
			return map;
		}

		const walk = (dir: string) => {
			let entries: fs.Dirent[] = [];
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(fullPath);
				} else if (entry.name === "dialogue.json") {
					const dirName = path.basename(dir);
					const match = dirName.match(/^(\d+)_/);
					if (match) {
						map.set(match[1], fullPath);
					}
					try {
						const raw = fs.readFileSync(fullPath, "utf-8");
						const data = JSON.parse(raw);
						if (data.quest_id !== undefined) {
							map.set(String(data.quest_id), fullPath);
						}
					} catch {
						// Ignore JSON parse errors
					}
				}
			}
		};

		walk(QUESTS_JSON_DIR);
		this.questFileMap = map;
		return map;
	}

	public getQuestDetail(id: string): QuestDetail | null {
		if (this.questDetailCache.has(id)) {
			return this.questDetailCache.get(id)!;
		}

		const map = this.getQuestFileMap();
		const filePath =
			map.get(id) || path.join(QUESTS_JSON_DIR, `${id}.json`);
		if (!filePath || !fs.existsSync(filePath)) {
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
				chapterId: `ch_${data.chapter_id !== undefined ? data.chapter_id : 1}`,
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

	public getCategories(): TextCategory[] | null {
		if (this.loadedCategories) return this.loadedCategories;

		if (!fs.existsSync(CATEGORIES_JSON_DIR)) return null;

		try {
			const categories: TextCategory[] = [];

			for (const file of listCategoryFiles()) {
				const catName = file.name;
				const fileStats = fs.statSync(file.filePath);
				const rawObj = readCategoryDocument(file) || {};

				const totalItems = Object.keys(rawObj).length;
				const translatedItems = Object.values(rawObj).filter((item: any) =>
					[item?.id, item?.text_id, item?.mt].some((value) =>
						typeof value === "string"
							? value.trim().length > 0
							: Boolean(value),
					),
				).length;
				const progressPercentage =
					totalItems > 0
						? Math.round((translatedItems / totalItems) * 10000) / 100
						: 0;

				categories.push({
					id: `cat_${catName.toLowerCase()}`,
					name: catName,
					description: `Kategori teks resmi game: ${catName} (${Math.round(fileStats.size / 1024)} KB)`,
					totalItems,
					translatedItems,
					progressPercentage,
				});
			}

			// Sort categories alphabetically
			categories.sort((a, b) => a.name.localeCompare(b.name));

			this.loadedCategories = categories;
			return categories;
		} catch (e) {
			console.error("[RealDataLoader] Error reading categories:", e);
		}
		return null;
	}

	public getCategoryDetail(
		categoryName: string,
		opts?: { q?: string; page?: number; limit?: number },
	): CategoryDetailResult | null {
		const file = resolveCategoryFile(categoryName);
		if (!file) return null;
		const cleanName = file.name;

		try {
			let rawObj = this.categoryCache.get(cleanName);
			if (!rawObj) {
				rawObj = readCategoryDocument(file);
				if (!rawObj) return null;
				this.categoryCache.set(cleanName, rawObj);
			}

			const q = (opts?.q || "").toLowerCase().trim();
			const page = Math.max(1, opts?.page || 1);
			const limit = Math.max(1, Math.min(200, opts?.limit || 50));

			const allKeys = Object.keys(rawObj);
			const totalItems = allKeys.length;

			const filteredKeys = allKeys.filter((key) => {
				if (!q) return true;
				const item = rawObj[key];
				const textEn = (item.en || "").toLowerCase();
				const textZh = (item["zh-Hans"] || item.zh || "").toLowerCase();
				const textJa = (item.ja || "").toLowerCase();
				const textId = (item.id || item.text_id || "").toLowerCase();
				return (
					key.toLowerCase().includes(q) ||
					textEn.includes(q) ||
					textZh.includes(q) ||
					textJa.includes(q) ||
					textId.includes(q)
				);
			});

			const filteredItems = filteredKeys.length;
			const totalPages = Math.ceil(filteredItems / limit) || 1;
			const validPage = Math.min(page, totalPages);

			const startIndex = (validPage - 1) * limit;
			const pageKeys = filteredKeys.slice(startIndex, startIndex + limit);

			const items = pageKeys.map((key) => {
				const item = rawObj[key];
				const en = item.en || "";
				const zh = item["zh-Hans"] || item.zh || "";
				const ja = item.ja || "";
				const idText = item.id || item.text_id || item.mt || "";

				return {
					key,
					text: {
						en,
						id: idText,
						"zh-Hans": zh,
						ja,
					},
				};
			});

			const translatedCount = allKeys.filter((k) => {
				const item = rawObj[k];
				return !!(item.id || item.text_id || item.mt);
			}).length;
			const progressPercentage =
				totalItems > 0
					? Math.round((translatedCount / totalItems) * 10000) / 100
					: 0;

			return {
				name: cleanName,
				totalItems,
				filteredItems,
				translatedItems: translatedCount,
				translatedTextTotal: totalItems,
				progressPercentage,
				page: validPage,
				limit,
				totalPages,
				items,
			};
		} catch (e) {
			console.error(
				`[RealDataLoader] Error reading category detail for ${categoryName}:`,
				e,
			);
		}

		return null;
	}
}

export const realDataLoader = new RealDataLoader();
