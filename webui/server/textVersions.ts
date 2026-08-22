import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT } from "./categoryStore.js";

export const VERSION_WORKING = "working";
export const VERSION_LANGUAGES = ["en", "zh-Hans", "ja"] as const;
export type VersionLanguage = (typeof VERSION_LANGUAGES)[number];
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

interface TextRow {
	text_id: string;
	en: string;
	zh_hans: string;
	ja: string;
	source_kind: "category" | "quest";
	source_ref: string;
	source_path: string;
	source_name: string;
}

interface WorkingDataset {
	rows: Map<string, TextRow>;
	stats: {
		rows: number;
		category_rows: number;
		quest_rows: number;
		category_files: number;
		quest_files: number;
	};
	dataset_hash: string;
}

interface StoredRow {
	content: string;
	source_kind: "category" | "quest";
	source_ref: string;
	source_path: string;
	name: string;
}

interface DiffResult {
	items: TextDiffItem[];
	summary: Record<TextDiffStatus, number>;
}

const DATA_DIR = path.join(REPO_ROOT, "data", "quests");
const CATEGORIES_DIR = path.join(DATA_DIR, "categories");
const QUESTS_DIR = path.join(DATA_DIR, "quests");
const HISTORY_PATH = path.join(REPO_ROOT, "data", "version_history.db");
const CATEGORIES_MANIFEST = path.join(DATA_DIR, "categories.json");
const CHAPTERS_FILE = path.join(DATA_DIR, "chapters.json");
const INDEX_DB_FILE = path.join(DATA_DIR, "index.db");

let cachedWorking: { signature: string; dataset: WorkingDataset } | null = null;
const savedRowsCache = new Map<string, Map<string, StoredRow>>();

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function normalize(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function sha256(value: string): string {
	return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function contentHash(value: string): string {
	return sha256(value);
}

function sanitizeFilename(value: unknown, maxLength = 80): string {
	let name = String(value || "");
	for (const character of '\\/\\:*?"<>|') {
		name = name.replaceAll(character, "_");
	}
	name = name.trim().replace(/^\.+|\.+$/g, "");
	return name.slice(0, maxLength) || "unnamed";
}

function listJsonFiles(root: string): string[] {
	if (!fs.existsSync(root)) return [];
	const files: string[] = [];
	const walk = (directory: string) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(fullPath);
			else if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
		}
	};
	walk(root);
	return files.sort((a, b) => a.localeCompare(b));
}

function readJson(filePath: string): Record<string, any> | null {
	try {
		const value: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, any>)
			: null;
	} catch (error) {
		console.warn(`[textVersions] Skipping invalid JSON ${filePath}:`, error);
		return null;
	}
}

function getDialogueRows(quest: Record<string, any>): any[] {
	if (Array.isArray(quest.all_lines)) return quest.all_lines;
	if (Array.isArray(quest.dialogue)) return quest.dialogue;
	if (Array.isArray(quest.flows)) {
		return quest.flows.flatMap((flow: any) =>
			Array.isArray(flow?.dialogue) ? flow.dialogue : [],
		);
	}
	return [];
}

function addRow(rows: Map<string, TextRow>, row: TextRow): void {
	if (!row.text_id) return;
	const previous = rows.get(row.text_id);
	if (!previous) {
		rows.set(row.text_id, row);
		return;
	}
	if (
		previous.en !== row.en ||
		previous.zh_hans !== row.zh_hans ||
		previous.ja !== row.ja
	) {
		throw new Error(
			`Conflicting content for ID ${JSON.stringify(row.text_id)}: ` +
			`${previous.source_kind}:${previous.source_ref} vs ${row.source_kind}:${row.source_ref}`,
		);
	}
}

function addCategoryRows(
	rows: Map<string, TextRow>,
	filePath: string,
	categoriesDir: string,
	categoryIds: Set<string>,
): void {
	const document = readJson(filePath);
	if (!document) return;
	const relativePath = path.relative(categoriesDir, filePath).split(path.sep).join("/");
	const sourcePath = `categories/${relativePath}`;
	const sourceRef = relativePath.replace(/\.json$/i, "");
	for (const [textId, value] of Object.entries(document)) {
		if (!value || typeof value !== "object") continue;
		const row: TextRow = {
			text_id: textId,
			en: normalize(value.en),
			zh_hans: normalize(value["zh-Hans"] ?? value.zh),
			ja: normalize(value.ja),
			source_kind: "category",
			source_ref: sourceRef,
			source_path: sourcePath,
			source_name: "",
		};
		addRow(rows, row);
		categoryIds.add(textId);
	}
}

function addQuestRows(
	rows: Map<string, TextRow>,
	filePath: string,
	questsDir: string,
	questIds: Set<string>,
): void {
	const quest = readJson(filePath);
	if (!quest) return;
	const relativePath = path.relative(questsDir, filePath).split(path.sep).join("/");
	const sourcePath = `quests/${relativePath}`;
	const sourceRef = String(quest.quest_id ?? path.basename(path.dirname(filePath)));

	const addQuestValue = (value: any) => {
		if (!value || typeof value !== "object") return;
		const textId = normalize(value.text_key);
		if (!textId) return;
		addRow(rows, {
			text_id: textId,
			en: normalize(value.text_en),
			zh_hans: normalize(value["text_zh-Hans"] ?? value.text_zh),
			ja: normalize(value.text_ja),
			source_kind: "quest",
			source_ref: sourceRef,
			source_path: sourcePath,
			source_name: normalize(value.speaker_en),
		});
		questIds.add(textId);
	};

	for (const line of getDialogueRows(quest)) {
		addQuestValue(line);
		if (Array.isArray(line?.options)) {
			for (const option of line.options) addQuestValue(option);
		}
	}
}

function dataSignature(): string {
	return [CATEGORIES_MANIFEST, CHAPTERS_FILE, INDEX_DB_FILE, CATEGORIES_DIR, QUESTS_DIR]
		.map((filePath) => {
			try {
				const stat = fs.statSync(filePath);
				return `${filePath}:${stat.mtimeMs}:${stat.size}`;
			} catch {
				return `${filePath}:missing`;
			}
		})
		.join("|");
}

function datasetHash(rows: Map<string, TextRow>): string {
	const digest = crypto.createHash("sha256");
	for (const textId of [...rows.keys()].sort()) {
		const row = rows.get(textId)!;
		const payload = JSON.stringify([textId, row.en, row.zh_hans, row.ja]);
		const encoded = Buffer.from(payload, "utf8");
		const length = Buffer.alloc(8);
		length.writeBigUInt64BE(BigInt(encoded.byteLength));
		digest.update(length);
		digest.update(encoded);
	}
	return digest.digest("hex");
}

function loadDataset(sourceRoot: string): WorkingDataset {
	const categoriesDir = path.join(sourceRoot, "categories");
	const questsDir = path.join(sourceRoot, "quests");
	const rows = new Map<string, TextRow>();
	const categoryIds = new Set<string>();
	const questIds = new Set<string>();
	const categoryFiles = listJsonFiles(categoriesDir).filter(
		(filePath) => !path.basename(filePath).startsWith("_"),
	);
	const directQuestFiles = fs.existsSync(questsDir)
		? fs.readdirSync(questsDir, { withFileTypes: true })
				.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
				.map((entry) => path.join(questsDir, entry.name))
		: [];
	const questFiles = directQuestFiles.length > 0
		? directQuestFiles.sort((a, b) => a.localeCompare(b))
		: listJsonFiles(questsDir).filter((filePath) => path.basename(filePath) === "dialogue.json");

	for (const filePath of categoryFiles) addCategoryRows(rows, filePath, categoriesDir, categoryIds);
	for (const filePath of questFiles) addQuestRows(rows, filePath, questsDir, questIds);

	const overlap = [...categoryIds].filter((textId) => questIds.has(textId));
	if (overlap.length > 0) {
		throw new Error(
			`Category and quest IDs overlap (${overlap.length} rows): ${overlap.slice(0, 5).join(", ")}`,
		);
	}

	return {
		rows,
		stats: {
			rows: rows.size,
			category_rows: categoryIds.size,
			quest_rows: questIds.size,
			category_files: categoryFiles.length,
			quest_files: questFiles.length,
		},
		dataset_hash: datasetHash(rows),
	};
}

function loadWorkingDataset(): WorkingDataset {
	return loadDataset(DATA_DIR);
}

function getWorkingDataset(): WorkingDataset {
	const signature = dataSignature();
	if (cachedWorking?.signature === signature) return cachedWorking.dataset;
	const dataset = loadWorkingDataset();
	cachedWorking = { signature, dataset };
	savedRowsCache.clear();
	console.log(
		`[textVersions] Loaded working dataset: ${dataset.stats.rows.toLocaleString()} rows ` +
		`(${dataset.stats.category_rows.toLocaleString()} category, ${dataset.stats.quest_rows.toLocaleString()} quest).`,
	);
	return dataset;
}

export function invalidateTextVersionWorkingSet(): void {
	cachedWorking = null;
	savedRowsCache.clear();
}

function connectHistory(): DatabaseSync {
	fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
	const database = new DatabaseSync(HISTORY_PATH, {
		enableForeignKeyConstraints: true,
		timeout: 5000,
	});
	database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
	database.exec(`
		CREATE TABLE IF NOT EXISTS versions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			tag TEXT NOT NULL UNIQUE,
			note TEXT,
			created_at TEXT NOT NULL,
			dataset_hash TEXT NOT NULL,
			row_count INTEGER NOT NULL,
			category_row_count INTEGER NOT NULL,
			quest_row_count INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS content_blobs (
			hash TEXT PRIMARY KEY,
			content TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS version_rows (
			version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE RESTRICT,
			text_id TEXT NOT NULL,
			en_hash TEXT NOT NULL REFERENCES content_blobs(hash),
			zh_hans_hash TEXT NOT NULL REFERENCES content_blobs(hash),
			ja_hash TEXT NOT NULL REFERENCES content_blobs(hash),
			source_kind TEXT NOT NULL,
			source_ref TEXT NOT NULL,
			source_path TEXT NOT NULL,
			source_name TEXT NOT NULL,
			PRIMARY KEY (version_id, text_id)
		) WITHOUT ROWID;
		CREATE INDEX IF NOT EXISTS idx_version_rows_text_id ON version_rows(text_id);
	`);
	return database;
}

function versionFromRecord(record: Record<string, unknown>): TextVersion {
	return {
		id: Number(record.id),
		tag: asString(record.tag),
		note: record.note === null ? null : asString(record.note),
		created_at: asString(record.created_at),
		dataset_hash: asString(record.dataset_hash),
		row_count: Number(record.row_count),
		category_row_count: Number(record.category_row_count),
		quest_row_count: Number(record.quest_row_count),
	};
}

export function listTextVersions(): TextVersion[] {
	const database = connectHistory();
	try {
		return (database.prepare("SELECT * FROM versions ORDER BY id DESC").all() as Record<string, unknown>[]).map(
			versionFromRecord,
		);
	} finally {
		database.close();
	}
}

function insertDatasetSnapshot(dataset: WorkingDataset, tag: string, note?: string | null): TextVersion {
	const cleanTag = tag.trim();
	if (!cleanTag) throw new Error("tag must not be empty");
	if (cleanTag === VERSION_WORKING) throw new Error("working is reserved");

	const database = connectHistory();
	try {
		if (database.prepare("SELECT 1 FROM versions WHERE tag = ?").get(cleanTag)) {
			throw new Error(`tag already exists and is immutable: ${cleanTag}`);
		}

		const createdAt = new Date().toISOString();
		let versionId = 0;
		database.exec("BEGIN IMMEDIATE");
		try {
			const inserted = database
				.prepare(
					`INSERT INTO versions
					 (tag, note, created_at, dataset_hash, row_count, category_row_count, quest_row_count)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					cleanTag,
					note?.trim() || null,
					createdAt,
					dataset.dataset_hash,
					dataset.stats.rows,
					dataset.stats.category_rows,
					dataset.stats.quest_rows,
				);
			versionId = Number(inserted.lastInsertRowid);
			const insertBlob = database.prepare(
				"INSERT OR IGNORE INTO content_blobs(hash, content) VALUES (?, ?)",
			);
			const insertRow = database.prepare(
				`INSERT INTO version_rows
				 (version_id, text_id, en_hash, zh_hans_hash, ja_hash, source_kind, source_ref, source_path, source_name)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			);

			for (const row of dataset.rows.values()) {
				const contents = [row.en, row.zh_hans, row.ja] as const;
				const hashes = contents.map(contentHash) as [string, string, string];
				for (let index = 0; index < contents.length; index++) {
					insertBlob.run(hashes[index], contents[index]);
				}
				insertRow.run(
					versionId,
					row.text_id,
					hashes[0],
					hashes[1],
					hashes[2],
					row.source_kind,
					row.source_ref,
					row.source_path,
					row.source_name,
				);
			}
			database.exec("COMMIT");
		} catch (error) {
			database.exec("ROLLBACK");
			throw error;
		}

		savedRowsCache.clear();
		const record = database.prepare("SELECT * FROM versions WHERE id = ?").get(versionId);
		if (!record) throw new Error(`created version could not be read: ${cleanTag}`);
		return versionFromRecord(record);
	} finally {
		database.close();
	}
}

export function createTextVersion(tag: string, note?: string | null): TextVersion {
	return insertDatasetSnapshot(getWorkingDataset(), tag, note);
}

export function createTextVersionFromSource(
	tag: string,
	note: string | null | undefined,
	sourceRoot: string,
): TextVersion {
	return insertDatasetSnapshot(loadDataset(path.resolve(sourceRoot)), tag, note);
}

function ensureTarget(database: DatabaseSync, tag: string): void {
	if (tag === VERSION_WORKING) return;
	if (!database.prepare("SELECT 1 FROM versions WHERE tag = ?").get(tag)) {
		throw new Error(`unknown version tag: ${tag}`);
	}
}

function savedRows(tag: string, language: VersionLanguage): Map<string, StoredRow> {
	const cacheKey = `${tag}:${language}`;
	const cached = savedRowsCache.get(cacheKey);
	if (cached) return cached;

	const hashColumn = {
		en: "en_hash",
		"zh-Hans": "zh_hans_hash",
		ja: "ja_hash",
	}[language];
	const database = connectHistory();
	try {
		const version = database.prepare("SELECT id FROM versions WHERE tag = ?").get(tag) as
			| Record<string, unknown>
			| undefined;
		if (!version) throw new Error(`unknown version tag: ${tag}`);
		const rows = new Map<string, StoredRow>();
		const query = database.prepare(`
			SELECT vr.text_id, cb.content, vr.source_kind, vr.source_ref, vr.source_path, vr.source_name
			FROM version_rows vr
			JOIN content_blobs cb ON cb.hash = vr.${hashColumn}
			WHERE vr.version_id = ?
		`);
		for (const record of query.all(Number(version.id)) as Record<string, unknown>[]) {
			rows.set(asString(record.text_id), {
				content: asString(record.content),
				source_kind: asString(record.source_kind) as "category" | "quest",
				source_ref: asString(record.source_ref),
				source_path: asString(record.source_path),
				name: asString(record.source_name),
			});
		}
		savedRowsCache.set(cacheKey, rows);
		return rows;
	} finally {
		database.close();
	}
}

function workingRows(language: VersionLanguage): Map<string, StoredRow> {
	const dataset = getWorkingDataset();
	const rows = new Map<string, StoredRow>();
	for (const row of dataset.rows.values()) {
		rows.set(row.text_id, {
			content: row[language === "zh-Hans" ? "zh_hans" : language],
			source_kind: row.source_kind,
			source_ref: row.source_ref,
			source_path: row.source_path,
			name: row.source_name,
		});
	}
	return rows;
}

function targetRows(database: DatabaseSync, tag: string, language: VersionLanguage): Map<string, StoredRow> {
	ensureTarget(database, tag);
	return tag === VERSION_WORKING ? workingRows(language) : savedRows(tag, language);
}

function diffRows(base: string, target: string, language: VersionLanguage): DiffResult {
	if (!VERSION_LANGUAGES.includes(language)) throw new Error(`unsupported language: ${language}`);
	if (!base || !target) throw new Error("base and target are required");
	if (base === target) throw new Error("base and target must be different");

	const database = connectHistory();
	try {
		const before = targetRows(database, base, language);
		const after = targetRows(database, target, language);
		const summary: Record<TextDiffStatus, number> = { added: 0, removed: 0, changed: 0 };
		const items: TextDiffItem[] = [];
		const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
		for (const textId of ids) {
			const oldRow = before.get(textId);
			const newRow = after.get(textId);
			let status: TextDiffStatus | null = null;
			if (!oldRow) status = "added";
			else if (!newRow) status = "removed";
			else if (oldRow.content !== newRow.content) status = "changed";
			if (!status) continue;
			summary[status]++;
			const source = newRow || oldRow!;
			items.push({
				status,
				text_id: textId,
				old_content: oldRow?.content ?? null,
				new_content: newRow?.content ?? null,
				source_kind: source.source_kind,
				source_ref: source.source_ref,
				source_path: source.source_path,
				name: source.name,
			});
		}
		return { items, summary };
	} finally {
		database.close();
	}
}

export function getTextVersionDiff(options: {
	base: string;
	target: string;
	language: VersionLanguage;
	status?: TextDiffStatus | "";
	query?: string;
	page?: number;
	pageSize?: number;
}) {
	const { items, summary } = diffRows(options.base, options.target, options.language);
	const allowed = new Set<TextDiffStatus>(["added", "removed", "changed"]);
	if (options.status && !allowed.has(options.status)) {
		throw new Error(`unsupported status: ${options.status}`);
	}
	const needle = (options.query || "").trim().toLocaleLowerCase();
	const filtered = items.filter((item) =>
		(!options.status || item.status === options.status) &&
		(!needle ||
			item.text_id.toLocaleLowerCase().includes(needle) ||
			(item.old_content || "").toLocaleLowerCase().includes(needle) ||
			(item.new_content || "").toLocaleLowerCase().includes(needle)),
	);
	const pageSize = Math.max(1, Math.min(500, Math.floor(options.pageSize || 100)));
	const page = Math.max(1, Math.floor(options.page || 1));
	const start = (page - 1) * pageSize;
	return {
		base: options.base,
		target: options.target,
		language: options.language,
		summary,
		total: filtered.length,
		page,
		page_size: pageSize,
		items: filtered.slice(start, start + pageSize),
	};
}

function fallbackSourcePath(kind: "category" | "quest", sourceRef: string): string {
	return kind === "category"
		? `categories/${sanitizeFilename(sourceRef)}.json`
		: `quests/ungrouped/${sanitizeFilename(sourceRef)}/dialogue.json`;
}

function safeDbPath(
	kind: "category" | "quest",
	sourceRef: string,
	sourcePath: string,
): string {
	const raw = (sourcePath || fallbackSourcePath(kind, sourceRef)).replaceAll("\\", "/");
	const normalized = path.posix.normalize(raw);
	const parts = normalized.split("/");
	const expected = kind === "category" ? "categories" : "quests";
	if (
		path.posix.isAbsolute(normalized) ||
		parts.includes("..") ||
		!parts.length ||
		parts[0] !== expected
	) {
		throw new Error(`unsafe source path for ${kind}:${sourceRef}: ${raw}`);
	}
	return normalized.replace(/\.json$/i, ".db");
}

export function getTextVersionGroups(options: {
	base: string;
	target: string;
	language: VersionLanguage;
}) {
	const { items, summary } = diffRows(options.base, options.target, options.language);
	const database = connectHistory();
	try {
		const before = targetRows(database, options.base, options.language);
		const beforeGroups = new Set([...before.values()].map((row) => `${row.source_kind}:${row.source_ref}`));
		const grouped = new Map<string, TextDiffGroup>();
		for (const item of items) {
			if (item.status !== "added" && item.status !== "changed") continue;
			const groupId = `${item.source_kind}:${item.source_ref}`;
			const group = grouped.get(groupId) || {
				group_id: groupId,
				source_kind: item.source_kind,
				source_ref: item.source_ref,
				db_path: safeDbPath(item.source_kind, item.source_ref, item.source_path),
				is_new_group: !beforeGroups.has(groupId),
				added: 0,
				changed: 0,
				total: 0,
			};
			group[item.status]++;
			group.total++;
			grouped.set(groupId, group);
		}
		const groups = [...grouped.values()].sort(
			(a, b) => b.total - a.total || a.source_kind.localeCompare(b.source_kind) || a.source_ref.localeCompare(b.source_ref),
		);
		const paths = new Map<string, string>();
		for (const group of groups) {
			const previous = paths.get(group.db_path);
			if (previous && previous !== group.group_id) {
				throw new Error(`group path collision: ${group.db_path} (${previous}, ${group.group_id})`);
			}
			paths.set(group.db_path, group.group_id);
		}
		return {
			base: options.base,
			target: options.target,
			language: options.language,
			summary,
			exportable_rows: groups.reduce((total, group) => total + group.total, 0),
			groups,
		};
	} finally {
		database.close();
	}
}

function csvCell(value: unknown): string {
	const text = String(value ?? "");
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportTextVersionCsv(base: string, target: string, language: VersionLanguage): string {
	const { items } = diffRows(base, target, language);
	const lines = [
		["status", "Id", "old_content", "new_content", "source_kind", "source_ref"].join(","),
	];
	for (const item of items) {
		lines.push(
			[
				item.status,
				item.text_id,
				item.old_content || "",
				item.new_content || "",
				item.source_kind,
				item.source_ref,
			].map(csvCell).join(","),
		);
	}
	return `${lines.join("\n")}\n`;
}

function writeSqliteExport(filePath: string, rows: TextDiffItem[]): void {
	fs.rmSync(filePath, { force: true });
	const database = new DatabaseSync(filePath);
	try {
		database.exec("CREATE TABLE MultiText (Id TEXT UNIQUE PRIMARY KEY NOT NULL, Name TEXT, Content TEXT)");
		const insert = database.prepare("INSERT INTO MultiText(Id, Name, Content) VALUES (?, ?, ?)");
		for (const row of rows) {
			if (row.status === "added" || row.status === "changed") {
				insert.run(row.text_id, row.name, row.new_content || "");
			}
		}
	} finally {
		database.close();
	}
}

export function exportTextVersionSqlite(base: string, target: string, language: VersionLanguage): Buffer {
	const { items } = diffRows(base, target, language);
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wuwaid-version-export-"));
	const filePath = path.join(directory, "text_diff.db");
	try {
		writeSqliteExport(filePath, items);
		return fs.readFileSync(filePath);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

export function exportStructuredTextDiff(options: {
	base: string;
	target: string;
	language: VersionLanguage;
	groupIds: string[];
}): { buffer: Buffer; filename: string } {
	const groupResult = getTextVersionGroups(options);
	const groupsById = new Map(groupResult.groups.map((group) => [group.group_id, group]));
	const selected = [...new Set(options.groupIds.filter(Boolean))];
	if (!selected.length) throw new Error("at least one diff group must be selected");
	const unknown = selected.filter((groupId) => !groupsById.has(groupId));
	if (unknown.length) throw new Error(`unknown diff groups: ${unknown.slice(0, 10).join(", ")}`);

	const { items } = diffRows(options.base, options.target, options.language);
	const selectedSet = new Set(selected);
	const rowsByGroup = new Map<string, TextDiffItem[]>();
	for (const groupId of selected) rowsByGroup.set(groupId, []);
	for (const item of items) {
		if (item.status !== "added" && item.status !== "changed") continue;
		const groupId = `${item.source_kind}:${item.source_ref}`;
		if (selectedSet.has(groupId)) rowsByGroup.get(groupId)!.push(item);
	}

	const createdAt = new Date().toISOString();
	const manifestGroups = selected.map((groupId) => groupsById.get(groupId)!);
	const manifest = {
		base: options.base,
		target: options.target,
		language: options.language,
		generated_at: createdAt,
		diff_summary: groupResult.summary,
		selected_group_count: manifestGroups.length,
		exported_row_count: [...rowsByGroup.values()].reduce((total, rows) => total + rows.length, 0),
		groups: manifestGroups,
	};

	const root = fs.mkdtempSync(path.join(os.tmpdir(), "wuwaid-structured-diff-"));
	const zipPath = `${root}.zip`;
	try {
		for (const group of manifestGroups) {
			const dbPath = path.join(root, ...group.db_path.split("/"));
			fs.mkdirSync(path.dirname(dbPath), { recursive: true });
			writeSqliteExport(dbPath, rowsByGroup.get(group.group_id) || []);
		}
		fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
		const manifestCsv = [
			["group_id", "source_kind", "source_ref", "db_path", "is_new_group", "added", "changed", "total"].join(","),
			...manifestGroups.map((group) =>
				[
					group.group_id,
					group.source_kind,
					group.source_ref,
					group.db_path,
					group.is_new_group,
					group.added,
					group.changed,
					group.total,
				].map(csvCell).join(","),
			),
		].join("\n") + "\n";
		fs.writeFileSync(path.join(root, "manifest.csv"), manifestCsv, "utf8");
		execFileSync("zip", ["-q", "-r", zipPath, "."], { cwd: root });
		return { buffer: fs.readFileSync(zipPath), filename: `wuwaid-${options.base}-to-${options.target}-${options.language}.zip` };
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(zipPath, { force: true });
	}
}

export { HISTORY_PATH as TEXT_VERSION_HISTORY_PATH };
