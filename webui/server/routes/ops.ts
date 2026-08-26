import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import express, { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { requireAdmin, requireTelemetryToken } from "../requestAuth.js";
import { realDataLoader } from "../realDataLoader.js";
import { databaseJobManager as defaultDatabaseJobManager } from "../databaseJobManager.js";
import { readCategoryDocument, resolveCategoryFile } from "../categoryStore.js";
import { readDialogueRows } from "../dialogueIndexStore.js";
import type { LogEntry } from "../../src/types/index.js";

export interface OpsRouterOptions {
	repoRoot?: string;
	getQuestSourceFile?: (id: string) => string | null;
	resolveCategoryFile?: typeof resolveCategoryFile;
	readCategoryDocument?: typeof readCategoryDocument;
}

export function createOpsRouter(
	jobManager = defaultDatabaseJobManager,
	options: OpsRouterOptions = {},
): Router {
	const databaseJobManager = jobManager;
	const opsRouter = Router();

	const REPO_ROOT =
		options.repoRoot ||
		path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
	const TEMP_DB_STORE = path.join(os.tmpdir(), "wuwaid-webui");
	const DB_EXPORT_TEMPLATE_DIR = path.join(REPO_ROOT, "data/db_exports/en");
	const EXPORT_DB_NAME_PATTERN = /^lang_multi_text(?:_[A-Za-z0-9-]+)*\.db$/i;
	const INDEX_DB_FILE = path.join(REPO_ROOT, "data/quests/index.db");
	const SOURCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_/-]*$/;
	const getQuestSourceFile =
		options.getQuestSourceFile ||
		((id: string) => realDataLoader.getQuestSourceFile(id));
	const resolveCategory = options.resolveCategoryFile || resolveCategoryFile;
	const readCategory = options.readCategoryDocument || readCategoryDocument;

	function getExportDbName(value: unknown): string | null {
		return typeof value === "string" &&
			value === path.basename(value) &&
			EXPORT_DB_NAME_PATTERN.test(value)
			? value
			: null;
	}

	function getImportDbName(value: unknown): string | null {
		if (
			typeof value !== "string" ||
			value.length <= ".db".length ||
			value !== path.basename(value) ||
			value.includes("\\") ||
			value.includes("\0") ||
			!/\.db$/i.test(value)
		) {
			return null;
		}
		return value;
	}

	function listExportDbs() {
		if (!fs.existsSync(DB_EXPORT_TEMPLATE_DIR)) return [];
		return fs
			.readdirSync(DB_EXPORT_TEMPLATE_DIR, { withFileTypes: true })
			.filter((entry) => entry.isFile() && EXPORT_DB_NAME_PATTERN.test(entry.name))
			.map((entry) => entry.name)
			.sort();
	}

	type ExportMode = "id" | "untranslated" | "en";

	interface ExportText {
		en: string;
		id: string;
		name: string;
	}

	type JsonRecord = Record<string, unknown>;

	function speakerName(row: JsonRecord): string {
		return String(row?.speaker_en ?? "");
	}

	function mergeExportText(
		entries: Map<string, ExportText>,
		id: unknown,
		text: Partial<ExportText>,
	) {
		if (!id) return;
		const key = String(id);
		const current = entries.get(key);
		entries.set(key, {
			en: current?.en || text.en || "",
			id: current?.id || text.id || "",
			name: current?.name || text.name || "",
		});
	}

	function addQuestExportTexts(
		entries: Map<string, ExportText>,
		document: JsonRecord,
		mode: ExportMode,
	) {
		const rows =
			mode === "untranslated" && Array.isArray(document.all_lines)
				? (document.all_lines as JsonRecord[])
				: readDialogueRows(document);
		for (const row of rows) {
			mergeExportText(entries, row.text_key, {
				en: String(row.text_en || row["text_zh-Hans"] || row.text_zh || ""),
				id: String(row.text_id || row.text_id_mt || ""),
				name: speakerName(row),
			});
			for (const option of (Array.isArray(row?.options)
				? row.options
				: []) as JsonRecord[]) {
				mergeExportText(entries, option.text_key, {
					en: String(
						option.text_en || option["text_zh-Hans"] || option.text_zh || "",
					),
					id: String(option.text_id || option.text_id_mt || ""),
					name: speakerName(option),
				});
			}
		}
	}

	function loadQuestExportTexts(
		id: string,
		mode: ExportMode,
	): Map<string, ExportText> | null {
		if (!SOURCE_NAME_PATTERN.test(id) || path.basename(id) !== id) return null;
		const filePath = getQuestSourceFile(id);
		if (!filePath) return null;

		try {
			const document = JSON.parse(
				fs.readFileSync(filePath, "utf-8"),
			) as JsonRecord;
			const entries = new Map<string, ExportText>();
			addQuestExportTexts(entries, document, mode);
			return entries;
		} catch {
			return null;
		}
	}

	function loadCategoryExportTexts(
		name: string,
	): { name: string; entries: Map<string, ExportText> } | null {
		const cleanName = name.startsWith("cat_") ? name.slice(4) : name;
		if (!SOURCE_NAME_PATTERN.test(cleanName)) return null;
		const file = resolveCategory(cleanName);
		if (!file) return null;
		const document = readCategory(file);
		if (!document) return null;

		const entries = new Map<string, ExportText>();
		for (const [id, rawItem] of Object.entries(document)) {
			const item = (rawItem || {}) as JsonRecord;
			mergeExportText(entries, id, {
				en: String(item.en || item["zh-Hans"] || item.zh || ""),
				id: String(item.id || item.text_id || item.mt || ""),
				name: String(item.name ?? ""),
			});
		}
		return { name: cleanName, entries };
	}

	function collectExportTexts(): Map<string, ExportText> {
		if (!fs.existsSync(INDEX_DB_FILE)) {
			throw new Error("Reader index is unavailable for global ConfigDB export");
		}

		let lastError: unknown;
		for (let attempt = 0; attempt < 60; attempt++) {
			const entries = new Map<string, ExportText>();
			let database: DatabaseSync | null = null;
			try {
				database = new DatabaseSync(INDEX_DB_FILE, {
					readOnly: true,
					timeout: 5000,
				});
				const dialogueRows = database
					.prepare(
						`SELECT text_key, text_en, text_id, export_name
					 FROM dialogue_key_idx
					 ORDER BY rowid`,
					)
					.all() as Array<Record<string, unknown>>;
				for (const row of dialogueRows) {
					mergeExportText(entries, row.text_key, {
						en: String(row.text_en ?? ""),
						id: String(row.text_id ?? ""),
						name: String(row.export_name ?? ""),
					});
				}

				const categoryRows = database
					.prepare(
						`SELECT key, name, text_en, text_id
					 FROM category_text_idx
					 ORDER BY rowid`,
					)
					.all() as Array<Record<string, unknown>>;
				if (dialogueRows.length === 0 || categoryRows.length === 0) {
					throw new Error("Reader index is still being rebuilt");
				}
				for (const row of categoryRows) {
					mergeExportText(entries, row.key, {
						en: String(row.text_en ?? ""),
						id: String(row.text_id ?? ""),
						name: String(row.name ?? ""),
					});
				}
				return entries;
			} catch (error) {
				lastError = error;
				const message = String(error);
				if (
					!/database (?:schema |table )?is locked|vtable constructor failed|no such table|still being rebuilt/i.test(
						message,
					)
				) {
					throw error;
				}
				const wait = new Int32Array(new SharedArrayBuffer(4));
				Atomics.wait(wait, 0, 0, 100);
			} finally {
				database?.close();
			}
		}

		throw lastError instanceof Error
			? lastError
			: new Error("Reader index remained unavailable for global ConfigDB export");
	}

	function getExportMode(value: unknown): ExportMode | null {
		if (value === undefined || value === "id") return "id";
		if (value === "untranslated") return "untranslated";
		if (value === "en") return "en";
		return null;
	}

	function selectExportTexts(
		entries: Map<string, ExportText>,
		mode: ExportMode,
	): Map<string, ExportText> {
		if (mode !== "untranslated") return entries;
		return new Map(
			[...entries].filter(([, text]) => text.id.trim().length === 0),
		);
	}

	function createIdDatabase(
		templateName: string,
		entries: Map<string, ExportText>,
		mode: ExportMode,
		restrictToEntries: boolean,
		includeName: boolean,
	) {
		fs.mkdirSync(TEMP_DB_STORE, { recursive: true });
		const template = path.join(DB_EXPORT_TEMPLATE_DIR, templateName);
		const output = path.join(
			TEMP_DB_STORE,
			`export-${process.pid}-${Date.now()}-${templateName}`,
		);
		fs.copyFileSync(template, output);

		const database = new DatabaseSync(output);
		try {
			database.exec("BEGIN");
			if (includeName) {
				const columns = database
					.prepare('PRAGMA table_info("MultiText")')
					.all() as Array<{
					name?: string;
				}>;
				const hasNameColumn = columns.some(
					(column) => column.name?.toLowerCase() === "name",
				);
				if (!hasNameColumn) {
					database.exec(
						`ALTER TABLE "MultiText" ADD COLUMN "Name" TEXT NOT NULL DEFAULT ''`,
					);
				}
			}
			const update = database.prepare(
				includeName
					? 'UPDATE "MultiText" SET "Content" = ?, "Name" = ? WHERE "Id" = ?'
					: 'UPDATE "MultiText" SET "Content" = ? WHERE "Id" = ?',
			);
			for (const [id, text] of entries) {
				const content =
					mode === "en" ? text.en : text.id.trim() ? text.id : text.en;
				if (includeName) update.run(content, text.name, id);
				else update.run(content, id);
			}
			if (restrictToEntries) {
				database.exec('CREATE TEMP TABLE "ExportIds" ("Id" TEXT PRIMARY KEY)');
				const insertId = database.prepare(
					'INSERT INTO "ExportIds" ("Id") VALUES (?)',
				);
				for (const id of entries.keys()) insertId.run(id);
				database.exec(
					'DELETE FROM "MultiText" WHERE "Id" NOT IN (SELECT "Id" FROM "ExportIds")',
				);
				database.exec('DROP TABLE "ExportIds"');
			}
			database.exec("COMMIT");
			if (restrictToEntries) database.exec("VACUUM");
			return { output };
		} catch (error) {
			try {
				database.exec("ROLLBACK");
			} catch {
				// The original template remains untouched.
			}
			fs.rmSync(output, { force: true });
			throw error;
		} finally {
			database.close();
		}
	}

	function sendGeneratedDatabase(
		res: Response,
		name: string,
		entries: Map<string, ExportText>,
		mode: ExportMode,
		restrictToEntries = false,
		templateName = "lang_multi_text.db",
		includeName = false,
	) {
		let output = "";
		try {
			const result = createIdDatabase(
				templateName,
				entries,
				mode,
				restrictToEntries,
				includeName,
			);
			output = result.output;
			res.download(output, name, (error) => {
				fs.rmSync(output, { force: true });
				if (error) {
					console.error(
						`[ops] Failed downloading generated ConfigDB ${name}:`,
						error,
					);
					if (!res.headersSent) {
						res.status(500).json({ error: "Failed to export the database file" });
					}
				}
			});
		} catch (error) {
			if (output) fs.rmSync(output, { force: true });
			console.error(`[ops] Failed exporting ConfigDB ${name}:`, error);
			res.status(500).json({ error: "Failed to generate the database file" });
		}
	}

	// GET /api/ops/databases - Available ID export templates
	opsRouter.get("/databases", (_req: Request, res: Response) => {
		res.json({ exportFiles: listExportDbs() });
	});

	function exportFileName(prefix: string, id: string, mode: ExportMode): string {
		const safeId = id.replaceAll("/", "__");
		return `${prefix}_${safeId}${mode === "id" ? "" : `_${mode}`}.db`;
	}

	// GET /api/ops/databases/export/:name - Generate a database from the English template
	opsRouter.get("/databases/export/:name", (req: Request, res: Response) => {
		if (
			!requireAdmin(req, res, "Admin login is required to export databases.")
		)
			return;
		const name = getExportDbName(req.params.name);
		const mode = getExportMode(req.query.mode);
		if (!name || !fs.existsSync(path.join(DB_EXPORT_TEMPLATE_DIR, name))) {
			res
				.status(404)
				.json({ error: `Export template '${req.params.name}' not found` });
			return;
		}
		if (!mode) {
			res.status(400).json({ error: "mode must be id, untranslated, or en" });
			return;
		}

		const entries = selectExportTexts(collectExportTexts(), mode);
		sendGeneratedDatabase(
			res,
			name,
			entries,
			mode,
			mode === "untranslated",
			name,
		);
	});

	// GET /api/ops/databases/export/quest/:id - Export one quest's text IDs
	opsRouter.get("/databases/export/quest/:id", (req: Request, res: Response) => {
		if (
			!requireAdmin(req, res, "Admin login is required to export databases.")
		)
			return;
		const mode = getExportMode(req.query.mode);
		if (!mode) {
			res.status(400).json({ error: "mode must be id, untranslated, or en" });
			return;
		}

		const id = req.params.id;
		const entries = loadQuestExportTexts(id, mode);
		if (!entries) {
			res.status(404).json({ error: `Quest '${id}' not found` });
			return;
		}
		sendGeneratedDatabase(
			res,
			exportFileName("quest", id, mode),
			selectExportTexts(entries, mode),
			mode,
			true,
			"lang_multi_text.db",
			true,
		);
	});

	// GET /api/ops/databases/export/category/:name - Export one category's text IDs
	opsRouter.get(
		"/databases/export/category/*",
		(req: Request, res: Response) => {
			if (
				!requireAdmin(
					req,
					res,
					"Admin login is required to export databases.",
				)
			)
				return;
			const mode = getExportMode(req.query.mode);
			if (!mode) {
				res.status(400).json({ error: "mode must be id, untranslated, or en" });
				return;
			}

			const categoryName = req.params[0];
			const category = loadCategoryExportTexts(categoryName);
			if (!category) {
				res.status(404).json({ error: `Category '${categoryName}' not found` });
				return;
			}
			sendGeneratedDatabase(
				res,
				exportFileName("category", category.name, mode),
				selectExportTexts(category.entries, mode),
				mode,
				true,
				"lang_multi_text.db",
				true,
			);
		},
	);

	// POST /api/ops/databases/import - Queue one SQLite ConfigDB file.
	opsRouter.post(
		"/databases/import",
		express.raw({
			type: ["application/octet-stream", "application/x-sqlite3"],
			limit: "256mb",
		}),
		(req: Request, res: Response) => {
			if (!requireAdmin(req, res, "Admin login is required to import databases."))
				return;
			const name = getImportDbName(req.query.filename);
			if (!name) {
				res.status(400).json({ error: "filename must be a simple .db filename" });
				return;
			}
			if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
				res.status(400).json({ error: "A non-empty SQLite .db file is required" });
				return;
			}
			try {
				res
					.status(202)
					.json(databaseJobManager.enqueueSingleImport(name, req.body));
			} catch (error) {
				res
					.status(400)
					.json({ error: error instanceof Error ? error.message : String(error) });
			}
		},
	);

	// POST /api/ops/databases/import-batch - Start a durable folder import batch.
	opsRouter.post("/databases/import-batch", (req: Request, res: Response) => {
		if (!requireAdmin(req, res, "Admin login is required to import databases."))
			return;
		try {
			const expectedFiles = Number(req.body?.expectedFiles);
			res.status(201).json(databaseJobManager.startImportBatch(expectedFiles));
		} catch (error) {
			res
				.status(400)
				.json({ error: error instanceof Error ? error.message : String(error) });
		}
	});

	// POST /api/ops/databases/import-batch/:id/file - Stage one batch file.
	opsRouter.post(
		"/databases/import-batch/:id/file",
		express.raw({
			type: ["application/octet-stream", "application/x-sqlite3"],
			limit: "256mb",
		}),
		(req: Request, res: Response) => {
			if (!requireAdmin(req, res, "Admin login is required to import databases."))
				return;
			const name = getImportDbName(req.query.filename);
			const index = Number(req.query.index);
			if (!name) {
				res.status(400).json({ error: "filename must be a simple .db filename" });
				return;
			}
			if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
				res.status(400).json({ error: "A non-empty SQLite .db file is required" });
				return;
			}
			try {
				res
					.status(202)
					.json(
						databaseJobManager.appendImportFile(req.params.id, index, name, req.body),
					);
			} catch (error) {
				res
					.status(400)
					.json({ error: error instanceof Error ? error.message : String(error) });
			}
		},
	);

	// POST /api/ops/databases/import-batch/:id/finish - Enqueue a staged batch.
	opsRouter.post(
		"/databases/import-batch/:id/finish",
		(req: Request, res: Response) => {
			if (!requireAdmin(req, res, "Admin login is required to import databases."))
				return;
			try {
				res.status(202).json(databaseJobManager.finishImportBatch(req.params.id));
			} catch (error) {
				res
					.status(400)
					.json({ error: error instanceof Error ? error.message : String(error) });
			}
		},
	);

	// GET /api/ops/jobs/:id - Poll an import/reset job.
	opsRouter.get("/jobs/:id", (req: Request, res: Response) => {
		if (
			!requireAdmin(
				req,
				res,
				"Admin login is required to inspect database jobs.",
			)
		)
			return;
		const job = databaseJobManager.getJob(req.params.id);
		if (!job) {
			res.status(404).json({ error: "Job tidak ditemukan" });
			return;
		}
		res.json(job);
	});

	// POST /api/ops/databases/reset-id - Queue removal of all Indonesian translations.
	opsRouter.post("/databases/reset-id", (req: Request, res: Response) => {
		if (!requireAdmin(req, res, "Admin login is required to reset translations."))
			return;
		try {
			res.status(202).json(databaseJobManager.enqueueReset());
		} catch (error) {
			res
				.status(500)
				.json({ error: error instanceof Error ? error.message : String(error) });
		}
	});

	// GET /api/ops/active or /api/admin/logs/active - Active system telemetry
	opsRouter.get(
		["/active", "/ops/active", "/admin/logs/active"],
		(_req: Request, res: Response) => {
			res.json({
				status: "online",
				activePlayers: 3420,
				heartbeatsPerMin: 184,
				errorCount24h: 3,
				warnCount24h: 14,
				updatedAt: new Date().toISOString(),
			});
		},
	);

	// GET /api/ops/players or /api/admin/logs/players - Active player heartbeats graph
	opsRouter.get(
		["/players", "/ops/players", "/admin/logs/players"],
		(_req: Request, res: Response) => {
			res.json({ heartbeats: db.heartbeats });
		},
	);

	// GET /api/ops/history or /api/admin/logs/history - System log entries
	opsRouter.get(
		["/history", "/ops/history", "/admin/logs/history"],
		(req: Request, res: Response) => {
			const level = req.query.level as string | undefined;
			const client = req.query.client as string | undefined;

			let logs: LogEntry[] = db.logEntries;

			if (level && level !== "all") {
				logs = logs.filter(
					(l: LogEntry) => l.level.toLowerCase() === level.toLowerCase(),
				);
			}

			if (client && client !== "all") {
				logs = logs.filter((l: LogEntry) =>
					l.client.toLowerCase().includes(client.toLowerCase()),
				);
			}

			res.json({ logs });
		},
	);

	// GET /api/ops/uploads or /api/admin/logs/uploads - Uploaded log archives list
	opsRouter.get(
		["/uploads", "/ops/uploads", "/admin/logs/uploads"],
		(_req: Request, res: Response) => {
			res.json({ uploads: db.uploads });
		},
	);

	// GET /api/ops/uploads/:id/files or /api/admin/logs/uploads/:id/files - Files inside archive
	opsRouter.get(
		[
			"/uploads/:id/files",
			"/ops/uploads/:id/files",
			"/admin/logs/uploads/:id/files",
		],
		(req: Request, res: Response) => {
			const id = req.params.id;
			const upload = db.uploads.find((u) => u.id === id);

			if (!upload) {
				res.status(404).json({ error: `Upload archive '${id}' not found` });
				return;
			}

			res.json({ files: upload.files });
		},
	);

	// GET /api/ops/uploads/:id/download or /api/admin/logs/uploads/:id/download - Download zip
	opsRouter.get(
		[
			"/uploads/:id/download",
			"/ops/uploads/:id/download",
			"/admin/logs/uploads/:id/download",
		],
		(req: Request, res: Response) => {
			const id = req.params.id;
			const upload = db.uploads.find((u) => u.id === id);

			if (!upload) {
				res.status(404).json({ error: `Upload archive '${id}' not found` });
				return;
			}

			res.setHeader("Content-Type", "application/zip");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="log_archive_${id}.zip"`,
			);
			res.send(Buffer.from(`Fake ZIP binary data for archive ${id}`));
		},
	);

	// POST /api/ops/logs or /api/logs - Remote log ingestion
	opsRouter.post(["/logs", "/ops/logs"], (req: Request, res: Response) => {
		if (!requireTelemetryToken(req, res)) return;
		const { level, message, client } = req.body;

		const newLog: LogEntry = {
			id: `log_${Date.now()}`,
			timestamp: new Date().toISOString(),
			level: level || "info",
			message: message || "Launcher heartbeat ping",
			client: client || "Launcher Client v1.0.8",
			clientVersion: "v1.0.8",
			deviceId: "DEV-REMOTE",
			category: "SystemTelemetry",
		};

		db.logEntries.unshift(newLog);
		res.status(201).json({ status: "ingested", log: newLog });
	});

	// POST /api/ops/heartbeat or /api/active/heartbeat - Telemetry heartbeat
	opsRouter.post(
		["/heartbeat", "/ops/heartbeat", "/active/heartbeat"],
		(req: Request, res: Response) => {
			const { playerId, appVersion } = req.body;

			res.json({
				status: "ack",
				playerId: playerId || "player_anonymous",
				appVersion: appVersion || "v1.0.8",
				serverTime: new Date().toISOString(),
			});
		},
	);

	return opsRouter;
}

export const opsRouter = createOpsRouter();
