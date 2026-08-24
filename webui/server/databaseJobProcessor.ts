import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	REPO_ROOT,
	listCategoryFiles,
	rebuildCategoryIndex,
	type CategoryFile,
} from "./categoryStore.js";
import {
	listQuestJsonFiles,
	readDialogueRows,
	rebuildDialogueIndex,
} from "./dialogueIndexStore.js";
import {
	ensureQuestSourceIndex,
	rebuildQuestSummaryIndex,
} from "./readerIndexStore.js";
import { ensureTranslationStatsTable } from "./translationStatsStore.js";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0");
const DEFAULT_QUESTS_JSON_DIR = path.join(REPO_ROOT, "data/quests/quests");
const DEFAULT_CATEGORIES_JSON_DIR = path.join(
	REPO_ROOT,
	"data/quests/categories",
);
const DEFAULT_INDEX_DB_FILE = path.join(REPO_ROOT, "data/quests/index.db");
const INDEX_STAGE_COUNT = 5;

type TransactionState =
	| "prepared"
	| "mutated"
	| "index-ready"
	| "swap-pending"
	| "committed";

type ProgressReporter = (progress: DatabaseJobProgress) => void;
type JsonRecord = Record<string, unknown>;

export type DatabaseJobKind = "import" | "reset";

export interface DatabaseJobFile {
	name: string;
	path: string;
}

export interface DatabaseJobProgress {
	stage: string;
	current: number;
	total: number;
	detail?: string;
}

export interface DatabaseJobResult {
	status: "imported" | "reset";
	fileCount?: number;
	updatedQuestFiles: number;
	updatedQuestLines: number;
	updatedCategoryFiles: number;
	updatedCategoryItems: number;
	indexedCategoryRows: number;
	indexedDialogueRows: number;
	indexedStatsRows: number;
}

export interface DatabaseJobProcessorOptions {
	questsJsonDir?: string;
	categoriesJsonDir?: string;
	indexDbFile?: string;
	transactionDirectory?: string;
}

interface TransactionBackup {
	sourcePath: string;
	backupPath: string;
}

interface TransactionManifest {
	state: TransactionState;
	liveIndexPath: string;
	temporaryIndexPath: string;
	previousIndexPath: string;
	backups: TransactionBackup[];
}

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function englishText(item: JsonRecord): string {
	return String(
		item.text_en ||
			item.en ||
			item["text_zh-Hans"] ||
			item.text_zh ||
			item.zh ||
			"",
	);
}

function writeJson(filePath: string, value: unknown): void {
	const temporary = `${filePath}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf-8");
		fs.renameSync(temporary, filePath);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

function writeAtomicJson(filePath: string, value: unknown): void {
	const temporary = `${filePath}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf-8");
		fs.renameSync(temporary, filePath);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

function isSqliteDatabase(filePath: string): boolean {
	const descriptor = fs.openSync(filePath, "r");
	try {
		const header = Buffer.alloc(SQLITE_HEADER.length);
		fs.readSync(descriptor, header, 0, header.length, 0);
		return header.equals(SQLITE_HEADER);
	} finally {
		fs.closeSync(descriptor);
	}
}

function readConfigDbTranslations(filePath: string): Map<string, string> {
	const database = new DatabaseSync(filePath, { readOnly: true });
	try {
		const rows = database
			.prepare("SELECT Id, Content FROM MultiText")
			.all() as Array<{ Id?: string; Content?: string }>;
		return new Map(
			rows
				.filter((row) => row.Id)
				.map((row) => [String(row.Id), String(row.Content ?? "")]),
		);
	} finally {
		database.close();
	}
}

function removeSqliteArtifacts(filePath: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		fs.rmSync(`${filePath}${suffix}`, { force: true, recursive: true });
	}
}

function moveSqliteArtifacts(from: string, to: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		const source = `${from}${suffix}`;
		if (fs.existsSync(source)) fs.renameSync(source, `${to}${suffix}`);
	}
}

class MutationTransaction {
	private readonly manifestPath: string;
	private readonly backupDirectory: string;
	private manifest: TransactionManifest;

	public constructor(directory: string, liveIndexPath: string) {
		fs.mkdirSync(directory, { recursive: true });
		this.manifestPath = path.join(directory, "transaction.json");
		this.backupDirectory = path.join(directory, "backups");
		this.recoverExistingTransaction();
		this.manifest = {
			state: "prepared",
			liveIndexPath,
			temporaryIndexPath: path.join(directory, "rebuilt-index.db"),
			previousIndexPath: path.join(directory, "previous-index.db"),
			backups: [],
		};
		fs.mkdirSync(this.backupDirectory, { recursive: true });
		this.persist();
	}

	public backupBeforeWrite(sourcePath: string): void {
		if (this.manifest.backups.some((entry) => entry.sourcePath === sourcePath)) {
			return;
		}
		const backupPath = path.join(
			this.backupDirectory,
			`${String(this.manifest.backups.length).padStart(6, "0")}.json`,
		);
		fs.copyFileSync(sourcePath, backupPath);
		this.manifest.backups.push({ sourcePath, backupPath });
		this.persist();
	}

	public markMutated(): void {
		this.manifest.state = "mutated";
		this.persist();
	}

	public createIndexFile(): string {
		removeSqliteArtifacts(this.manifest.temporaryIndexPath);
		fs.mkdirSync(path.dirname(this.manifest.temporaryIndexPath), {
			recursive: true,
		});
		const database = new DatabaseSync(this.manifest.temporaryIndexPath);
		database.close();
		return this.manifest.temporaryIndexPath;
	}

	public markIndexReady(): void {
		this.manifest.state = "index-ready";
		this.persist();
	}

	public commitIndex(): void {
		this.manifest.state = "swap-pending";
		this.persist();

		removeSqliteArtifacts(this.manifest.previousIndexPath);
		if (fs.existsSync(this.manifest.liveIndexPath)) {
			moveSqliteArtifacts(
				this.manifest.liveIndexPath,
				this.manifest.previousIndexPath,
			);
		}
		moveSqliteArtifacts(
			this.manifest.temporaryIndexPath,
			this.manifest.liveIndexPath,
		);
		this.manifest.state = "committed";
		try {
			this.persist();
		} catch (error) {
			this.manifest.state = "swap-pending";
			throw error;
		}
	}

	public finalize(): void {
		for (const cleanup of [
			() => removeSqliteArtifacts(this.manifest.temporaryIndexPath),
			() => removeSqliteArtifacts(this.manifest.previousIndexPath),
			() => fs.rmSync(this.backupDirectory, { recursive: true, force: true }),
			() => fs.rmSync(this.manifestPath, { force: true }),
		]) {
			try {
				cleanup();
			} catch (error) {
				console.warn("[database-jobs] Transaction cleanup deferred:", error);
			}
		}
	}

	public rollback(): void {
		let restored = false;
		try {
			if (this.manifest.state === "swap-pending") {
				removeSqliteArtifacts(this.manifest.liveIndexPath);
				if (fs.existsSync(this.manifest.previousIndexPath)) {
					moveSqliteArtifacts(
						this.manifest.previousIndexPath,
						this.manifest.liveIndexPath,
					);
				}
			}
			removeSqliteArtifacts(this.manifest.temporaryIndexPath);
			for (const backup of [...this.manifest.backups].reverse()) {
				if (!fs.existsSync(backup.backupPath)) continue;
				fs.mkdirSync(path.dirname(backup.sourcePath), { recursive: true });
				fs.rmSync(backup.sourcePath, { force: true });
				fs.renameSync(backup.backupPath, backup.sourcePath);
			}
			restored = true;
		} finally {
			if (restored) this.finalize();
		}
	}

	private persist(): void {
		writeAtomicJson(this.manifestPath, this.manifest);
	}

	private recoverExistingTransaction(): void {
		if (!fs.existsSync(this.manifestPath)) return;
		let manifest: TransactionManifest;
		try {
			manifest = JSON.parse(
				fs.readFileSync(this.manifestPath, "utf-8"),
			) as TransactionManifest;
		} catch {
			fs.rmSync(this.manifestPath, { force: true });
			fs.rmSync(this.backupDirectory, { recursive: true, force: true });
			return;
		}

		if (manifest.state === "committed") {
			removeSqliteArtifacts(manifest.temporaryIndexPath);
			removeSqliteArtifacts(manifest.previousIndexPath);
			fs.rmSync(this.backupDirectory, { recursive: true, force: true });
			fs.rmSync(this.manifestPath, { force: true });
			return;
		}

		try {
			if (manifest.state === "swap-pending") {
				removeSqliteArtifacts(manifest.liveIndexPath);
				if (fs.existsSync(manifest.previousIndexPath)) {
					moveSqliteArtifacts(manifest.previousIndexPath, manifest.liveIndexPath);
				}
			}
			removeSqliteArtifacts(manifest.temporaryIndexPath);
			for (const backup of [...manifest.backups].reverse()) {
				if (!fs.existsSync(backup.backupPath)) continue;
				fs.mkdirSync(path.dirname(backup.sourcePath), { recursive: true });
				fs.rmSync(backup.sourcePath, { force: true });
				fs.renameSync(backup.backupPath, backup.sourcePath);
			}
		} finally {
			removeSqliteArtifacts(manifest.previousIndexPath);
			fs.rmSync(this.backupDirectory, { recursive: true, force: true });
			fs.rmSync(this.manifestPath, { force: true });
		}
	}
}

function stageReporter(
	report: ProgressReporter,
	stage: string,
	offset: number,
	stageTotal: number,
	total: number,
): ProgressReporter {
	return ({ current, detail }) =>
		report({
			stage,
			current: offset + Math.min(Math.max(current, 0), stageTotal),
			total,
			detail,
		});
}

async function applyIdTranslations(
	translations: Map<string, string>,
	questFiles: readonly string[],
	categoryFiles: readonly CategoryFile[],
	report: ProgressReporter,
	transaction: MutationTransaction,
): Promise<{
	updatedQuestFiles: number;
	updatedQuestLines: number;
	updatedCategoryFiles: number;
	updatedCategoryItems: number;
}> {
	let updatedQuestFiles = 0;
	let updatedQuestLines = 0;
	let updatedCategoryFiles = 0;
	let updatedCategoryItems = 0;
	let current = 0;

	for (const filePath of questFiles) {
		const name = path
			.relative(path.dirname(questFiles[0] || filePath), filePath)
			.split(path.sep)
			.join("/");
		try {
			const document = JSON.parse(
				fs.readFileSync(filePath, "utf-8"),
			) as JsonRecord;
			let changed = 0;

			for (const row of readDialogueRows(document)) {
				const updateText = (item: JsonRecord) => {
					if (!item.text_key) return;
					const importedContent = translations.get(String(item.text_key));
					if (importedContent === undefined) return;
					const content =
						importedContent === englishText(item) ? "" : importedContent;
					if (item.text_id !== content || item.text_id_mt !== content) {
						item.text_id = content;
						item.text_id_mt = content;
						changed++;
					}
				};

				updateText(row);
				for (const option of (Array.isArray(row.options)
					? row.options
					: []) as JsonRecord[]) {
					updateText(option);
				}
			}

			if (changed > 0) {
				transaction.backupBeforeWrite(filePath);
				writeJson(filePath, document);
				updatedQuestFiles++;
				updatedQuestLines += changed;
			}
		} catch (error) {
			console.warn(`[ops] Skipping quest translation import for ${name}:`, error);
		}
		current++;
		report({
			stage: "apply",
			current,
			total: questFiles.length + categoryFiles.length,
			detail: name,
		});
		await yieldToEventLoop();
	}

	for (const file of categoryFiles) {
		try {
			const document = JSON.parse(
				fs.readFileSync(file.filePath, "utf-8"),
			) as Record<string, JsonRecord>;
			let changed = 0;
			for (const [key, item] of Object.entries(document)) {
				const importedContent = translations.get(key);
				if (importedContent === undefined) continue;
				const content =
					importedContent === englishText(item) ? "" : importedContent;
				if (item.id !== content || item.text_id !== content) {
					item.id = content;
					item.text_id = content;
					changed++;
				}
			}

			if (changed > 0) {
				transaction.backupBeforeWrite(file.filePath);
				writeJson(file.filePath, document);
				updatedCategoryFiles++;
				updatedCategoryItems += changed;
			}
		} catch (error) {
			console.warn(
				`[ops] Skipping category translation import for ${file.name}:`,
				error,
			);
		}
		current++;
		report({
			stage: "apply",
			current,
			total: questFiles.length + categoryFiles.length,
			detail: file.name,
		});
		await yieldToEventLoop();
	}

	return {
		updatedQuestFiles,
		updatedQuestLines,
		updatedCategoryFiles,
		updatedCategoryItems,
	};
}

async function clearIdTranslations(
	questFiles: readonly string[],
	categoryFiles: readonly CategoryFile[],
	report: ProgressReporter,
	transaction: MutationTransaction,
): Promise<{
	updatedQuestFiles: number;
	updatedQuestLines: number;
	updatedCategoryFiles: number;
	updatedCategoryItems: number;
}> {
	let updatedQuestFiles = 0;
	let updatedQuestLines = 0;
	let updatedCategoryFiles = 0;
	let updatedCategoryItems = 0;
	let current = 0;

	for (const filePath of questFiles) {
		try {
			const document = JSON.parse(
				fs.readFileSync(filePath, "utf-8"),
			) as JsonRecord;
			let changed = 0;
			const clearText = (item: JsonRecord) => {
				const hadTranslation =
					(item.text_id !== undefined && item.text_id !== "") ||
					(item.text_id_mt !== undefined && item.text_id_mt !== "");
				if (!hadTranslation) return;
				item.text_id = "";
				item.text_id_mt = "";
				changed++;
			};

			for (const row of readDialogueRows(document)) {
				clearText(row);
				for (const option of (Array.isArray(row.options)
					? row.options
					: []) as JsonRecord[]) {
					clearText(option);
				}
			}

			if (changed > 0) {
				transaction.backupBeforeWrite(filePath);
				writeJson(filePath, document);
				updatedQuestFiles++;
				updatedQuestLines += changed;
			}
		} catch (error) {
			console.warn(
				`[ops] Skipping quest translation reset for ${filePath}:`,
				error,
			);
		}
		current++;
		report({
			stage: "clear",
			current,
			total: questFiles.length + categoryFiles.length,
			detail: path.basename(filePath),
		});
		await yieldToEventLoop();
	}

	for (const file of categoryFiles) {
		try {
			const document = JSON.parse(
				fs.readFileSync(file.filePath, "utf-8"),
			) as Record<string, JsonRecord>;
			let changed = 0;
			for (const item of Object.values(document)) {
				const hadTranslation =
					(item.id !== undefined && item.id !== "") ||
					(item.text_id !== undefined && item.text_id !== "");
				if (!hadTranslation) continue;
				item.id = "";
				item.text_id = "";
				changed++;
			}

			if (changed > 0) {
				transaction.backupBeforeWrite(file.filePath);
				writeJson(file.filePath, document);
				updatedCategoryFiles++;
				updatedCategoryItems += changed;
			}
		} catch (error) {
			console.warn(
				`[ops] Skipping category translation reset for ${file.name}:`,
				error,
			);
		}
		current++;
		report({
			stage: "clear",
			current,
			total: questFiles.length + categoryFiles.length,
			detail: file.name,
		});
		await yieldToEventLoop();
	}

	return {
		updatedQuestFiles,
		updatedQuestLines,
		updatedCategoryFiles,
		updatedCategoryItems,
	};
}

function rebuildIndexes(
	report: ProgressReporter,
	transaction: MutationTransaction,
	options: Required<
		Pick<
			DatabaseJobProcessorOptions,
			"questsJsonDir" | "categoriesJsonDir" | "indexDbFile"
		>
	>,
): {
	indexedCategoryRows: number;
	indexedDialogueRows: number;
	indexedStatsRows: number;
} {
	const indexPath = transaction.createIndexFile();
	rebuildQuestSummaryIndex(indexPath, options.questsJsonDir);
	report({
		stage: "index",
		current: 1,
		total: INDEX_STAGE_COUNT,
		detail: "Quest index selesai",
	});
	const dialogueRows = rebuildDialogueIndex(indexPath, options.questsJsonDir);
	report({
		stage: "index",
		current: 2,
		total: INDEX_STAGE_COUNT,
		detail: "Dialogue index selesai",
	});
	const categoryRows = rebuildCategoryIndex(
		indexPath,
		options.categoriesJsonDir,
	);
	report({
		stage: "index",
		current: 3,
		total: INDEX_STAGE_COUNT,
		detail: "Category index selesai",
	});
	const statsRows = ensureTranslationStatsTable(
		indexPath,
		options.questsJsonDir,
	);
	report({
		stage: "index",
		current: 4,
		total: INDEX_STAGE_COUNT,
		detail: "Statistik translasi selesai",
	});
	ensureQuestSourceIndex(indexPath, options.questsJsonDir);
	report({
		stage: "index",
		current: 5,
		total: INDEX_STAGE_COUNT,
		detail: "Source index selesai",
	});
	transaction.markIndexReady();
	transaction.commitIndex();
	return {
		indexedCategoryRows: categoryRows,
		indexedDialogueRows: dialogueRows,
		indexedStatsRows: statsRows,
	};
}

export async function runDatabaseJob(
	kind: DatabaseJobKind,
	files: readonly DatabaseJobFile[],
	report: ProgressReporter,
	processorOptions: DatabaseJobProcessorOptions = {},
): Promise<DatabaseJobResult> {
	const options = {
		questsJsonDir: processorOptions.questsJsonDir ?? DEFAULT_QUESTS_JSON_DIR,
		categoriesJsonDir:
			processorOptions.categoriesJsonDir ?? DEFAULT_CATEGORIES_JSON_DIR,
		indexDbFile: processorOptions.indexDbFile ?? DEFAULT_INDEX_DB_FILE,
	};
	const questFiles = fs.existsSync(options.questsJsonDir)
		? listQuestJsonFiles(options.questsJsonDir)
		: [];
	const categoryFiles = listCategoryFiles(options.categoriesJsonDir);
	const sourceUnits = questFiles.length + categoryFiles.length;
	const uploadUnits = kind === "import" ? files.length : 0;
	const readUnits = kind === "import" ? files.length : 0;
	const totalUnits = uploadUnits + readUnits + sourceUnits + INDEX_STAGE_COUNT;
	const transactionDirectory =
		processorOptions.transactionDirectory ??
		fs.mkdtempSync(path.join(os.tmpdir(), "wuwaid-database-job-"));
	const ownsTransactionDirectory = !processorOptions.transactionDirectory;
	const transaction = new MutationTransaction(
		transactionDirectory,
		options.indexDbFile,
	);

	try {
		let updated: {
			updatedQuestFiles: number;
			updatedQuestLines: number;
			updatedCategoryFiles: number;
			updatedCategoryItems: number;
		};

		if (kind === "import") {
			const translations = new Map<string, string>();
			report({
				stage: "read",
				current: uploadUnits,
				total: totalUnits,
				detail: "Membaca database ConfigDB",
			});
			for (const [index, file] of files.entries()) {
				if (!isSqliteDatabase(file.path)) {
					throw new Error(`File '${file.name}' bukan database SQLite`);
				}
				for (const [id, content] of readConfigDbTranslations(file.path)) {
					translations.set(id, content);
				}
				report({
					stage: "read",
					current: uploadUnits + index + 1,
					total: totalUnits,
					detail: file.name,
				});
				await yieldToEventLoop();
			}
			updated = await applyIdTranslations(
				translations,
				questFiles,
				categoryFiles,
				stageReporter(
					report,
					"apply",
					uploadUnits + readUnits,
					sourceUnits,
					totalUnits,
				),
				transaction,
			);
		} else {
			updated = await clearIdTranslations(
				questFiles,
				categoryFiles,
				stageReporter(report, "clear", 0, sourceUnits, totalUnits),
				transaction,
			);
		}

		transaction.markMutated();
		const indexed = rebuildIndexes(
			stageReporter(
				report,
				"index",
				uploadUnits + readUnits + sourceUnits,
				INDEX_STAGE_COUNT,
				totalUnits,
			),
			transaction,
			options,
		);
		transaction.finalize();
		return {
			status: kind === "import" ? "imported" : "reset",
			...(kind === "import" ? { fileCount: files.length } : {}),
			...updated,
			...indexed,
		};
	} catch (error) {
		transaction.rollback();
		throw error;
	} finally {
		if (ownsTransactionDirectory) {
			fs.rmSync(transactionDirectory, { recursive: true, force: true });
		}
	}
}
