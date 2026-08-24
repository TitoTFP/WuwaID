import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT } from "./categoryStore.js";

const QUESTS_JSON_DIR = path.join(REPO_ROOT, "data/quests/quests");
const STATS_SOURCE = "json-exact-v1";
const STATS_SCHEMA = `
	CREATE TABLE IF NOT EXISTS translation_stats (
		qid INTEGER PRIMARY KEY,
		chapter_id INTEGER NOT NULL,
		total INTEGER NOT NULL,
		translated INTEGER NOT NULL,
		text_total INTEGER NOT NULL,
		text_translated INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS translation_stats_meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
`;

type JsonRecord = Record<string, unknown>;
type StatsRow = {
	qid: number;
	chapterId: number;
	total: number;
	translated: number;
	textTotal: number;
	textTranslated: number;
};

function listQuestJsonFiles(): string[] {
	if (!fs.existsSync(QUESTS_JSON_DIR)) return [];
	const files: string[] = [];
	const walk = (directory: string) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const filePath = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(filePath);
			else if (entry.isFile() && entry.name === "dialogue.json")
				files.push(filePath);
		}
	};
	walk(QUESTS_JSON_DIR);
	return files.sort();
}

function dialogueRows(document: JsonRecord): JsonRecord[] {
	if (Array.isArray(document.all_lines))
		return document.all_lines as JsonRecord[];
	if (Array.isArray(document.dialogue)) return document.dialogue as JsonRecord[];
	if (Array.isArray(document.flows)) {
		return document.flows.flatMap((flow) => {
			if (
				!flow ||
				typeof flow !== "object" ||
				!Array.isArray((flow as JsonRecord).dialogue)
			) {
				return [];
			}
			return (flow as JsonRecord).dialogue as JsonRecord[];
		});
	}
	return [];
}

function isTranslated(item: JsonRecord): boolean {
	return [item.text_id, item.text_id_mt].some((value) =>
		typeof value === "string" ? value.trim().length > 0 : Boolean(value),
	);
}

function statsForDocument(
	document: JsonRecord,
	fallbackId: string,
): StatsRow | null {
	const qidValue = document.quest_id ?? fallbackId;
	const qid = Number(qidValue);
	if (!Number.isInteger(qid)) return null;
	const rows = dialogueRows(document);
	const textItems = rows
		.flatMap((row) => [row, ...(Array.isArray(row.options) ? row.options : [])])
		.filter((item): item is JsonRecord =>
			Boolean(item && typeof item === "object" && item.text_key),
		);
	return {
		qid,
		chapterId: Number(document.chapter_id ?? 0),
		total: rows.length,
		translated: rows.filter(isTranslated).length,
		textTotal: textItems.length,
		textTranslated: textItems.filter(isTranslated).length,
	};
}

function loadStats(questIds?: ReadonlySet<string>): StatsRow[] {
	const rows = new Map<number, StatsRow>();
	for (const filePath of listQuestJsonFiles()) {
		try {
			const document = JSON.parse(
				fs.readFileSync(filePath, "utf-8"),
			) as JsonRecord;
			const rawId = String(document.quest_id ?? "");
			if (questIds && !questIds.has(rawId)) continue;
			const stats = statsForDocument(
				document,
				path.basename(path.dirname(filePath)),
			);
			if (stats) rows.set(stats.qid, stats);
		} catch {
			// Invalid source files are omitted just like the existing loader fallback.
		}
	}
	return [...rows.values()];
}

function hasStatsSource(database: DatabaseSync): boolean {
	try {
		const row = database
			.prepare("SELECT value FROM translation_stats_meta WHERE key = ?")
			.get("source") as { value?: string } | undefined;
		return row?.value === STATS_SOURCE;
	} catch {
		return false;
	}
}

function markStatsSource(database: DatabaseSync): void {
	database
		.prepare(
			"INSERT INTO translation_stats_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.run("source", STATS_SOURCE);
}

function insertRows(database: DatabaseSync, rows: readonly StatsRow[]): number {
	database.exec(STATS_SCHEMA);
	const insert = database.prepare(`
		INSERT INTO translation_stats
			(qid, chapter_id, total, translated, text_total, text_translated)
		VALUES (?, ?, ?, ?, ?, ?)
	`);
	database.exec("DELETE FROM translation_stats");
	database.exec("BEGIN");
	try {
		for (const row of rows) {
			insert.run(
				row.qid,
				row.chapterId,
				row.total,
				row.translated,
				row.textTotal,
				row.textTranslated,
			);
		}
		markStatsSource(database);
		database.exec("COMMIT");
		return rows.length;
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
}

function rebuildExact(database: DatabaseSync): number {
	return insertRows(database, loadStats());
}

export function ensureTranslationStatsTable(indexPath: string): number {
	if (!fs.existsSync(indexPath)) return 0;
	const database = new DatabaseSync(indexPath);
	try {
		database.exec(STATS_SCHEMA);
		if (!hasStatsSource(database)) return rebuildExact(database);
		return Number(
			(
				database
					.prepare("SELECT COUNT(*) AS count FROM translation_stats")
					.get() as { count?: number }
			)?.count || 0,
		);
	} finally {
		database.close();
	}
}

export function refreshTranslationStats(
	indexPath: string,
	questIds: readonly string[],
): number {
	if (!questIds.length || !fs.existsSync(indexPath)) return 0;
	const database = new DatabaseSync(indexPath, { timeout: 5000 });
	try {
		database.exec(STATS_SCHEMA);
		const wantedIds = new Set(questIds);
		if (!hasStatsSource(database)) return rebuildExact(database);
		const rows = loadStats(wantedIds);
		const deleteRow = database.prepare(
			"DELETE FROM translation_stats WHERE qid = ?",
		);
		const insertRow = database.prepare(`
			INSERT INTO translation_stats
				(qid, chapter_id, total, translated, text_total, text_translated)
			VALUES (?, ?, ?, ?, ?, ?)
		`);
		database.exec("BEGIN");
		try {
			for (const value of wantedIds) {
				const qid = Number(value);
				if (Number.isInteger(qid)) deleteRow.run(qid);
			}
			for (const row of rows) {
				insertRow.run(
					row.qid,
					row.chapterId,
					row.total,
					row.translated,
					row.textTotal,
					row.textTranslated,
				);
			}
			markStatsSource(database);
			database.exec("COMMIT");
			return rows.length;
		} catch (error) {
			database.exec("ROLLBACK");
			throw error;
		}
	} finally {
		database.close();
	}
}
