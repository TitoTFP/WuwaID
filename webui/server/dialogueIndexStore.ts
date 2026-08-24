import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT } from "./categoryStore.js";

type JsonRecord = Record<string, unknown>;

const QUESTS_JSON_DIR = path.join(REPO_ROOT, "data/quests/quests");

export function readDialogueRows(document: JsonRecord): JsonRecord[] {
	if (Array.isArray(document.flows)) {
		const rows = document.flows.flatMap((flow: JsonRecord) =>
			Array.isArray(flow.dialogue) ? flow.dialogue : [],
		) as JsonRecord[];
		if (rows.length > 0) return rows;
	}
	if (Array.isArray(document.all_lines)) return document.all_lines;
	if (Array.isArray(document.dialogue)) return document.dialogue;
	return [];
}

type DialogueKeyEntry = {
	item: JsonRecord;
	lineId: number;
	isOption: boolean;
	parentSpeaker: string;
};

function readDialogueKeyEntries(document: JsonRecord): DialogueKeyEntry[] {
	const entries: DialogueKeyEntry[] = [];
	for (const [index, row] of readDialogueRows(document).entries()) {
		const lineId = Number(row.id ?? index + 1);
		const parentSpeaker = String(row.speaker_en ?? "");
		entries.push({ item: row, lineId, isOption: false, parentSpeaker });
		if (!Array.isArray(row.options)) continue;
		for (const option of row.options) {
			if (!option || typeof option !== "object" || Array.isArray(option)) continue;
			entries.push({
				item: option as JsonRecord,
				lineId,
				isOption: true,
				parentSpeaker,
			});
		}
	}
	return entries;
}

type QuestPageRow = {
	lineNo: number;
	lineId: string;
	lineType: string;
	speakerId: string;
	speakerNameId: string;
	speakerEn: string;
	speakerZh: string;
	speakerJa: string;
	textEn: string;
	textZh: string;
	textJa: string;
	textId: string;
	optionsJson: string;
	speakerSearch: string;
	searchText: string;
};

function readValue(row: JsonRecord, ...keys: string[]): string {
	for (const key of keys) {
		const value = row[key];
		if (typeof value === "string" && value.length > 0) return value;
		if (typeof value === "number") return String(value);
	}
	return "";
}

function exportSpeakerName(item: JsonRecord, isOption: boolean): string {
	return (
		readValue(
			item,
			"speaker_en",
			"speaker",
			"speaker_zh-Hans",
			"speaker_ja",
			"entity",
			"character",
		) || (isOption ? "Player" : "")
	);
}

function readQuestPageRow(row: JsonRecord, index: number): QuestPageRow {
	const lineNo = index + 1;
	const speakerFallback =
		readValue(row, "speaker_zh-Hans", "speaker_zh", "speaker") || "N/A";
	const speakerEn = readValue(row, "speaker_en") || speakerFallback;
	const speakerZh = speakerFallback;
	const speakerJa = readValue(row, "speaker_ja") || speakerFallback;
	const rawSpeakerId = readValue(row, "speaker_id");
	const speakerId =
		rawSpeakerId || readValue(row, "speaker_zh-Hans") || `speaker_${lineNo - 1}`;
	const speakerNameId = rawSpeakerId || speakerEn;
	const textZh = readValue(row, "text_zh-Hans", "text_zh");
	const textEn = readValue(row, "text_en") || textZh;
	const textId = readValue(row, "text_id", "text_id_mt");
	const textJa = readValue(row, "text_ja") || textZh;
	const options = Array.isArray(row.options)
		? row.options.filter((value): value is JsonRecord =>
				Boolean(value && typeof value === "object" && !Array.isArray(value)),
			)
		: [];
	const optionSearchText = options.flatMap((option) => {
		const optionZh = readValue(option, "text_zh-Hans", "text_zh");
		return [
			readValue(option, "text_en") || optionZh,
			optionZh,
			readValue(option, "text_ja"),
			readValue(option, "text_id", "text_id_mt"),
		];
	});
	return {
		lineNo,
		lineId: readValue(row, "id") || String(lineNo),
		lineType: readValue(row, "type"),
		speakerId,
		speakerEn,
		speakerZh,
		speakerJa,
		textEn,
		textZh,
		textJa,
		textId,
		optionsJson: Array.isArray(row.options) ? JSON.stringify(options) : "",
		speakerNameId,
		speakerSearch: [speakerId, speakerNameId, speakerEn, speakerZh, speakerJa]
			.filter(Boolean)
			.join("\n")
			.toLocaleLowerCase(),
		searchText: [
			speakerEn,
			speakerZh,
			speakerJa,
			textEn,
			textZh,
			textJa,
			textId,
			...optionSearchText,
		]
			.filter(Boolean)
			.join("\n")
			.toLocaleLowerCase(),
	};
}

export function listQuestJsonFiles(questsRoot = QUESTS_JSON_DIR): string[] {
	if (!fs.existsSync(questsRoot)) return [];
	const directFiles = fs
		.readdirSync(questsRoot, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => path.join(questsRoot, entry.name));
	if (directFiles.length > 0) return directFiles.sort();

	const files: string[] = [];
	const walk = (directory: string) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const filePath = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(filePath);
			else if (entry.isFile() && entry.name === "dialogue.json")
				files.push(filePath);
		}
	};
	walk(questsRoot);
	return files.sort();
}

export function rebuildDialogueIndex(
	indexPath: string,
	questsRoot = QUESTS_JSON_DIR,
): number {
	if (!fs.existsSync(indexPath)) return 0;
	const database = new DatabaseSync(indexPath, { timeout: 5000 });
	try {
		database.exec("BEGIN");
		database.exec(`
			DROP TABLE IF EXISTS dialogue_idx;
			DROP TABLE IF EXISTS dialogue_key_idx;
			DROP TABLE IF EXISTS quest_page_idx;
			CREATE TABLE quest_page_idx(
				qid INTEGER NOT NULL,
				line_no INTEGER NOT NULL,
				line_id TEXT NOT NULL,
				line_type TEXT NOT NULL,
				speaker_id TEXT NOT NULL,
				speaker_name_id TEXT NOT NULL,
				speaker_en TEXT NOT NULL,
				speaker_zh TEXT NOT NULL,
				speaker_ja TEXT NOT NULL,
				text_en TEXT NOT NULL,
				text_zh TEXT NOT NULL,
				text_ja TEXT NOT NULL,
				text_id TEXT NOT NULL,
				options_json TEXT NOT NULL,
				speaker_search TEXT NOT NULL,
				search_text TEXT NOT NULL,
				PRIMARY KEY (qid, line_no)
			) WITHOUT ROWID;
			CREATE VIRTUAL TABLE dialogue_idx USING fts5(
				qid UNINDEXED,
				line_id UNINDEXED,
				side UNINDEXED,
				chapter_id UNINDEXED,
				chapter_name,
				quest_name,
				quest_type UNINDEXED,
				line_type UNINDEXED,
				has_options UNINDEXED,
				speaker_en,
				text_en,
				text_zh,
				text_ja,
				text_id,
				tokenize = 'unicode61 remove_diacritics 2'
			);
			CREATE VIRTUAL TABLE dialogue_key_idx USING fts5(
				qid UNINDEXED,
				line_id UNINDEXED,
				is_option UNINDEXED,
				text_key,
				quest_name UNINDEXED,
				chapter_name UNINDEXED,
				speaker_en UNINDEXED,
				export_name UNINDEXED,
				text_en UNINDEXED,
				text_zh UNINDEXED,
				text_ja UNINDEXED,
				text_id UNINDEXED,
				tokenize = 'trigram'
			);
		`);
		const insertLine = database.prepare(`
			INSERT INTO dialogue_idx
			(qid, line_id, side, chapter_id, chapter_name, quest_name, quest_type,
			 line_type, has_options, speaker_en, text_en, text_zh, text_ja, text_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const insertKey = database.prepare(`
			INSERT INTO dialogue_key_idx
			(qid, line_id, is_option, text_key, quest_name, chapter_name, speaker_en,
			 export_name, text_en, text_zh, text_ja, text_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const insertPage = database.prepare(`
			INSERT INTO quest_page_idx
			(qid, line_no, line_id, line_type, speaker_id, speaker_name_id, speaker_en,
			 speaker_zh, speaker_ja, text_en, text_zh, text_ja, text_id, options_json,
			 speaker_search, search_text)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		let indexedRows = 0;
		try {
			for (const filePath of listQuestJsonFiles(questsRoot)) {
				try {
					const document = JSON.parse(
						fs.readFileSync(filePath, "utf-8"),
					) as JsonRecord;
					const questId = String(document.quest_id ?? "");
					if (!questId) continue;
					const chapterId = Number(document.chapter_id ?? 0);
					for (const [index, row] of readDialogueRows(document).entries()) {
						const pageRow = readQuestPageRow(row, index);
						insertPage.run(
							Number(questId),
							pageRow.lineNo,
							pageRow.lineId,
							pageRow.lineType,
							pageRow.speakerId,
							pageRow.speakerNameId,
							pageRow.speakerEn,
							pageRow.speakerZh,
							pageRow.speakerJa,
							pageRow.textEn,
							pageRow.textZh,
							pageRow.textJa,
							pageRow.textId,
							pageRow.optionsJson,
							pageRow.speakerSearch,
							pageRow.searchText,
						);
						insertLine.run(
							Number(questId),
							Number(row.id ?? index + 1),
							chapterId === 0 ? 1 : 0,
							chapterId,
							String(document.chapter_name ?? ""),
							String(document.quest_name ?? `Quest ${questId}`),
							Number(document.quest_type ?? 0),
							String(row.type ?? ""),
							Array.isArray(row.options) ? 1 : 0,
							String(row.speaker_en ?? row.speaker ?? ""),
							String(row.text_en ?? ""),
							String(row["text_zh-Hans"] ?? row.text_zh ?? ""),
							String(row.text_ja ?? ""),
							String(row.text_id ?? row.text_id_mt ?? ""),
						);
						indexedRows++;
					}
					for (const entry of readDialogueKeyEntries(document)) {
						const textKey = String(entry.item.text_key ?? "");
						if (!textKey) continue;
						insertKey.run(
							Number(questId),
							entry.lineId,
							entry.isOption ? 1 : 0,
							textKey,
							String(document.quest_name ?? `Quest ${questId}`),
							String(document.chapter_name ?? ""),
							String(
								entry.item.speaker_en ??
									entry.parentSpeaker ??
									(entry.isOption ? "Player" : "Narrator"),
							),
							exportSpeakerName(entry.item, entry.isOption),
							readValue(entry.item, "text_en", "text_zh-Hans", "text_zh"),
							readValue(entry.item, "text_zh-Hans", "text_zh"),
							readValue(entry.item, "text_ja"),
							readValue(entry.item, "text_id", "text_id_mt"),
						);
					}
				} catch {
					// Keep valid source rows when an individual document is malformed.
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

export function refreshDialogueIndex(
	indexPath: string,
	questIds: readonly string[],
	questsRoot = QUESTS_JSON_DIR,
): number {
	if (!questIds.length || !fs.existsSync(indexPath)) return 0;
	const database = new DatabaseSync(indexPath, { timeout: 5000 });
	try {
		const hasDialogueIndex = database
			.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?")
			.get("table", "dialogue_idx");
		const hasDialogueKeyIndex = database
			.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?")
			.get("table", "dialogue_key_idx");
		const hasQuestPageIndex = database
			.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?")
			.get("table", "quest_page_idx");
		const dialogueKeyColumns = database
			.prepare('PRAGMA table_info("dialogue_key_idx")')
			.all() as Array<{ name?: string }>;
		const hasExportName = dialogueKeyColumns.some(
			(column) => column.name === "export_name",
		);
		if (!hasDialogueIndex || !hasDialogueKeyIndex || !hasQuestPageIndex) return 0;
		if (!hasExportName) {
			database.close();
			return rebuildDialogueIndex(indexPath, questsRoot);
		}

		const deleteQuest = database.prepare(
			"DELETE FROM dialogue_idx WHERE qid = ?",
		);
		const deleteQuestKeys = database.prepare(
			"DELETE FROM dialogue_key_idx WHERE qid = ?",
		);
		const deleteQuestPages = database.prepare(
			"DELETE FROM quest_page_idx WHERE qid = ?",
		);
		const insertLine = database.prepare(`
			INSERT INTO dialogue_idx
			(qid, line_id, side, chapter_id, chapter_name, quest_name, quest_type,
			 line_type, has_options, speaker_en, text_en, text_zh, text_ja, text_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const insertKey = database.prepare(`
			INSERT INTO dialogue_key_idx
			(qid, line_id, is_option, text_key, quest_name, chapter_name, speaker_en,
			 export_name, text_en, text_zh, text_ja, text_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const insertPage = database.prepare(`
			INSERT INTO quest_page_idx
			(qid, line_no, line_id, line_type, speaker_id, speaker_name_id, speaker_en,
			 speaker_zh, speaker_ja, text_en, text_zh, text_ja, text_id, options_json,
			 speaker_search, search_text)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const wantedIds = new Set(questIds);
		const documents = new Map<string, JsonRecord>();
		for (const filePath of listQuestJsonFiles(questsRoot)) {
			try {
				const document = JSON.parse(
					fs.readFileSync(filePath, "utf-8"),
				) as JsonRecord;
				const questId = String(document.quest_id ?? "");
				if (wantedIds.has(questId)) documents.set(questId, document);
			} catch {
				// The caller reports source errors; leave the existing index row intact.
			}
		}

		let indexedRows = 0;
		database.exec("BEGIN");
		try {
			for (const questId of wantedIds) {
				const document = documents.get(questId);
				if (!document) continue;
				deleteQuest.run(Number(questId));
				deleteQuestKeys.run(Number(questId));
				deleteQuestPages.run(Number(questId));
				const chapterId = Number(document.chapter_id ?? 0);
				for (const [index, row] of readDialogueRows(document).entries()) {
					const pageRow = readQuestPageRow(row, index);
					insertPage.run(
						Number(document.quest_id ?? questId),
						pageRow.lineNo,
						pageRow.lineId,
						pageRow.lineType,
						pageRow.speakerId,
						pageRow.speakerNameId,
						pageRow.speakerEn,
						pageRow.speakerZh,
						pageRow.speakerJa,
						pageRow.textEn,
						pageRow.textZh,
						pageRow.textJa,
						pageRow.textId,
						pageRow.optionsJson,
						pageRow.speakerSearch,
						pageRow.searchText,
					);
					insertLine.run(
						Number(document.quest_id ?? questId),
						Number(row.id ?? index + 1),
						chapterId === 0 ? 1 : 0,
						chapterId,
						String(document.chapter_name ?? ""),
						String(document.quest_name ?? `Quest ${questId}`),
						Number(document.quest_type ?? 0),
						String(row.type ?? ""),
						Array.isArray(row.options) ? 1 : 0,
						String(row.speaker_en ?? ""),
						String(row.text_en ?? ""),
						String(row["text_zh-Hans"] ?? row.text_zh ?? ""),
						String(row.text_ja ?? ""),
						String(row.text_id ?? row.text_id_mt ?? ""),
					);
					indexedRows++;
				}
				for (const entry of readDialogueKeyEntries(document)) {
					const textKey = String(entry.item.text_key ?? "");
					if (!textKey) continue;
					insertKey.run(
						Number(document.quest_id ?? questId),
						entry.lineId,
						entry.isOption ? 1 : 0,
						textKey,
						String(document.quest_name ?? `Quest ${questId}`),
						String(document.chapter_name ?? ""),
						String(
							entry.item.speaker_en ??
								entry.parentSpeaker ??
								(entry.isOption ? "Player" : "Narrator"),
						),
						exportSpeakerName(entry.item, entry.isOption),
						readValue(entry.item, "text_en", "text_zh-Hans", "text_zh"),
						readValue(entry.item, "text_zh-Hans", "text_zh"),
						readValue(entry.item, "text_ja"),
						readValue(entry.item, "text_id", "text_id_mt"),
					);
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
