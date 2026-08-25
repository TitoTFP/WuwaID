import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createApp } from "./app.js";
import { db } from "./db.js";
import {
	DatabaseJobManager,
	type DatabaseJobView,
} from "./databaseJobManager.js";
import {
	readCategoryDocument,
	resolveCategoryFile,
} from "./categoryStore.js";
import { buildReaderIndex } from "./readerIndexStore.js";

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const FIXTURE_ROOT = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"test-fixtures/export-data",
);

let server: Server;
let fixtureServer: Server;
let baseUrl = "";
let fixtureBaseUrl = "";
let adminToken = "";
const adminHeaders = () => ({ Authorization: `Bearer ${adminToken}` });

before(async () => {
	const admin = db.createSession("admin", "Ops Integration Admin");
	adminToken = admin.token;
	server = createServer(createApp());
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Export test server did not expose a port.");
	}
	baseUrl = `http://127.0.0.1:${address.port}`;

	fixtureServer = createServer(
		createApp({
			opsRouterOptions: {
				repoRoot: FIXTURE_ROOT,
				getQuestSourceFile: (id) =>
					id === "155000000"
						? path.join(FIXTURE_ROOT, "data/quests/quests/155000000/dialogue.json")
						: null,
				resolveCategoryFile: (name) =>
					resolveCategoryFile(
						name,
						path.join(FIXTURE_ROOT, "data/quests/categories"),
					),
				readCategoryDocument,
			},
		}),
	);
	fixtureServer.listen(0, "127.0.0.1");
	await once(fixtureServer, "listening");
	const fixtureAddress = fixtureServer.address();
	if (!fixtureAddress || typeof fixtureAddress === "string") {
		throw new Error("Export fixture server did not expose a port.");
	}
	fixtureBaseUrl = `http://127.0.0.1:${fixtureAddress.port}`;
});

after(async () => {
	if (adminToken) db.sessions.delete(adminToken);
	await Promise.all(
		[server, fixtureServer].map(
			(activeServer) =>
				new Promise<void>((resolve, reject) => {
					activeServer.close((error) => (error ? reject(error) : resolve()));
				}),
		),
	);
});

test("exports a committed fixture quest stored in a nested dialogue.json file", async () => {
	const response = await fetch(
		`${fixtureBaseUrl}/api/ops/databases/export/quest/155000000?mode=id`,
	);
	const body = Buffer.from(await response.arrayBuffer());

	assert.equal(response.status, 200, body.toString("utf8"));
	assert.match(
		response.headers.get("content-disposition") ?? "",
		/quest_155000000\.db/,
	);
	assert.deepEqual(body.subarray(0, 16), Buffer.from("SQLite format 3\0"));
});

test("per-source fixture exports add Name without changing templates", async () => {
	const temporaryDirectory = fs.mkdtempSync(
		path.join(os.tmpdir(), "wuwaid-name-export-test-"),
	);
	const templatePath = path.join(
		FIXTURE_ROOT,
		"data/db_exports/en/lang_multi_text.db",
	);
	const templateBefore = fs.readFileSync(templatePath);
	const modes = ["id", "untranslated", "en"] as const;

	const readRow = (body: Buffer, filename: string, id: string) => {
		const outputPath = path.join(temporaryDirectory, filename);
		fs.writeFileSync(outputPath, body);
		const database = new DatabaseSync(outputPath, { readOnly: true });
		try {
			const columns = database
				.prepare('PRAGMA table_info("MultiText")')
				.all() as Array<{ name?: string }>;
			const row = database
				.prepare('SELECT Id, Content, Name FROM "MultiText" WHERE Id = ?')
				.get(id) as { Id?: string; Content?: string; Name?: string } | undefined;
			return { columns, row };
		} finally {
			database.close();
			fs.rmSync(outputPath, { force: true });
		}
	};

	try {
		for (const mode of modes) {
			const questResponse = await fetch(
				`${fixtureBaseUrl}/api/ops/databases/export/quest/155000000?mode=${mode}`,
			);
			const questBody = Buffer.from(await questResponse.arrayBuffer());
			assert.equal(questResponse.status, 200, questBody.toString("utf8"));
			const questId =
				mode === "untranslated" ? "Character_Test_1_3" : "Character_Test_1_1";
			const quest = readRow(questBody, `quest-${mode}.db`, questId);
			assert.ok(quest.columns.some((column) => column.name === "Name"));
			assert.equal(
				quest.row?.Name,
				mode === "untranslated" ? "Narrator" : "Battier",
			);
			assert.equal(
				quest.row?.Content,
				mode === "untranslated"
					? "Untranslated phrase"
					: mode === "en"
						? "Captain Test"
						: "Kapten Uji",
			);
			if (mode !== "untranslated") {
				const option = readRow(
					questBody,
					`quest-option-${mode}.db`,
					"Character_Test_1_2",
				);
				assert.equal(option.row?.Name, "");
			}

			const categoryResponse = await fetch(
				`${fixtureBaseUrl}/api/ops/databases/export/category/export_name_test/Text?mode=${mode}`,
			);
			const categoryBody = Buffer.from(await categoryResponse.arrayBuffer());
			assert.equal(categoryResponse.status, 200, categoryBody.toString("utf8"));
			const category = readRow(
				categoryBody,
				`category-${mode}.db`,
				"AchievementGroup_1001_Name",
			);
			assert.ok(category.columns.some((column) => column.name === "Name"));
			assert.equal(category.row?.Name, "Category Name");
			assert.equal(category.row?.Content, "Category source");
			const categoryWithoutName = readRow(
				categoryBody,
				`category-without-name-${mode}.db`,
				"AchievementGroup_1002_Name",
			);
			assert.equal(categoryWithoutName.row?.Name, "");
		}
		assert.deepEqual(fs.readFileSync(templatePath), templateBefore);
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

async function waitForDatabaseJob(id: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const response = await fetch(`${baseUrl}/api/ops/jobs/${id}`);
		assert.equal(response.status, 200);
		const job = (await response.json()) as {
			status: string;
			error?: string;
			receivedFiles: number;
			expectedFiles: number;
		};
		if (job.status === "completed" || job.status === "failed") return job;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Database job ${id} did not finish in time`);
}

function createConfigDb(
	filePath: string,
	rows: Readonly<Record<string, string>>,
): void {
	const database = new DatabaseSync(filePath);
	try {
		database.exec(
			"CREATE TABLE MultiText (Id TEXT PRIMARY KEY, Content TEXT NOT NULL)",
		);
		const insert = database.prepare(
			"INSERT INTO MultiText (Id, Content) VALUES (?, ?)",
		);
		for (const [id, content] of Object.entries(rows)) insert.run(id, content);
	} finally {
		database.close();
	}
}

function createJobFixture() {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "wuwaid-database-job-fixture-"),
	);
	const questsJsonDir = path.join(root, "quests");
	const categoriesJsonDir = path.join(root, "categories");
	const jobsRoot = path.join(root, "jobs");
	const indexDbFile = path.join(root, "index.db");
	const questFile = path.join(questsJsonDir, "1.json");
	const categoryFile = path.join(categoriesJsonDir, "Text.json");
	fs.mkdirSync(questsJsonDir, { recursive: true });
	fs.mkdirSync(categoriesJsonDir, { recursive: true });
	fs.writeFileSync(
		questFile,
		JSON.stringify(
			{
				quest_id: 1,
				quest_name: "Fixture Quest",
				quest_type: 1,
				chapter_id: 1,
				chapter_name: "Fixture Chapter",
				dialogue: [
					{
						id: 1,
						text_key: "Quest_Text",
						text_en: "Hello",
						"text_zh-Hans": "Halo",
						text_id: "",
						text_id_mt: "",
						speaker_en: "Guide",
						options: [
							{
								text_key: "Quest_Option",
								text_en: "Choose",
								"text_zh-Hans": "Pilih",
								text_id: "",
								text_id_mt: "",
							},
						],
					},
				],
			},
			null,
			2,
		),
		"utf8",
	);
	fs.writeFileSync(
		categoryFile,
		JSON.stringify(
			{
				Category_Key: { en: "Category", id: "", text_id: "", name: "Category" },
			},
			null,
			2,
		),
		"utf8",
	);
	const databaseFile = path.join(root, "translations.db");
	createConfigDb(databaseFile, {
		Quest_Text: "Halo ID",
		Quest_Option: "Pilihan ID",
		Category_Key: "Kategori ID",
	});
	const manager = (options: { indexDbFile?: string } = {}) =>
		new DatabaseJobManager(jobsRoot, {
			processorOptions: {
				questsJsonDir,
				categoriesJsonDir,
				indexDbFile: options.indexDbFile ?? indexDbFile,
			},
			invalidateCaches: false,
		});
	return {
		root,
		questsJsonDir,
		categoriesJsonDir,
		jobsRoot,
		indexDbFile,
		questFile,
		categoryFile,
		databaseFile,
		manager,
	};
}

async function waitForManagerJob(manager: DatabaseJobManager, id: string) {
	const progress: number[] = [];
	for (let attempt = 0; attempt < 200; attempt++) {
		const job = manager.getJob(id);
		assert.ok(job);
		progress.push(job.progress.current);
		if (job.status === "completed" || job.status === "failed") {
			return { job, progress };
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Database job ${id} did not finish in time`);
}

function assertMonotonicProgress(progress: readonly number[]): void {
	for (let index = 1; index < progress.length; index++) {
		assert.ok(
			progress[index] >= progress[index - 1],
			`progress regressed at ${index}: ${progress[index - 1]} -> ${progress[index]}`,
		);
	}
}

test("valid single and folder jobs update sources and rebuild one consistent index", async () => {
	const fixture = createJobFixture();
	try {
		const manager = fixture.manager();
		const imported = manager.enqueueSingleImport(
			"translations.db",
			fs.readFileSync(fixture.databaseFile),
		);
		const importedResult = await waitForManagerJob(manager, imported.id);
		assert.equal(importedResult.job.status, "completed");
		assert.equal(importedResult.job.result?.status, "imported");
		assert.equal(importedResult.job.result?.updatedQuestLines, 2);
		assert.equal(importedResult.job.result?.updatedCategoryItems, 1);
		assertMonotonicProgress(importedResult.progress);
		assert.equal(
			importedResult.progress.at(-1),
			importedResult.job.progress.total,
		);

		const quest = JSON.parse(fs.readFileSync(fixture.questFile, "utf8")) as {
			dialogue: Array<{
				text_id?: string;
				options?: Array<{ text_id?: string }>;
			}>;
		};
		assert.equal(quest.dialogue[0]?.text_id, "Halo ID");
		assert.equal(quest.dialogue[0]?.options?.[0]?.text_id, "Pilihan ID");
		const category = JSON.parse(
			fs.readFileSync(fixture.categoryFile, "utf8"),
		) as {
			Category_Key?: { id?: string; text_id?: string };
		};
		assert.equal(category.Category_Key?.id, "Kategori ID");

		const indexAfterImport = new DatabaseSync(fixture.indexDbFile, {
			readOnly: true,
		});
		try {
			const page = indexAfterImport
				.prepare("SELECT text_id, options_json FROM quest_page_idx WHERE qid = ?")
				.get(1) as { text_id?: string; options_json?: string };
			assert.equal(page.text_id, "Halo ID");
			assert.match(page.options_json || "", /Pilihan ID/);
			const categoryRow = indexAfterImport
				.prepare(
					"SELECT text_id FROM category_text_idx WHERE category = ? AND key = ?",
				)
				.get("Text", "Category_Key") as { text_id?: string };
			assert.equal(categoryRow.text_id, "Kategori ID");
		} finally {
			indexAfterImport.close();
		}

		const reset = manager.enqueueReset();
		const resetResult = await waitForManagerJob(manager, reset.id);
		assert.equal(resetResult.job.status, "completed");
		assert.equal(resetResult.job.result?.status, "reset");
		assertMonotonicProgress(resetResult.progress);
		assert.equal(resetResult.progress.at(-1), resetResult.job.progress.total);
		const clearedQuest = JSON.parse(
			fs.readFileSync(fixture.questFile, "utf8"),
		) as {
			dialogue: Array<{
				text_id?: string;
				text_id_mt?: string;
				options?: Array<{ text_id?: string }>;
			}>;
		};
		assert.equal(clearedQuest.dialogue[0]?.text_id, "");
		assert.equal(clearedQuest.dialogue[0]?.text_id_mt, "");
		assert.equal(clearedQuest.dialogue[0]?.options?.[0]?.text_id, "");
		const clearedCategory = JSON.parse(
			fs.readFileSync(fixture.categoryFile, "utf8"),
		) as {
			Category_Key?: { id?: string; text_id?: string };
		};
		assert.equal(clearedCategory.Category_Key?.id, "");
		const indexAfterReset = new DatabaseSync(fixture.indexDbFile, {
			readOnly: true,
		});
		try {
			const stats = indexAfterReset
				.prepare(
					"SELECT translated, text_translated FROM translation_stats WHERE qid = ?",
				)
				.get(1) as { translated?: number; text_translated?: number };
			assert.equal(stats.translated, 0);
			assert.equal(stats.text_translated, 0);
			const categoryRow = indexAfterReset
				.prepare(
					"SELECT text_id FROM category_text_idx WHERE category = ? AND key = ?",
				)
				.get("Text", "Category_Key") as { text_id?: string };
			assert.equal(categoryRow.text_id, "");
			const summary = indexAfterReset
				.prepare("SELECT translated_count FROM categories WHERE name = ?")
				.get("Text") as { translated_count?: number };
			assert.equal(summary.translated_count, 0);
		} finally {
			indexAfterReset.close();
		}

		const batch = manager.startImportBatch(2);
		const input = fs.readFileSync(fixture.databaseFile);
		for (const [index, name] of ["one.db", "two.db"].entries()) {
			manager.appendImportFile(batch.id, index, name, input);
		}
		const folder = manager.finishImportBatch(batch.id);
		const folderResult = await waitForManagerJob(manager, folder.id);
		assert.equal(folderResult.job.status, "completed");
		assert.equal(folderResult.job.result?.fileCount, 2);
		assert.equal(folderResult.job.result?.updatedQuestLines, 2);
		assertMonotonicProgress(folderResult.progress);
	} finally {
		fs.rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("failed imports clean staged inputs but retain the error record", async () => {
	const fixture = createJobFixture();
	try {
		const manager = fixture.manager();
		const failed = manager.enqueueSingleImport(
			"invalid.db",
			Buffer.concat([
				Buffer.from("SQLite format 3\0"),
				Buffer.from("not a sqlite database"),
			]),
		);
		const result = await waitForManagerJob(manager, failed.id);
		assert.equal(result.job.status, "failed");
		assert.match(result.job.error ?? "", /file is not a database/i);

		const jobDirectory = path.join(fixture.jobsRoot, failed.id);
		assert.equal(fs.existsSync(path.join(jobDirectory, "input-0000.db")), false);
		assert.deepEqual(fs.readdirSync(jobDirectory), ["job.json"]);
		const persisted = JSON.parse(
			fs.readFileSync(path.join(jobDirectory, "job.json"), "utf8"),
		) as { status?: string; error?: string };
		assert.equal(persisted.status, "failed");
		assert.match(persisted.error ?? "", /file is not a database/i);
	} finally {
		fs.rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("rejects invalid single uploads without creating an orphan job", () => {
	const fixture = createJobFixture();
	try {
		const manager = fixture.manager();
		assert.throws(
			() => manager.enqueueSingleImport("invalid.db", Buffer.from("not SQLite")),
			/File yang diunggah bukan database SQLite/,
		);
		assert.deepEqual(fs.readdirSync(fixture.jobsRoot), []);
	} finally {
		fs.rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("HTTP valid import and reset jobs keep health responsive while polling", async () => {
	const fixture = createJobFixture();
	for (let id = 2; id <= 250; id++) {
		fs.writeFileSync(
			path.join(fixture.questsJsonDir, `${id}.json`),
			JSON.stringify(
				{
					quest_id: id,
					quest_name: `Fixture Quest ${id}`,
					quest_type: 1,
					chapter_id: 1,
					chapter_name: "Fixture Chapter",
					dialogue: [
						{
							id: 1,
							text_key: `Unused_${id}`,
							text_en: "Hello",
							"text_zh-Hans": "Halo",
							text_id: "",
							text_id_mt: "",
						},
					],
				},
				null,
				2,
			),
			"utf8",
		);
	}
	const manager = fixture.manager();
	const localServer = createServer(createApp({ databaseJobManager: manager }));
	localServer.listen(0, "127.0.0.1");
	await once(localServer, "listening");
	const address = localServer.address();
	if (!address || typeof address === "string") {
		throw new Error("Fixture job server did not expose a port.");
	}
	const fixtureBaseUrl = `http://127.0.0.1:${address.port}`;
	const progressFor = async (id: string) => {
		const progress: number[] = [];
		for (let attempt = 0; attempt < 400; attempt++) {
			const [jobResponse, healthResponse] = await Promise.all([
				fetch(`${fixtureBaseUrl}/api/ops/jobs/${id}`),
				fetch(`${fixtureBaseUrl}/api/health`),
			]);
			assert.equal(jobResponse.status, 200);
			assert.equal(healthResponse.status, 200);
			assert.equal((await healthResponse.json()).status, "ok");
			const job = (await jobResponse.json()) as DatabaseJobView;
			progress.push(job.progress.current);
			if (job.status === "completed" || job.status === "failed") {
				assert.equal(job.status, "completed", job.error);
				assert.ok(progress.length > 1, "job should expose multiple polling states");
				assertMonotonicProgress(progress);
				return job;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error(`HTTP database job ${id} did not finish in time`);
	};
	try {
		const body = fs.readFileSync(fixture.databaseFile);
		const startedAt = Date.now();
		const importResponse = await fetch(
			`${fixtureBaseUrl}/api/ops/databases/import?filename=fixture.db`,
			{
				method: "POST",
				headers: { "Content-Type": "application/octet-stream", ...adminHeaders() },
				body,
			},
		);
		const accepted = (await importResponse.json()) as {
			id: string;
			status: string;
		};
		assert.equal(importResponse.status, 202);
		assert.ok(["queued", "running"].includes(accepted.status));
		assert.ok(Date.now() - startedAt < 1000);
		const imported = await progressFor(accepted.id);
		assert.equal(imported.result?.status, "imported");

		const resetResponse = await fetch(
			`${fixtureBaseUrl}/api/ops/databases/reset-id`,
			{ method: "POST", headers: adminHeaders() },
		);
		const resetAccepted = (await resetResponse.json()) as {
			id: string;
			status: string;
		};
		assert.equal(resetResponse.status, 202);
		assert.ok(["queued", "running"].includes(resetAccepted.status));
		const reset = await progressFor(resetAccepted.id);
		assert.equal(reset.result?.status, "reset");
	} finally {
		await new Promise<void>((resolve, reject) =>
			localServer.close((error) => (error ? reject(error) : resolve())),
		);
		fs.rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("resumes a staged batch after manager restart", async () => {
	const fixture = createJobFixture();
	try {
		const initialManager = fixture.manager();
		const batch = initialManager.startImportBatch(2);
		const body = fs.readFileSync(fixture.databaseFile);
		initialManager.appendImportFile(batch.id, 0, "one.db", body);

		const restartedManager = fixture.manager();
		const staged = restartedManager.getJob(batch.id);
		assert.equal(staged?.status, "staging");
		assert.equal(staged?.receivedFiles, 1);
		restartedManager.appendImportFile(batch.id, 1, "two.db", body);
		const queued = restartedManager.finishImportBatch(batch.id);
		const result = await waitForManagerJob(restartedManager, queued.id);
		assert.equal(result.job.status, "completed");
		assert.equal(result.job.result?.fileCount, 2);
		assertMonotonicProgress(result.progress);
	} finally {
		fs.rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("recovers a valid running job after restart and preserves progress semantics", async () => {
	const fixture = createJobFixture();
	const id = "00000000-0000-4000-8000-000000000002";
	const jobDirectory = path.join(fixture.jobsRoot, id);
	const inputPath = path.join(jobDirectory, "input-0000.db");
	fs.mkdirSync(jobDirectory, { recursive: true });
	fs.copyFileSync(fixture.databaseFile, inputPath);
	fs.writeFileSync(
		path.join(jobDirectory, "job.json"),
		JSON.stringify({
			id,
			kind: "import",
			status: "running",
			createdAt: new Date(0).toISOString(),
			updatedAt: new Date(0).toISOString(),
			expectedFiles: 1,
			files: [{ name: "recovered.db", path: inputPath }],
			progress: { stage: "apply", current: 1, total: 1 },
			attempts: 1,
		}),
	);
	try {
		const manager = fixture.manager();
		assert.equal(manager.getJob(id)?.status, "queued");
		assert.equal(manager.getJob(id)?.progress.stage, "recovery");
		const result = await waitForManagerJob(manager, id);
		assert.equal(result.job.status, "completed");
		assertMonotonicProgress(result.progress);
		const quest = JSON.parse(fs.readFileSync(fixture.questFile, "utf8")) as {
			dialogue: Array<{ text_id?: string }>;
		};
		assert.equal(quest.dialogue[0]?.text_id, "Halo ID");
	} finally {
		fs.rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("rolls back source JSON and preserves the previous index on rebuild failure", async () => {
	const fixture = createJobFixture();
	buildReaderIndex(fixture.indexDbFile, {
		force: true,
		questsJsonDir: fixture.questsJsonDir,
		categoriesJsonDir: fixture.categoriesJsonDir,
	});
	const originalIndex = fs.readFileSync(fixture.indexDbFile);
	const category = JSON.parse(
		fs.readFileSync(fixture.categoryFile, "utf8"),
	) as Record<string, unknown>;
	category.Broken = null;
	fs.writeFileSync(
		fixture.categoryFile,
		JSON.stringify(category, null, 2),
		"utf8",
	);
	const categoryBeforeJob = fs.readFileSync(fixture.categoryFile);
	const originalQuest = fs.readFileSync(fixture.questFile);
	try {
		const manager = fixture.manager();
		const job = manager.enqueueSingleImport(
			"translations.db",
			fs.readFileSync(fixture.databaseFile),
		);
		const result = await waitForManagerJob(manager, job.id);
		assert.equal(result.job.status, "failed");
		assert.match(result.job.error || "", /null|index/i);
		assert.deepEqual(fs.readFileSync(fixture.questFile), originalQuest);
		assert.deepEqual(fs.readFileSync(fixture.categoryFile), categoryBeforeJob);
		assert.deepEqual(fs.readFileSync(fixture.indexDbFile), originalIndex);
		const jobDirectory = path.join(fixture.jobsRoot, job.id);
		for (const artifact of [
			"transaction.json",
			"backups",
			"rebuilt-index.db",
			"previous-index.db",
		]) {
			assert.equal(
				fs.existsSync(path.join(jobDirectory, artifact)),
				false,
				artifact,
			);
		}
	} finally {
		fs.rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("queues a single import and keeps health responsive", async () => {
	const response = await fetch(
		`${baseUrl}/api/ops/databases/import?filename=invalid-job.db`,
		{
			method: "POST",
			headers: { "Content-Type": "application/octet-stream", ...adminHeaders() },
			body: Buffer.concat([
				Buffer.from("SQLite format 3"),
				Buffer.from([0]),
				Buffer.from("not-a-database"),
			]),
		},
	);
	const accepted = (await response.json()) as { id: string; status: string };
	assert.equal(response.status, 202);
	assert.ok(["queued", "running"].includes(accepted.status));

	const health = await fetch(`${baseUrl}/api/health`);
	assert.equal(health.status, 200);
	const finished = await waitForDatabaseJob(accepted.id);
	assert.equal(finished.status, "failed");
	assert.match(finished.error || "", /not a database/i);
	fs.rmSync(path.join(REPO_ROOT, "webui/data/database_jobs", accepted.id), {
		recursive: true,
		force: true,
	});
});

test("stages a folder import and enqueues one batch job", async () => {
	const start = await fetch(`${baseUrl}/api/ops/databases/import-batch`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...adminHeaders() },
		body: JSON.stringify({ expectedFiles: 2 }),
	});
	const batch = (await start.json()) as { id: string; status: string };
	assert.equal(start.status, 201);
	assert.equal(batch.status, "staging");

	for (const [index, filename] of ["first.db", "second.db"].entries()) {
		const upload = await fetch(
			`${baseUrl}/api/ops/databases/import-batch/${batch.id}/file?filename=${filename}&index=${index}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/octet-stream", ...adminHeaders() },
				body: Buffer.concat([
					Buffer.from("SQLite format 3"),
					Buffer.from([0]),
					Buffer.from("not-a-database"),
				]),
			},
		);
		assert.equal(upload.status, 202);
	}

	const finish = await fetch(
		`${baseUrl}/api/ops/databases/import-batch/${batch.id}/finish`,
		{ method: "POST", headers: adminHeaders() },
	);
	const queued = (await finish.json()) as {
		id: string;
		status: string;
		receivedFiles: number;
		expectedFiles: number;
	};
	assert.equal(finish.status, 202);
	assert.equal(queued.id, batch.id);
	assert.equal(queued.receivedFiles, 2);
	assert.equal(queued.expectedFiles, 2);
	assert.ok(["queued", "running"].includes(queued.status));
	const finished = await waitForDatabaseJob(batch.id);
	assert.equal(finished.status, "failed");
	fs.rmSync(path.join(REPO_ROOT, "webui/data/database_jobs", batch.id), {
		recursive: true,
		force: true,
	});
});

test("serializes database mutation jobs", async () => {
	const temporaryRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "wuwaid-database-job-queue-"),
	);
	const invalidDatabase = () =>
		Buffer.concat([
			Buffer.from("SQLite format 3"),
			Buffer.from([0]),
			Buffer.from("not-a-database"),
		]);
	try {
		const manager = new DatabaseJobManager(temporaryRoot);
		const first = manager.enqueueSingleImport("first.db", invalidDatabase());
		const second = manager.enqueueSingleImport("second.db", invalidDatabase());
		assert.equal(first.status, "running");
		assert.equal(second.status, "queued");
		for (let attempt = 0; attempt < 100; attempt++) {
			const firstStatus = manager.getJob(first.id)?.status;
			const secondStatus = manager.getJob(second.id)?.status;
			if (firstStatus === "failed" && secondStatus === "failed") break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		assert.equal(manager.getJob(first.id)?.status, "failed");
		assert.equal(manager.getJob(second.id)?.status, "failed");
	} finally {
		fs.rmSync(temporaryRoot, { recursive: true, force: true });
	}
});

test("database job manager waits for an active writer lock and reclaims stale locks", async () => {
	const temporaryRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "wuwaid-database-job-lock-"),
	);
	const lockPath = path.join(temporaryRoot, ".writer.lock");
	const invalidDatabase = Buffer.concat([
		Buffer.from("SQLite format 3"),
		Buffer.from([0]),
		Buffer.from("not-a-database"),
	]);
	try {
		fs.writeFileSync(
			lockPath,
			JSON.stringify({ pid: process.pid, token: "active-owner", startedAt: new Date().toISOString() }),
		);
		const manager = new DatabaseJobManager(temporaryRoot);
		const waiting = manager.enqueueSingleImport("waiting.db", invalidDatabase);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(manager.getJob(waiting.id)?.status, "queued");

		fs.rmSync(lockPath, { force: true });
		for (let attempt = 0; attempt < 100; attempt++) {
			if (manager.getJob(waiting.id)?.status === "failed") break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		assert.equal(manager.getJob(waiting.id)?.status, "failed");

		fs.writeFileSync(
			lockPath,
			JSON.stringify({ pid: 999999999, token: "dead-owner", startedAt: new Date(0).toISOString() }),
		);
		fs.utimesSync(lockPath, new Date(0), new Date(0));
		const stale = manager.enqueueSingleImport("stale.db", invalidDatabase);
		for (let attempt = 0; attempt < 100; attempt++) {
			if (manager.getJob(stale.id)?.status === "failed") break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		assert.equal(manager.getJob(stale.id)?.status, "failed");
	} finally {
		fs.rmSync(temporaryRoot, { recursive: true, force: true });
	}
});

test("recovers a running database job after manager restart", async () => {
	const temporaryRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "wuwaid-database-job-recovery-"),
	);
	const id = "00000000-0000-4000-8000-000000000001";
	const jobDirectory = path.join(temporaryRoot, id);
	const inputPath = path.join(jobDirectory, "input-0000.db");
	fs.mkdirSync(jobDirectory, { recursive: true });
	fs.writeFileSync(
		inputPath,
		Buffer.concat([
			Buffer.from("SQLite format 3"),
			Buffer.from([0]),
			Buffer.from("not-a-database"),
		]),
	);
	const timestamp = new Date(0).toISOString();
	fs.writeFileSync(
		path.join(jobDirectory, "job.json"),
		JSON.stringify({
			id,
			kind: "import",
			status: "running",
			createdAt: timestamp,
			updatedAt: timestamp,
			expectedFiles: 1,
			files: [{ name: "recovered.db", path: inputPath }],
			progress: { stage: "apply", current: 0, total: 1 },
			attempts: 1,
		}),
	);

	try {
		const manager = new DatabaseJobManager(temporaryRoot);
		const recovered = manager.getJob(id);
		assert.equal(recovered?.status, "queued");
		assert.equal(recovered?.progress.stage, "recovery");
		let finished: DatabaseJobView | null = recovered;
		for (let attempt = 0; attempt < 100; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 25));
			finished = manager.getJob(id);
			if (finished?.status === "failed") break;
		}
		assert.equal(finished?.status, "failed");
		assert.match(finished?.error || "", /not a database/i);
	} finally {
		fs.rmSync(temporaryRoot, { recursive: true, force: true });
	}
});

test("global ConfigDB export uses the committed SQLite read model fixture", async () => {
	const temporaryDirectory = fs.mkdtempSync(
		path.join(os.tmpdir(), "wuwaid-global-export-test-"),
	);
	const outputPath = path.join(temporaryDirectory, "export.db");
	const originalReadFileSync = fs.readFileSync;
	const guardedReadFileSync = (
		...args: Parameters<typeof originalReadFileSync>
	) => {
		const filePath = String(args[0]);
		const stack = new Error().stack || "";
		if (
			filePath.includes(`${path.sep}data${path.sep}quests${path.sep}`) &&
			stack.includes("collectExportTexts")
		) {
			throw new Error("Global export must not read raw quest/category JSON");
		}
		return originalReadFileSync(...args);
	};
	fs.readFileSync = guardedReadFileSync as typeof fs.readFileSync;

	try {
		const response = await fetch(
			`${fixtureBaseUrl}/api/ops/databases/export/lang_multi_text.db?mode=id`,
		);
		const body = Buffer.from(await response.arrayBuffer());
		assert.equal(response.status, 200, body.toString("utf8"));
		fs.writeFileSync(outputPath, body);
		const database = new DatabaseSync(outputPath, { readOnly: true });
		try {
			const columns = database
				.prepare('PRAGMA table_info("MultiText")')
				.all() as Array<{ name?: string }>;
			assert.ok(!columns.some((column) => column.name?.toLowerCase() === "name"));
			const row = database
				.prepare("SELECT Content FROM MultiText WHERE Id = ?")
				.get("Global_Test_1") as { Content?: string } | undefined;
			assert.equal(row?.Content, "Global ID");
		} finally {
			database.close();
		}
	} finally {
		fs.readFileSync = originalReadFileSync;
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});
