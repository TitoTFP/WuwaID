import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	listQuestJsonFiles,
	rebuildDialogueIndex,
	readDialogueRows,
} from "./dialogueIndexStore.js";
import {
	CATEGORIES_JSON_DIR,
	REPO_ROOT,
	rebuildCategoryIndex,
} from "./categoryStore.js";
import { ensureTranslationStatsTable } from "./translationStatsStore.js";

export interface QuestSourceEntry {
	qid: string;
	filePath: string;
}

function tableExists(database: DatabaseSync, name: string): boolean {
	return Boolean(
		database
			.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?")
			.get("table", name),
	);
}

function tableHasColumns(
	indexPath: string,
	table: string,
	columns: readonly string[],
): boolean {
	const database = new DatabaseSync(indexPath, { readOnly: true });
	try {
		if (!tableExists(database, table)) return false;
		const escapedTable = table.replaceAll('"', '""');
		const rows = database
			.prepare(`PRAGMA table_info("${escapedTable}")`)
			.all() as Array<{ name?: string }>;
		const available = new Set(rows.map((row) => row.name));
		return columns.every((column) => available.has(column));
	} finally {
		database.close();
	}
}

function readQuestIdFromHeader(filePath: string): string | null {
	const descriptor = fs.openSync(filePath, "r");
	try {
		const bytes = Buffer.alloc(128 * 1024);
		const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
		const header = bytes.subarray(0, length).toString("utf8");
		const match = header.match(/"quest_id"\s*:\s*(?:"([^"]+)"|(\d+))/);
		return match?.[1] || match?.[2] || null;
	} finally {
		fs.closeSync(descriptor);
	}
}

function sourceEntriesFromFiles(
	filePaths: readonly string[],
): QuestSourceEntry[] {
	const entries = new Map<string, QuestSourceEntry>();
	for (const filePath of filePaths) {
		const parentName = path.basename(path.dirname(filePath));
		const qid =
			readQuestIdFromHeader(filePath) ||
			parentName.match(/^(\d+)(?:_|$)/)?.[1] ||
			path.basename(filePath).match(/^(\d+)\.json$/)?.[1];
		if (qid) entries.set(qid, { qid, filePath });
	}
	return [...entries.values()].sort((left, right) =>
		left.qid.localeCompare(right.qid, undefined, { numeric: true }),
	);
}

export function listQuestSourceEntries(): QuestSourceEntry[] {
	return sourceEntriesFromFiles(listQuestJsonFiles());
}

export function ensureQuestSourceIndex(indexPath: string): number {
	if (!fs.existsSync(indexPath)) return 0;
	const database = new DatabaseSync(indexPath, { timeout: 5000 });
	try {
		database.exec(`
			CREATE TABLE IF NOT EXISTS quest_sources(
				qid TEXT PRIMARY KEY,
				file TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS quest_sources_meta(
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
		`);
		const filePaths = listQuestJsonFiles();
		const signature = filePaths.join("\n");
		const existingMeta = database
			.prepare("SELECT value FROM quest_sources_meta WHERE key = ?")
			.get("paths") as { value?: string } | undefined;
		const existingCount = Number(
			(
				database.prepare("SELECT COUNT(*) AS count FROM quest_sources").get() as {
					count?: number;
				}
			)?.count || 0,
		);
		if (existingMeta?.value === signature && existingCount > 0)
			return existingCount;
		const entries = sourceEntriesFromFiles(filePaths);
		const insert = database.prepare(
			"INSERT INTO quest_sources (qid, file) VALUES (?, ?) ON CONFLICT(qid) DO UPDATE SET file = excluded.file",
		);
		database.exec("BEGIN");
		try {
			database.exec("DELETE FROM quest_sources");
			for (const entry of entries) insert.run(entry.qid, entry.filePath);
			database
				.prepare(
					"INSERT INTO quest_sources_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
				)
				.run("paths", signature);
			database.exec("COMMIT");
		} catch (error) {
			database.exec("ROLLBACK");
			throw error;
		}
		return entries.length;
	} finally {
		database.close();
	}
}

function isTranslated(value: unknown): boolean {
	return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

export function rebuildQuestSummaryIndex(indexPath: string): number {
	if (!fs.existsSync(indexPath)) return 0;
	const database = new DatabaseSync(indexPath, { timeout: 5000 });
	try {
		database.exec(`
			CREATE TABLE IF NOT EXISTS quests(
				qid INTEGER PRIMARY KEY,
				quest_name TEXT,
				quest_type INTEGER,
				side INTEGER,
				chapter_id INTEGER,
				chapter_name TEXT,
				ord INTEGER,
				total_lines INTEGER,
				translated_count INTEGER DEFAULT 0
			);
		`);
		const insert = database.prepare(`
			INSERT OR REPLACE INTO quests
			(qid, quest_name, quest_type, side, chapter_id, chapter_name, ord, total_lines, translated_count)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		let indexedRows = 0;
		database.exec("DELETE FROM quests");
		database.exec("BEGIN");
		try {
			for (const [ord, filePath] of listQuestJsonFiles().entries()) {
				try {
					const document = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
						string,
						unknown
					>;
					const qid = Number(document.quest_id);
					if (!Number.isInteger(qid)) continue;
					const rows = readDialogueRows(document);
					const chapterId = Number(document.chapter_id ?? 0);
					const questType = Number(document.quest_type ?? (chapterId === 0 ? 2 : 1));
					insert.run(
						qid,
						String(document.quest_name ?? `Quest ${qid}`),
						questType,
						chapterId === 0 ? 1 : 0,
						chapterId,
						String(document.chapter_name ?? `Chapter ${chapterId}`),
						ord,
						Number(document.total_lines ?? rows.length),
						rows.filter(
							(row) => isTranslated(row.text_id) || isTranslated(row.text_id_mt),
						).length,
					);
					indexedRows++;
				} catch {
					// Keep the index usable when an individual source document is invalid.
				}
			}
			database.exec("COMMIT");
			return indexedRows;
		} catch (error) {
			database.exec("ROLLBACK");
			throw error;
		}
	} finally {
		database.close();
	}
}

function indexNeedsRebuild(indexPath: string, table: string): boolean {
	const database = new DatabaseSync(indexPath, { readOnly: true });
	try {
		if (!tableExists(database, table)) return true;
		const row = database
			.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
			.get() as { count?: number };
		return Number(row?.count || 0) === 0;
	} finally {
		database.close();
	}
}

export function buildReaderIndex(
	indexPath: string,
	options: { force?: boolean } = {},
): {
	quests: number;
	dialogueRows: number;
	categoryRows: number;
	sourceRows: number;
} {
	fs.mkdirSync(path.dirname(indexPath), { recursive: true });
	if (options.force) {
		for (const suffix of ["", "-wal", "-shm"]) {
			fs.rmSync(`${indexPath}${suffix}`, { force: true });
		}
	}
	if (!fs.existsSync(indexPath)) {
		const database = new DatabaseSync(indexPath);
		database.close();
	}

	const quests = rebuildQuestSummaryIndex(indexPath);
	const dialogueRows = rebuildDialogueIndex(indexPath);
	const categoryRows = rebuildCategoryIndex(indexPath);
	ensureTranslationStatsTable(indexPath);
	const sourceRows = ensureQuestSourceIndex(indexPath);
	return { quests, dialogueRows, categoryRows, sourceRows };
}

export function ensureReaderIndex(indexPath: string): boolean {
	try {
		if (!fs.existsSync(indexPath)) {
			buildReaderIndex(indexPath);
			return true;
		}

		if (indexNeedsRebuild(indexPath, "quests"))
			rebuildQuestSummaryIndex(indexPath);
		if (
			indexNeedsRebuild(indexPath, "dialogue_idx") ||
			indexNeedsRebuild(indexPath, "dialogue_key_idx") ||
			indexNeedsRebuild(indexPath, "quest_page_idx") ||
			!tableHasColumns(indexPath, "dialogue_key_idx", ["export_name"])
		)
			rebuildDialogueIndex(indexPath);
		if (
			indexNeedsRebuild(indexPath, "categories") ||
			!tableHasColumns(indexPath, "category_text_idx", ["name"])
		)
			rebuildCategoryIndex(indexPath);
		ensureTranslationStatsTable(indexPath);
		ensureQuestSourceIndex(indexPath);
		return true;
	} catch (error) {
		console.error("[ReaderIndex] Failed provisioning read model:", error);
		return false;
	}
}

export function readerIndexPath(): string {
	return path.join(REPO_ROOT, "data/quests/index.db");
}

export function categoryIndexRoot(): string {
	return CATEGORIES_JSON_DIR;
}
