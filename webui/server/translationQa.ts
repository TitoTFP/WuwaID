import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import {
	REPO_ROOT,
	listCategoryFiles,
} from "./categoryStore.js";
import {
	inspectTranslation,
	TRANSLATION_QA_RULE_VERSION,
} from "../src/lib/translationQaRules.js";
import {
	findAttachmentEvidence,
	type TranslationQAAlignmentOccurrence,
	type TranslationQAUnitKind,
} from "./translationQaAlignment.js";
import type {
	TranslationQAAttachmentEvidence,
	TranslationQAContext,
	TranslationQAGlossaryMatch,
	TranslationQAIssue,
	TranslationQAItem,
	TranslationQAListResponse,
	TranslationQAReview,
	TranslationQASourceKind,
	TranslationQASummary,
	TranslationQAScanJob,
	TranslationQAStatus,
} from "../src/types/index.js";

const QA_SOURCE_ROOT = process.env.WUWAID_QA_SOURCE_ROOT || REPO_ROOT;
const QUESTS_DIR = path.join(QA_SOURCE_ROOT, "data/quests/quests");
const GLOSSARY_FILE = path.join(
	QA_SOURCE_ROOT,
	"data/glossary/glossary_draft_merged.json",
);
const QA_DATA_DIR = process.env.WUWAID_QA_STATE_DIR || path.join(REPO_ROOT, "data");
const QA_DB_FILE = path.join(QA_DATA_DIR, "translation_qa.db");
const QA_REVIEWS_FILE = path.join(QA_DATA_DIR, "translation_qa_reviews.json");
const QA_DB_TEMP_PREFIX = `${QA_DB_FILE}.tmp-`;
const MAX_CONTEXTS = 8;
const TRANSLATION_QA_SCANNER_VERSION = "10";
export const QA_EXPORT_DEFAULT_LIMIT = 5_000;
export const QA_EXPORT_MAX_ITEMS = 10_000;

interface GlossaryRule {
	term: string;
	translation: string;
	category?: string;
}

interface StoredReview {
	status: "review" | "approved";
	comment: string;
	reviewer: string;
	updatedAt: string;
	fingerprint: string;
}

interface RawOccurrence {
	id: string;
	key: string;
	lineNo?: number;
	lineId?: string;
	speaker?: string;
	sourceText: string;
	targetText: string;
	targetVariant?: string;
	previousText?: string;
	nextText?: string;
	targetVariants: string[];
	unitKind: TranslationQAUnitKind;
}

interface RawGroup {
	id: string;
	key: string;
	sourceKind: TranslationQASourceKind;
	sourceRef: string;
	sourcePath: string;
	questId?: string;
	questTitle?: string;
	chapterTitle?: string;
	occurrences: RawOccurrence[];
}

interface DataFile {
	filePath: string;
	relativePath: string;
	sourceKind: TranslationQASourceKind;
	sourceRef: string;
	questId?: string;
	questTitle?: string;
	chapterTitle?: string;
}

interface CachedScan {
	dataFingerprint: string;
	generatedAt: string;
}

export class TranslationQAScanRateLimitError extends Error {
	public readonly retryAfterSeconds: number;

	constructor(retryAfterSeconds: number) {
		super("QA scan baru dapat dijalankan lagi setelah cooldown selesai.");
		this.name = "TranslationQAScanRateLimitError";
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

export class TranslationQAScanInProgressError extends Error {
	public readonly retryAfterSeconds = 5;

	constructor(message = "QA scan sedang berjalan; snapshot terakhir belum tersedia.") {
		super(message);
		this.name = "TranslationQAScanInProgressError";
	}
}

const CURATED_GLOSSARY: GlossaryRule[] = [
	{ term: "Resonator", translation: "Resonator", category: "Lore" },
	{ term: "Tacet Discord", translation: "Tacet Discord", category: "Enemy" },
	{ term: "Midnight Rangers", translation: "Midnight Rangers", category: "Faction" },
	{ term: "Gorges of Spirits", translation: "Ngarai Roh", category: "Location" },
	{ term: "Huanglong", translation: "Huanglong", category: "Location" },
	{ term: "Sentinel Jue", translation: "Sentinel Jue", category: "Lore" },
	{ term: "Frequency", translation: "Frekuensi", category: "Tech" },
	{ term: "Sonata Effect", translation: "Efek Sonata", category: "Game System" },
	{ term: "Overclocking", translation: "Overclocking (Kelebihan Beban Frekuensi)", category: "Game System" },
];

function toRelativePath(filePath: string): string {
	return path.relative(QA_SOURCE_ROOT, filePath).split(path.sep).join("/");
}

function hash(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex");
}

function stableId(
	sourceKind: TranslationQASourceKind,
	sourceRef: string,
	key: string,
): string {
	return hash(`${sourceKind}\0${sourceRef}\0${key}`).slice(0, 24);
}

function textValue(value: unknown): string {
	return typeof value === "string" ? value : value == null ? "" : String(value);
}

function effectiveTarget(item: Record<string, unknown>, includeCategoryFields = false): string {
	return textValue(
		item.text_id ||
		item.text_id_mt ||
		(includeCategoryFields ? item.id || item.mt : ""),
	);
}

function targetVariants(item: Record<string, unknown>, includeId = false): string[] {
	return [
		item.text_id,
		item.text_id_mt,
		...(includeId ? [item.id, item.mt] : []),
	]
		.map(textValue)
		.filter((value) => value.trim());
}

function sourceText(item: Record<string, unknown>): string {
	return textValue(
		item.text_en || item.en || item["text_zh-Hans"] || item.zh || "",
	);
}

function speakerText(item: Record<string, unknown>, fallback: string): string {
	return textValue(
		item.speaker_en || item.speaker_id || item.speaker || fallback,
	).trim();
}

function walkFiles(dir: string, predicate: (name: string) => boolean): string[] {
	if (!fs.existsSync(dir)) return [];
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const filePath = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...walkFiles(filePath, predicate));
		else if (entry.isFile() && predicate(entry.name)) files.push(filePath);
	}
	return files.sort((a, b) => a.localeCompare(b));
}

function questFiles(): string[] {
	return walkFiles(QUESTS_DIR, (name) => name === "dialogue.json");
}

function categoryFiles(): Array<{ name: string; filePath: string }> {
	const categoryRoot = path.join(QA_SOURCE_ROOT, "data/quests/categories");
	return walkFiles(categoryRoot, (name) => name.endsWith(".json")).map((filePath) => ({
		name: path.relative(categoryRoot, filePath).replace(/\.json$/i, "").split(path.sep).join("/"),
		filePath,
	}));
}

function dialogueRows(data: Record<string, unknown>): Record<string, unknown>[] {
	if (Array.isArray(data.all_lines)) {
		return data.all_lines.filter(
			(item): item is Record<string, unknown> => Boolean(item && typeof item === "object"),
		);
	}
	if (Array.isArray(data.dialogue)) {
		return data.dialogue.filter(
			(item): item is Record<string, unknown> => Boolean(item && typeof item === "object"),
		);
	}

	const rows: Record<string, unknown>[] = [];
	const walk = (value: unknown) => {
		if (Array.isArray(value)) {
			for (const item of value) walk(item);
			return;
		}
		if (!value || typeof value !== "object") return;
		for (const [key, child] of Object.entries(value)) {
			if (key === "dialogue" && Array.isArray(child)) {
				for (const item of child) {
					if (item && typeof item === "object") {
						rows.push(item as Record<string, unknown>);
					}
				}
			} else {
				walk(child);
			}
		}
	};
	walk(data);
	return rows;
}

function loadGlossary(): GlossaryRule[] {
	const rules = new Map<string, GlossaryRule>();
	for (const item of CURATED_GLOSSARY) rules.set(item.term.toLocaleLowerCase(), item);

	if (fs.existsSync(GLOSSARY_FILE)) {
		try {
			const raw = JSON.parse(fs.readFileSync(GLOSSARY_FILE, "utf8")) as Record<
				string,
				Record<string, unknown>
			>;
			for (const [term, value] of Object.entries(raw)) {
				const translation = textValue(value.indonesian_translation || value.translation);
				if (term.trim() && translation.trim()) {
					rules.set(term.toLocaleLowerCase(), {
						term,
						translation,
						category: textValue(value.category) || undefined,
					});
				}
			}
		} catch (error) {
			console.warn("[TranslationQA] Failed loading glossary:", error);
		}
	}

	return [...rules.values()].filter(
		(rule) => rule.term.trim().length >= 3 && rule.translation.trim().length >= 1,
	);
}

function dataFiles(): DataFile[] {
	const files: DataFile[] = [];
	for (const filePath of questFiles()) {
		files.push({
			filePath,
			relativePath: toRelativePath(filePath),
			sourceKind: "quest",
			sourceRef: path.basename(path.dirname(filePath)),
		});
	}

	for (const file of QA_SOURCE_ROOT === REPO_ROOT
		? listCategoryFiles()
		: categoryFiles()) {
		files.push({
			filePath: file.filePath,
			relativePath: toRelativePath(file.filePath),
			sourceKind: "category",
			sourceRef: file.name,
		});
	}

	return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function dataSignature(files: DataFile[]): string {
	const parts = [
		`rules:${TRANSLATION_QA_RULE_VERSION}`,
		`scanner:${TRANSLATION_QA_SCANNER_VERSION}`,
		...files.map((file) => {
		try {
			const stats = fs.statSync(file.filePath);
			return `${file.relativePath}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}:${stats.ino}`;
		} catch {
			return `${file.relativePath}:missing`;
		}
		}),
	];
	if (fs.existsSync(GLOSSARY_FILE)) {
		const stats = fs.statSync(GLOSSARY_FILE);
		parts.push(`glossary:${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}:${stats.ino}`);
	}
	return hash(parts.join("|"));
}

function addIssue(
	issues: TranslationQAIssue[],
	item: TranslationQAIssue,
): void {
	if (!issues.some((issue) => issue.code === item.code && issue.message === item.message)) {
		issues.push(item);
	}
}

function groupFingerprint(
	group: RawGroup,
	issues: TranslationQAIssue[],
	attachmentEvidence: TranslationQAAttachmentEvidence[],
): string {
	return hash(
		JSON.stringify({
			id: group.id,
			occurrences: group.occurrences.map((occurrence) => ({
				source: occurrence.sourceText,
				target: occurrence.targetText,
				variants: occurrence.targetVariants,
			})),
			issues,
			attachmentEvidence,
		}),
	);
}

function rowUnits(
	rows: Record<string, unknown>[],
	sourceKind: TranslationQASourceKind,
): RawOccurrence[] {
	const units: Array<{
		item: Record<string, unknown>;
		lineNo: number;
		lineId: string;
		speaker: string;
		unitKind: TranslationQAUnitKind;
	}> = [];

	rows.forEach((row, rowIndex) => {
		const lineNo = rowIndex + 1;
		const lineId = textValue(row.id) || String(lineNo);
		units.push({
			item: row,
			lineNo,
			lineId,
			speaker: speakerText(row, sourceKind === "quest" ? "Narrator" : "UI"),
			unitKind: "dialogue",
		});

		if (Array.isArray(row.options)) {
			row.options.forEach((option, optionIndex) => {
				if (!option || typeof option !== "object") return;
				units.push({
					item: option as Record<string, unknown>,
					lineNo,
				lineId: `${lineId}:option:${optionIndex + 1}`,
				speaker: "Player",
				unitKind: "option",
				});
			});
		}
	});

	return units.map((unit, index) => ({
		id: `${unit.lineId}:${textValue(unit.item.text_key) || index + 1}`,
		key: textValue(unit.item.text_key).trim(),
		lineNo: unit.lineNo,
		lineId: unit.lineId,
		speaker: unit.speaker,
		sourceText: sourceText(unit.item),
		targetText: effectiveTarget(unit.item),
		targetVariant: textValue(unit.item.text_id_mt || unit.item.mt) || undefined,
		previousText: index > 0 ? sourceText(units[index - 1].item) : undefined,
		nextText:
			index < units.length - 1
				? sourceText(units[index + 1].item)
				: undefined,
		targetVariants: targetVariants(unit.item),
		unitKind: unit.unitKind,
	}));
}

function itemFromGroup(
	group: RawGroup,
	glossary: GlossaryRule[],
	review: StoredReview | undefined,
	attachmentEvidence: TranslationQAAttachmentEvidence[],
): { item: TranslationQAItem; rawIssueCounts: Map<string, number> } {
	const representative = group.occurrences[0];
	const issues: TranslationQAIssue[] = [];
	const glossaryMatches = new Map<string, TranslationQAGlossaryMatch>();

	for (const occurrence of group.occurrences) {
		const inspection = inspectTranslation({
			sourceText: occurrence.sourceText,
			targetText: occurrence.targetText,
			targetVariants: occurrence.targetVariants,
			glossary,
		});
		for (const currentIssue of inspection.issues) addIssue(issues, currentIssue);
		for (const match of inspection.glossaryMatches) {
			const existing = glossaryMatches.get(match.term.toLocaleLowerCase());
			if (!existing || (!existing.present && match.present)) {
				glossaryMatches.set(match.term.toLocaleLowerCase(), match);
			}
		}
	}

	const sourceVariants = new Set(group.occurrences.map((occurrence) => occurrence.sourceText.trim()));
	const targetVariants = new Set(group.occurrences.map((occurrence) => occurrence.targetText.trim()));
	if (sourceVariants.size > 1) {
		addIssue(issues, {
			code: "source_variant_mismatch",
			severity: "warning",
			message: "Salinan text key yang sama memiliki teks sumber berbeda.",
		});
	}
	if (targetVariants.size > 1) {
		addIssue(issues, {
			code: "inconsistent_duplicate",
			severity: "warning",
			message: "Salinan text key yang sama memiliki terjemahan berbeda.",
		});
	}

	const highConfidenceMismatchCount = attachmentEvidence.filter(
		(evidence) => evidence.confidence === "high",
	).length;
	if (highConfidenceMismatchCount > 0) {
		addIssue(issues, {
			code: "attachment_mismatch",
			severity: "warning",
			message: `${highConfidenceMismatchCount} occurrence memiliki target yang lebih cocok dengan source line lain.`,
		});
	}

	const fingerprint = groupFingerprint(group, issues, attachmentEvidence);
	const staleReview = review && review.fingerprint !== fingerprint;
	if (staleReview) {
		addIssue(issues, {
			code: "changed_since_review",
			severity: "warning",
			message: "Teks berubah setelah review terakhir dan perlu diperiksa ulang.",
		});
	}

	const autoStatus: "pass" | "review" = issues.length > 0 ? "review" : "pass";
	const status: TranslationQAStatus =
		review && review.fingerprint === fingerprint
			? review.status
			: staleReview
				? "review"
				: autoStatus;

	const contexts: TranslationQAContext[] = group.occurrences
		.slice(0, MAX_CONTEXTS)
		.map((occurrence) => ({
			id: occurrence.id,
			lineNo: occurrence.lineNo,
			lineId: occurrence.lineId,
			speaker: occurrence.speaker,
			sourceText: occurrence.sourceText,
			targetText: occurrence.targetText,
			previousText: occurrence.previousText,
			nextText: occurrence.nextText,
			attachmentEvidence: attachmentEvidence.filter(
				(evidence) => evidence.occurrenceId === occurrence.id,
			),
		}));

	const item: TranslationQAItem = {
		id: group.id,
		key: group.key,
		sourceKind: group.sourceKind,
		sourceRef: group.sourceRef,
		sourcePath: group.sourcePath,
		questId: group.questId,
		questTitle: group.questTitle,
		chapterTitle: group.chapterTitle,
		lineNo: representative.lineNo,
		speaker: representative.speaker,
		sourceText: representative.sourceText,
		targetText: representative.targetText,
		targetVariant: representative.targetVariant,
		occurrences: group.occurrences.length,
		contexts,
		issues,
		glossaryMatches: [...glossaryMatches.values()],
		attachmentEvidence,
		autoStatus,
		status,
		review: review
			? {
				status: review.status,
				comment: review.comment,
				reviewer: review.reviewer,
				updatedAt: review.updatedAt,
				fingerprint: review.fingerprint,
			}
			: undefined,
		fingerprint,
	};

	const rawIssueCounts = new Map<string, number>();
	for (const currentIssue of issues) {
		rawIssueCounts.set(
			currentIssue.code,
			(rawIssueCounts.get(currentIssue.code) || 0) + 1,
		);
	}
	return { item, rawIssueCounts };
}

function toAlignmentOccurrence(
	group: RawGroup,
	occurrence: RawOccurrence,
): TranslationQAAlignmentOccurrence {
	return {
		id: occurrence.id,
		key: occurrence.key,
		lineNo: occurrence.lineNo,
		lineId: occurrence.lineId,
		speaker: occurrence.speaker,
		sourceText: occurrence.sourceText,
		targetText: occurrence.targetText,
		targetVariants: occurrence.targetVariants,
		sourceKind: group.sourceKind,
		sourceRef: group.sourceRef,
		sourcePath: group.sourcePath,
		questId: group.questId,
		questTitle: group.questTitle,
		chapterTitle: group.chapterTitle,
		unitKind: occurrence.unitKind,
	};
}

function parseDataFile(file: DataFile): {
	sourceFile: DataFile;
	groups: Map<string, RawGroup>;
} {
	const document = JSON.parse(fs.readFileSync(file.filePath, "utf8")) as Record<string, unknown>;
	let sourceFile = file;
	if (file.sourceKind === "quest") {
		const questId = textValue(document.quest_id);
		sourceFile = {
			...file,
			sourceRef: questId || file.sourceRef,
			questId: questId || undefined,
			questTitle: textValue(document.quest_name) || undefined,
			chapterTitle: textValue(document.chapter_name) || undefined,
		};
	}
	const units = sourceFile.sourceKind === "quest"
		? rowUnits(dialogueRows(document), file.sourceKind)
		: Object.entries(document).map(([key, value], index, entries) => {
			const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
			const previous = entries[index - 1]?.[1];
			const next = entries[index + 1]?.[1];
			return {
				id: key,
				key,
				lineNo: index + 1,
				lineId: key,
				speaker: "UI",
				unitKind: "category" as const,
				sourceText: sourceText(item),
				targetText: effectiveTarget(item, true),
				targetVariant: textValue(item.text_id_mt || item.mt) || undefined,
				previousText: previous && typeof previous === "object"
					? sourceText(previous as Record<string, unknown>)
					: undefined,
				nextText: next && typeof next === "object"
					? sourceText(next as Record<string, unknown>)
					: undefined,
				targetVariants: targetVariants(item, true),
			};
		});

	const groups = new Map<string, RawGroup>();
	for (const unit of units) {
		if (!unit.key && !unit.sourceText && !unit.targetText) continue;
		const key = unit.key || `__line_${unit.lineId}`;
		const id = stableId(sourceFile.sourceKind, sourceFile.sourceRef, key);
		let group = groups.get(id);
		if (!group) {
			group = {
				id,
				key: unit.key,
				sourceKind: sourceFile.sourceKind,
				sourceRef: sourceFile.sourceRef,
				sourcePath: sourceFile.relativePath,
				questId: sourceFile.questId,
				questTitle: sourceFile.questTitle,
				chapterTitle: sourceFile.chapterTitle,
				occurrences: [],
			};
			groups.set(id, group);
		}
		group.occurrences.push(unit);
	}
	return { sourceFile, groups };
}

function reviewFromItem(item: TranslationQAItem): StoredReview | undefined {
	if (!item.review) return undefined;
	return {
		status: item.review.status,
		comment: item.review.comment,
		reviewer: item.review.reviewer,
		updatedAt: item.review.updatedAt,
		fingerprint: item.review.fingerprint,
	};
}

function readReviews(): Record<string, StoredReview> {
	if (!fs.existsSync(QA_REVIEWS_FILE)) return {};
	try {
		const value = JSON.parse(fs.readFileSync(QA_REVIEWS_FILE, "utf8")) as unknown;
		return value && typeof value === "object"
			? (value as Record<string, StoredReview>)
			: {};
	} catch (error) {
		console.warn("[TranslationQA] Failed loading review state:", error);
		return {};
	}
}

function writeReviews(reviews: Record<string, StoredReview>): void {
	fs.mkdirSync(path.dirname(QA_REVIEWS_FILE), { recursive: true });
	const tempFile = `${QA_REVIEWS_FILE}.tmp`;
	fs.writeFileSync(tempFile, JSON.stringify(reviews, null, 2), "utf8");
	fs.renameSync(tempFile, QA_REVIEWS_FILE);
}

function ensureDatabaseDir(): void {
	fs.mkdirSync(QA_DATA_DIR, { recursive: true });
}

function openDatabase(): DatabaseSync {
	ensureDatabaseDir();
	return new DatabaseSync(QA_DB_FILE, { timeout: 5000 });
}

function removeSqliteArtifacts(filePath: string): void {
	for (const suffix of ["", "-journal", "-wal", "-shm"]) {
		try {
			fs.rmSync(`${filePath}${suffix}`, { force: true });
		} catch {
			// Best-effort cleanup; the next scan will use a new unique path.
		}
	}
}

function removeSqliteSidecars(filePath: string): void {
	for (const suffix of ["-journal", "-wal", "-shm"]) {
		try {
			fs.rmSync(`${filePath}${suffix}`, { force: true });
		} catch {
			// Best-effort cleanup before installing an immutable snapshot.
		}
	}
}

function prepareLiveSnapshotSwap(): void {
	if (!fs.existsSync(QA_DB_FILE)) return;
	const hasSidecar = ["-journal", "-wal", "-shm"].some((suffix) =>
		fs.existsSync(`${QA_DB_FILE}${suffix}`),
	);
	if (!hasSidecar) return;
	let database: DatabaseSync | null = null;
	try {
		database = new DatabaseSync(QA_DB_FILE, { timeout: 5000 });
		database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		database.exec("PRAGMA journal_mode = DELETE");
	} catch (error) {
		throw new Error(
			`QA snapshot lama sedang digunakan dan tidak dapat dipersiapkan: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		database?.close();
	}
	removeSqliteSidecars(QA_DB_FILE);
}

function cleanupTemporarySnapshots(): void {
	if (!fs.existsSync(QA_DATA_DIR)) return;
	for (const name of fs.readdirSync(QA_DATA_DIR)) {
		if (name.startsWith(path.basename(QA_DB_TEMP_PREFIX))) {
			removeSqliteArtifacts(path.join(QA_DATA_DIR, name));
		}
	}
}

function temporaryDatabasePath(): string {
	ensureDatabaseDir();
	return `${QA_DB_TEMP_PREFIX}${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function workerExecArgv(extension: "ts" | "js"): string[] {
	if (extension === "js") return [];
	const supported = new Set(["--require", "--import", "--loader"]);
	const args: string[] = [];
	for (let index = 0; index < process.execArgv.length; index++) {
		const argument = process.execArgv[index];
		if (supported.has(argument)) {
			const value = process.execArgv[index + 1];
			if (value) args.push(argument, value);
			index++;
		} else if (["--require=", "--import=", "--loader="].some((prefix) => argument.startsWith(prefix))) {
			args.push(argument);
		}
	}
	return args;
}

function hasQaTable(database: DatabaseSync): boolean {
	const row = database
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'qa_items'")
		.get() as { name?: string } | undefined;
	if (row?.name !== "qa_items") return false;
	const columns = database.prepare("PRAGMA table_info(qa_items)").all() as Array<{ name?: string }>;
	return columns.some((column) => column.name === "attachment_evidence_json");
}

function parseJson<T>(value: unknown, fallback: T): T {
	try {
		return typeof value === "string" ? (JSON.parse(value) as T) : fallback;
	} catch {
		return fallback;
	}
}

function rowToItem(row: Record<string, unknown>): TranslationQAItem {
	const reviewStatus = textValue(row.review_status) as "review" | "approved" | "";
	const review = reviewStatus
		? {
				status: reviewStatus,
				comment: textValue(row.review_comment),
				reviewer: textValue(row.review_reviewer),
				updatedAt: textValue(row.review_updated_at),
				fingerprint: textValue(row.review_fingerprint),
			}
		: undefined;
	return {
		id: textValue(row.id),
		key: textValue(row.key),
		sourceKind: textValue(row.source_kind) as TranslationQASourceKind,
		sourceRef: textValue(row.source_ref),
		sourcePath: textValue(row.source_path),
		questId: textValue(row.quest_id) || undefined,
		questTitle: textValue(row.quest_title) || undefined,
		chapterTitle: textValue(row.chapter_title) || undefined,
		lineNo: row.line_no == null ? undefined : Number(row.line_no),
		speaker: textValue(row.speaker) || undefined,
		sourceText: textValue(row.source_text),
		targetText: textValue(row.target_text),
		targetVariant: textValue(row.target_variant) || undefined,
		occurrences: Number(row.occurrences || 0),
		contexts: parseJson(row.contexts_json, []),
		issues: parseJson(row.issues_json, []),
		glossaryMatches: parseJson(row.glossary_json, []),
		attachmentEvidence: parseJson(row.attachment_evidence_json, []),
		autoStatus: textValue(row.auto_status) as "pass" | "review",
		status: textValue(row.status) as TranslationQAStatus,
		review,
		fingerprint: textValue(row.fingerprint),
	};
}

function issueCodes(issues: TranslationQAIssue[]): string {
	return issues.map((item) => item.code).join(" ");
}

function bindReview(item: TranslationQAItem): Array<string | number | null> {
	const review = reviewFromItem(item);
	return [
		item.id,
		item.key,
		item.sourceKind,
		item.sourceRef,
		item.sourcePath,
		item.questId || "",
		item.questTitle || "",
		item.chapterTitle || "",
		item.lineNo ?? null,
		item.speaker || "",
		item.sourceText,
		item.targetText,
		item.targetVariant || "",
		item.occurrences,
		JSON.stringify(item.contexts),
		JSON.stringify(item.issues),
		JSON.stringify(item.glossaryMatches),
		JSON.stringify(item.attachmentEvidence),
		item.autoStatus,
		item.status,
		item.fingerprint,
		review?.status || null,
		review?.comment || null,
		review?.reviewer || null,
		review?.updatedAt || null,
		review?.fingerprint || null,
		issueCodes(item.issues),
	];
}

function csvCell(value: unknown): string {
	const text = value == null ? "" : String(value);
	return `"${text.replaceAll('"', '""')}"`;
}

interface ScanJobRecord extends TranslationQAScanJob {
	worker?: Worker;
}

export class TranslationQAService {
	private cachedScan: CachedScan | null = null;
	private lastForcedScanAt = 0;
	private readonly forcedScanCooldownMs = 60_000;
	private activeScanJob: ScanJobRecord | null = null;

	constructor() {
		cleanupTemporarySnapshots();
	}

	private hydrateSnapshot(expectedFingerprint?: string): boolean {
		if (!fs.existsSync(QA_DB_FILE)) return false;
		let database: DatabaseSync | null = null;
		try {
			database = openDatabase();
			if (!hasQaTable(database)) {
				return false;
			}
			const meta = database
				.prepare("SELECT value FROM qa_meta WHERE key = ?")
				.get("summary") as { value?: string } | undefined;
			const summary = parseJson(meta?.value, { dataFingerprint: "", generatedAt: "" });
			if (expectedFingerprint && summary.dataFingerprint !== expectedFingerprint) return false;
			this.cachedScan = {
				dataFingerprint: textValue(summary.dataFingerprint),
				generatedAt: textValue(summary.generatedAt),
			};
			return true;
		} catch (error) {
			console.warn("[TranslationQA] Failed loading cached report:", error);
			return false;
		} finally {
			database?.close();
		}
	}

	private hydrateCachedScan(fingerprint: string): boolean {
		return this.hydrateSnapshot(fingerprint);
	}

	private ensureScanned(force = false): void {
		const files = dataFiles();
		const fingerprint = dataSignature(files);
		if (!force && this.activeScanJob?.status === "running") {
			if (this.cachedScan && fs.existsSync(QA_DB_FILE)) return;
			if (this.hydrateSnapshot()) return;
			throw new TranslationQAScanInProgressError();
		}
		if (!force && this.cachedScan?.dataFingerprint === fingerprint) return;
		if (!force && this.hydrateCachedScan(fingerprint)) return;
		this.scan(files, fingerprint);
	}

	private scan(files: DataFile[], fingerprint: string): void {
		const reviews = readReviews();
		const glossary = loadGlossary();
		cleanupTemporarySnapshots();
		const temporaryFile = temporaryDatabasePath();
		let database: DatabaseSync | null = null;
		let transactionOpen = false;
		const generatedAt = new Date().toISOString();
		const issueCounts = new Map<string, number>();
		const sourceKindCounts: Record<TranslationQASourceKind, number> = {
			quest: 0,
			category: 0,
		};
		let totalItems = 0;
		let totalOccurrences = 0;
		let parseErrors = 0;
		const parsedFiles: Array<{ sourceFile: DataFile; groups: Map<string, RawGroup> }> = [];
		const alignmentOccurrences: TranslationQAAlignmentOccurrence[] = [];

		for (const file of files) {
			try {
				const parsed = parseDataFile(file);
				parsedFiles.push(parsed);
				for (const group of parsed.groups.values()) {
					for (const occurrence of group.occurrences) {
						alignmentOccurrences.push(toAlignmentOccurrence(group, occurrence));
					}
				}
			} catch (error) {
				parseErrors++;
				console.warn(`[TranslationQA] Failed reading ${file.filePath}:`, error);
			}
		}
		const attachmentEvidence = findAttachmentEvidence(alignmentOccurrences, glossary);

		try {
			database = new DatabaseSync(temporaryFile, { timeout: 5000 });
			database.exec("PRAGMA journal_mode = DELETE");
			database.exec("BEGIN IMMEDIATE");
			transactionOpen = true;
			database.exec(`
			CREATE TABLE qa_items (
				id TEXT PRIMARY KEY,
				key TEXT NOT NULL,
				source_kind TEXT NOT NULL,
				source_ref TEXT NOT NULL,
				source_path TEXT NOT NULL,
				quest_id TEXT,
				quest_title TEXT,
				chapter_title TEXT,
				line_no INTEGER,
				speaker TEXT,
				source_text TEXT NOT NULL,
				target_text TEXT NOT NULL,
				target_variant TEXT,
				occurrences INTEGER NOT NULL,
				contexts_json TEXT NOT NULL,
				issues_json TEXT NOT NULL,
				glossary_json TEXT NOT NULL,
				attachment_evidence_json TEXT NOT NULL,
				auto_status TEXT NOT NULL,
				status TEXT NOT NULL,
				fingerprint TEXT NOT NULL,
				review_status TEXT,
				review_comment TEXT,
				review_reviewer TEXT,
				review_updated_at TEXT,
				review_fingerprint TEXT,
				issue_codes TEXT NOT NULL
			);
			CREATE INDEX qa_items_status_idx ON qa_items(status);
			CREATE INDEX qa_items_source_idx ON qa_items(source_kind, source_ref);
			CREATE INDEX qa_items_issue_idx ON qa_items(issue_codes);
			CREATE TABLE qa_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			`);

			const insert = database.prepare(`
			INSERT INTO qa_items (
				id, key, source_kind, source_ref, source_path, quest_id, quest_title, chapter_title,
				line_no, speaker, source_text, target_text, target_variant, occurrences, contexts_json,
				issues_json, glossary_json, attachment_evidence_json, auto_status, status, fingerprint,
				review_status, review_comment, review_reviewer, review_updated_at, review_fingerprint, issue_codes
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const parsed of parsedFiles) {
				for (const group of parsed.groups.values()) {
					const groupEvidence = group.occurrences
						.map((occurrence) => attachmentEvidence.get(`${group.sourcePath}::${occurrence.id}`))
						.filter((evidence): evidence is TranslationQAAttachmentEvidence => Boolean(evidence));
					const result = itemFromGroup(group, glossary, reviews[group.id], groupEvidence);
					insert.run(...bindReview(result.item));
					totalItems++;
					totalOccurrences += result.item.occurrences;
					sourceKindCounts[result.item.sourceKind]++;
					for (const [code, count] of result.rawIssueCounts) {
						issueCounts.set(code, (issueCounts.get(code) || 0) + count);
					}
				}
			}

			const rawSummary = {
				generatedAt,
				dataFingerprint: fingerprint,
				totalItems,
				totalOccurrences,
				parseErrors,
				issueCounts: Object.fromEntries(issueCounts),
				sourceKindCounts,
			};
			database.prepare("INSERT INTO qa_meta VALUES (?, ?)").run(
				"summary",
				JSON.stringify(rawSummary),
			);
			database.exec("COMMIT");
			transactionOpen = false;
			database.close();
			database = null;
			prepareLiveSnapshotSwap();
			fs.renameSync(temporaryFile, QA_DB_FILE);
			this.cachedScan = { dataFingerprint: fingerprint, generatedAt };
		} catch (error) {
			if (transactionOpen && database) {
				try {
					database.exec("ROLLBACK");
				} catch {
					// The transaction may already have been rolled back by SQLite.
				}
			}
			if (database) {
				try {
					database.close();
				} catch {
					// The connection may already be closed after a commit failure.
				}
			}
			removeSqliteArtifacts(temporaryFile);
			throw error;
		}
	}

	private getSummaryFromDatabase(database: DatabaseSync): TranslationQASummary {
		const meta = database
			.prepare("SELECT value FROM qa_meta WHERE key = ?")
			.get("summary") as { value?: string } | undefined;
		const raw = parseJson(meta?.value, {
			generatedAt: "",
			dataFingerprint: "",
			totalItems: 0,
			totalOccurrences: 0,
			parseErrors: 0,
			issueCounts: {},
			sourceKindCounts: { quest: 0, category: 0 },
		});
		const statusRows = database
			.prepare("SELECT status, COUNT(*) AS count FROM qa_items GROUP BY status")
			.all() as Array<{ status?: string; count?: number }>;
		const statusCounts: Record<TranslationQAStatus, number> = {
			pass: 0,
			review: 0,
			approved: 0,
		};
		for (const row of statusRows) {
			if (row.status === "pass" || row.status === "review" || row.status === "approved") {
				statusCounts[row.status] = Number(row.count || 0);
			}
		}
		return {
			generatedAt: textValue(raw.generatedAt),
			dataFingerprint: textValue(raw.dataFingerprint),
			totalItems: Number(raw.totalItems || 0),
			totalOccurrences: Number(raw.totalOccurrences || 0),
			parseErrors: Number(raw.parseErrors || 0),
			statusCounts,
			issueCounts: (raw.issueCounts || {}) as Record<string, number>,
			sourceKindCounts: (raw.sourceKindCounts || { quest: 0, category: 0 }) as Record<
				TranslationQASourceKind,
				number
			>,
		};
	}

	private readyDatabase(force = false): DatabaseSync {
		this.ensureScanned(force);
		const database = openDatabase();
		if (!hasQaTable(database)) {
			database.close();
			this.ensureScanned(true);
			return openDatabase();
		}
		return database;
	}

	public getSummary(force = false): TranslationQASummary {
		const database = this.readyDatabase(force);
		try {
			return this.getSummaryFromDatabase(database);
		} finally {
			database.close();
		}
	}

	private publicScanJob(job: ScanJobRecord): TranslationQAScanJob {
		return {
			id: job.id,
			status: job.status,
			startedAt: job.startedAt,
			finishedAt: job.finishedAt,
			summary: job.summary,
			error: job.error,
		};
	}

	public getScanJob(id: string): TranslationQAScanJob | null {
		if (!this.activeScanJob || this.activeScanJob.id !== id) return null;
		return this.publicScanJob(this.activeScanJob);
	}

	public startForceScan(): TranslationQAScanJob {
		if (this.activeScanJob?.status === "running") {
			return this.publicScanJob(this.activeScanJob);
		}

		const now = Date.now();
		const elapsed = now - this.lastForcedScanAt;
		if (elapsed < this.forcedScanCooldownMs) {
			throw new TranslationQAScanRateLimitError(
				Math.ceil((this.forcedScanCooldownMs - elapsed) / 1000),
			);
		}

		this.lastForcedScanAt = now;
		const job: ScanJobRecord = {
			id: `qa_scan_${now}_${crypto.randomBytes(4).toString("hex")}`,
			status: "running",
			startedAt: new Date(now).toISOString(),
		};
		this.activeScanJob = job;

		try {
			const extension = fileURLToPath(import.meta.url).endsWith(".ts") ? "ts" : "js";
			const worker = new Worker(
				new URL(`./translationQaWorker.${extension}`, import.meta.url),
				{ execArgv: workerExecArgv(extension) },
			);
			job.worker = worker;
			worker.on("message", (message: { ok?: boolean; summary?: TranslationQASummary; error?: string }) => {
				if (job.status !== "running") return;
				job.finishedAt = new Date().toISOString();
				if (message.ok && message.summary) {
					job.status = "completed";
					job.summary = message.summary;
					this.cachedScan = null;
				} else {
					job.status = "failed";
					job.error = message.error || "Translation QA scan failed.";
					this.lastForcedScanAt = 0;
				}
				void worker.terminate();
			});
			worker.on("error", (error) => {
				if (job.status !== "running") return;
				job.status = "failed";
				job.finishedAt = new Date().toISOString();
				job.error = error.message;
				this.lastForcedScanAt = 0;
			});
			worker.on("exit", (code) => {
				if (job.status === "running" && code !== 0) {
					job.status = "failed";
					job.finishedAt = new Date().toISOString();
					job.error = `QA worker exited with code ${code}.`;
					this.lastForcedScanAt = 0;
				}
			});
			return this.publicScanJob(job);
		} catch (error) {
			this.lastForcedScanAt = 0;
			job.status = "failed";
			job.finishedAt = new Date().toISOString();
			job.error = error instanceof Error ? error.message : "Translation QA worker failed.";
			return this.publicScanJob(job);
		}
	}

	private filterParts(options: {
		status?: TranslationQAStatus | "all";
		kind?: TranslationQASourceKind | "all";
		query?: string;
		issue?: string;
	}): { where: string; params: Array<string> } {
		const clauses: string[] = [];
		const params: string[] = [];
		if (options.status && options.status !== "all") {
			clauses.push("status = ?");
			params.push(options.status);
		}
		if (options.kind && options.kind !== "all") {
			clauses.push("source_kind = ?");
			params.push(options.kind);
		}
		if (options.issue?.trim()) {
			clauses.push("issue_codes LIKE ?");
			params.push(`%${options.issue.trim()}%`);
		}
		if (options.query?.trim()) {
			const pattern = `%${options.query.trim()}%`;
			clauses.push(
				"(key LIKE ? OR source_ref LIKE ? OR quest_title LIKE ? OR speaker LIKE ? OR source_text LIKE ? OR target_text LIKE ?)",
			);
			params.push(pattern, pattern, pattern, pattern, pattern, pattern);
		}
		return {
			where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
			params,
		};
	}

	private queryItems(
		database: DatabaseSync,
		options: {
			status?: TranslationQAStatus | "all";
			kind?: TranslationQASourceKind | "all";
			query?: string;
			issue?: string;
			sample?: boolean;
			limit?: number;
			offset?: number;
		},
	): TranslationQAItem[] {
		const filter = this.filterParts(options);
		const limit = options.limit == null ? undefined : Math.max(1, Math.min(500000, options.limit));
		const sql = `
			SELECT * FROM qa_items
			${filter.where}
			ORDER BY ${options.sample ? "RANDOM()" : "CASE status WHEN 'review' THEN 0 WHEN 'pass' THEN 1 ELSE 2 END, source_kind ASC, source_ref ASC, key ASC"}
			${limit == null ? "" : " LIMIT ? OFFSET ?"}
		`;
		const params: Array<string | number> = [...filter.params];
		if (limit != null) params.push(limit, Math.max(0, options.offset || 0));
		return database
			.prepare(sql)
			.all(...params)
			.map((row) => rowToItem(row as Record<string, unknown>));
	}

	public listItems(options: {
		status?: TranslationQAStatus | "all";
		kind?: TranslationQASourceKind | "all";
		query?: string;
		issue?: string;
		sample?: boolean;
		page?: number;
		pageSize?: number;
	} = {}): TranslationQAListResponse {
		const database = this.readyDatabase();
		try {
			const page = Math.max(1, Math.floor(options.page || 1));
			const pageSize = Math.max(1, Math.min(100, Math.floor(options.pageSize || 25)));
			const filter = this.filterParts(options);
			const countRow = database
				.prepare(`SELECT COUNT(*) AS count FROM qa_items ${filter.where}`)
				.get(...filter.params) as { count?: number };
			const summary = this.getSummaryFromDatabase(database);
			const items = this.queryItems(database, {
				...options,
				limit: pageSize,
				offset: options.sample ? 0 : (page - 1) * pageSize,
			});
			return {
				summary,
				items,
				page,
				pageSize,
				total: options.sample
					? Math.min(Number(countRow?.count || 0), pageSize)
					: Number(countRow?.count || 0),
			};
		} finally {
			database.close();
		}
	}

	public getItem(id: string): TranslationQAItem | null {
		const database = this.readyDatabase();
		try {
			const row = database.prepare("SELECT * FROM qa_items WHERE id = ?").get(id) as
				| Record<string, unknown>
				| undefined;
			return row ? rowToItem(row) : null;
		} finally {
			database.close();
		}
	}

	public updateReview(
		id: string,
		status: "review" | "approved" | "reset",
		comment: string,
		reviewer: string,
	): TranslationQAItem | null {
		if (this.activeScanJob?.status === "running") {
			throw new TranslationQAScanInProgressError(
				"Review dikunci selama scan QA agar tidak tertimpa snapshot baru.",
			);
		}
		const database = this.readyDatabase();
		try {
			const row = database.prepare("SELECT * FROM qa_items WHERE id = ?").get(id) as
				| Record<string, unknown>
				| undefined;
			if (!row) return null;
			const item = rowToItem(row);
			const reviews = readReviews();
			if (status === "reset") {
				delete reviews[id];
				database
					.prepare(
						`UPDATE qa_items SET status = auto_status, review_status = NULL,
						 review_comment = NULL, review_reviewer = NULL, review_updated_at = NULL,
						 review_fingerprint = NULL WHERE id = ?`,
					)
					.run(id);
			} else {
				const review: StoredReview = {
					status,
					comment: comment.trim().slice(0, 4000),
					reviewer: reviewer || "Editor",
					updatedAt: new Date().toISOString(),
					fingerprint: item.fingerprint,
				};
				reviews[id] = review;
				database
					.prepare(
						`UPDATE qa_items SET status = ?, review_status = ?, review_comment = ?,
						 review_reviewer = ?, review_updated_at = ?, review_fingerprint = ? WHERE id = ?`,
					)
					.run(
						status,
						status,
						review.comment,
						review.reviewer,
						review.updatedAt,
						review.fingerprint,
						id,
					);
			}
			writeReviews(reviews);
			return rowToItem(
				database.prepare("SELECT * FROM qa_items WHERE id = ?").get(id) as Record<
					string,
					unknown
				>,
			);
		} finally {
			database.close();
		}
	}

	public exportItems(options: {
		status?: TranslationQAStatus | "all";
		kind?: TranslationQASourceKind | "all";
		query?: string;
		issue?: string;
		format: "json" | "csv";
		limit?: number;
		offset?: number;
	}): {
		content: string;
		contentType: string;
		filename: string;
		total: number;
		returned: number;
		truncated: boolean;
	} {
		const database = this.readyDatabase();
		try {
			const filter = this.filterParts(options);
			const countRow = database
				.prepare(`SELECT COUNT(*) AS count FROM qa_items ${filter.where}`)
				.get(...filter.params) as { count?: number };
			const total = Number(countRow?.count || 0);
			const limit = Math.max(
				1,
				Math.min(QA_EXPORT_MAX_ITEMS, Math.floor(options.limit || QA_EXPORT_DEFAULT_LIMIT)),
			);
			const offset = Math.max(0, Math.floor(options.offset || 0));
			const items = this.queryItems(database, { ...options, limit, offset });
			const truncated = offset + items.length < total;
			if (options.format === "csv") {
				const lines = [
					[
						"id",
						"status",
						"source_kind",
						"source_ref",
						"key",
						"line_no",
						"speaker",
						"issues",
						"attachment_confidence",
						"attachment_candidates",
						"source_text",
						"target_text",
						"comment",
					].join(","),
					...items.map((item) =>
						[
							item.id,
							item.status,
							item.sourceKind,
							item.sourceRef,
							item.key,
							item.lineNo,
							item.speaker,
							item.issues.map((issue) => issue.code).join(" | "),
							item.attachmentEvidence.map((evidence) => evidence.confidence).join(" | "),
							JSON.stringify(item.attachmentEvidence),
							item.sourceText,
							item.targetText,
							item.review?.comment,
						].map(csvCell).join(","),
					),
				].join("\n");
				return {
					content: `${lines}\n`,
					contentType: "text/csv; charset=utf-8",
					filename: "wuwaid-translation-qa.csv",
					total,
					returned: items.length,
					truncated,
				};
			}
			return {
				content: JSON.stringify({
					summary: this.getSummaryFromDatabase(database),
					total,
					returned: items.length,
					offset,
					truncated,
					items,
				}, null, 2),
				contentType: "application/json; charset=utf-8",
				filename: "wuwaid-translation-qa.json",
				total,
				returned: items.length,
				truncated,
			};
		} finally {
			database.close();
		}
	}
}

export const translationQaService = new TranslationQAService();
