import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { utimesSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { DatabaseJobManager } from "./databaseJobManager.js";
import { formatQaScanProgressLabel } from "../src/lib/qaProgressLabel.js";

let server: Server;
let baseUrl = "";
let fixtureRoot = "";
let db: typeof import("./db.js").db;

async function request(
	pathname: string,
	init?: RequestInit,
): Promise<Response> {
	return fetch(`${baseUrl}${pathname}`, init);
}

async function jsonRequest<T>(
	pathname: string,
	init?: RequestInit,
): Promise<{ response: Response; body: T }> {
	const response = await request(pathname, init);
	return { response, body: (await response.json()) as T };
}

function readQaItemsSnapshot(): Array<Record<string, unknown>> {
	const database = new DatabaseSync(
		path.join(fixtureRoot, "state/translation_qa.db"),
		{ readOnly: true },
	);
	try {
		return database.prepare("SELECT * FROM qa_items ORDER BY id").all() as Array<
			Record<string, unknown>
		>;
	} finally {
		database.close();
	}
}

async function getFreePort(): Promise<number> {
	const probe = createNetServer();
	await new Promise<void>((resolve, reject) => {
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => resolve());
	});
	const address = probe.address();
	if (!address || typeof address === "string") {
		probe.close();
		throw new Error("Could not determine a free TCP port.");
	}
	const port = address.port;
	await new Promise<void>((resolve, reject) => {
		probe.close((error) => (error ? reject(error) : resolve()));
	});
	return port;
}

async function waitForDatabaseJob(
	manager: DatabaseJobManager,
	id: string,
): Promise<{ status: string; error?: string }> {
	for (let attempt = 0; attempt < 120; attempt++) {
		const job = manager.getJob(id);
		assert.ok(job);
		if (job.status === "completed" || job.status === "failed") return job;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Database job ${id} did not finish in time`);
}

async function login(
	password: string,
): Promise<{ token: string; role: string }> {
	const result = await jsonRequest<{ token: string; role: string }>(
		"/api/auth/login",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password }),
		},
	);
	assert.equal(result.response.status, 200);
	return result.body;
}

async function adminLogin(): Promise<{ token: string; role: string }> {
	const result = await jsonRequest<{ token: string; role: string }>(
		"/api/auth/admin/login",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "admin" }),
		},
	);
	assert.equal(result.response.status, 200);
	return result.body;
}

before(async () => {
	fixtureRoot = await mkdtemp(path.join(tmpdir(), "wuwaid-qa-integration-"));
	await mkdir(path.join(fixtureRoot, "data/quests/quests/TestQuest"), {
		recursive: true,
	});
	await mkdir(path.join(fixtureRoot, "data/quests/quests/TestQuestTwo"), {
		recursive: true,
	});
	await mkdir(path.join(fixtureRoot, "data/quests/categories/QA"), {
		recursive: true,
	});
	await mkdir(path.join(fixtureRoot, "data/glossary"), { recursive: true });

	await writeFile(
		path.join(fixtureRoot, "data/quests/quests/TestQuest/dialogue.json"),
		JSON.stringify({
			quest_id: "test-quest",
			quest_name: "Integration Quest",
			chapter_id: 1,
			chapter_name: "Integration Chapter",
			all_lines: [
				{
					id: 1,
					text_key: "QA_Gender",
					text_en: "Hello, {Male=boy;Female=girl}.",
					text_id: "Halo, {Male=anak laki-laki;Female=anak perempuan}.",
				},
				{
					id: 2,
					text_key: "QA_Empty",
					text_en: "This translation is empty.",
					text_id: "",
				},
				{
					id: 3,
					text_key: "QA_MisalignedCurrent",
					text_en: "Only a six-pack? That's unlike you, Battier!",
					text_id:
						"Abaikan aturan itu, dan keserakahan akan menelan kita bulat-bulat. Kemungkinan dengan nyawa kita sebagai menu utama.",
				},
			],
		}),
		"utf8",
	);
	await writeFile(
		path.join(fixtureRoot, "data/quests/quests/TestQuestTwo/dialogue.json"),
		JSON.stringify({
			quest_id: "test-quest-two",
			quest_name: "Second Integration Quest",
			chapter_id: 2,
			chapter_name: "Second Integration Chapter",
			all_lines: [
				{
					id: 1,
					text_key: "QA_CrossQuestCandidate",
					text_en:
						"Ignore that rule, and greed will swallow us whole. Likely with our lives as the main course.",
					text_id:
						"Abaikan aturan itu, dan keserakahan akan menelan kita bulat-bulat. Kemungkinan dengan nyawa kita sebagai menu utama.",
				},
			],
		}),
		"utf8",
	);

	const categoryItems: Record<
		string,
		{ en: string; id: string; text_id: string }
	> = {};
	for (let index = 0; index < 10_001; index++) {
		categoryItems[`QA_Item_${String(index).padStart(5, "0")}`] = {
			en: `Item ${index}`,
			id: `Item ${index}`,
			text_id: `Item ${index}`,
		};
	}
	await writeFile(
		path.join(fixtureRoot, "data/quests/categories/QA/Items.json"),
		JSON.stringify(categoryItems),
		"utf8",
	);
	await writeFile(
		path.join(fixtureRoot, "data/glossary/glossary_draft_merged.json"),
		"{}",
		"utf8",
	);

	process.env.NODE_ENV = "development";
	process.env.WUWAID_QA_SOURCE_ROOT = fixtureRoot;
	process.env.WUWAID_QA_STATE_DIR = path.join(fixtureRoot, "state");
	process.env.WUWAID_QA_TEST_DELAY_MS = "1000";

	const importedApp = await import("./app.js");
	const importedDb = await import("./db.js");
	db = importedDb.db;
	server = createServer(importedApp.createApp());
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Integration server did not expose a port.");
	baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
	if (server) {
		server.close();
		await once(server, "close").catch(() => undefined);
	}
	await rm(fixtureRoot, { recursive: true, force: true });
});

test("session tokens preserve the legacy session accessor contract", async () => {
	const session = await login("editor");
	assert.match(session.token, /^token_\d+_[a-z0-9]{6}$/);
	const stored = db.getSession(session.token);
	assert.ok(stored);
	assert.equal(stored?.token, session.token);
	assert.equal(db.sessions.get(session.token)?.username, "Translator Editor");
});

test("QA snapshot, concurrent summary, review lock, and export limit work together", async () => {
	const initial = await jsonRequest<{
		totalItems: number;
		totalOccurrences: number;
	}>("/api/qa/summary");
	assert.equal(initial.response.status, 200);
	assert.equal(initial.body.totalItems, 10_005);
	assert.equal(initial.body.totalOccurrences, 10_005);

	const editor = await login("editor");
	const editorHeaders = { Authorization: `Bearer ${editor.token}` };
	const admin = await adminLogin();
	const adminHeaders = { Authorization: `Bearer ${admin.token}` };
	const scan = await jsonRequest<{
		id: string;
		status: string;
		error?: string;
		progress: { percent: number };
	}>("/api/qa/scan", {
		method: "POST",
		headers: adminHeaders,
	});
	assert.equal(scan.response.status, 202);
	assert.equal(scan.body.status, "running", scan.body.error);
	const progress: number[] = [scan.body.progress.percent];

	const duringScan = await jsonRequest<{ totalItems: number }>(
		"/api/qa/summary",
	);
	assert.equal(duringScan.response.status, 200);
	assert.equal(duringScan.body.totalItems, 10_005);

	const reviewItem = await jsonRequest<{ items: Array<{ id: string }> }>(
		"/api/qa/items?status=review&q=QA_Empty&page_size=1",
	);
	assert.equal(reviewItem.response.status, 200);
	const locked = await jsonRequest<{ error: string }>(
		`/api/qa/items/${reviewItem.body.items[0].id}`,
		{
			method: "PATCH",
			headers: { ...editorHeaders, "Content-Type": "application/json" },
			body: JSON.stringify({ status: "approved", comment: "blocked during scan" }),
		},
	);
	assert.equal(locked.response.status, 409);

	let job: {
		status: string;
		progress: { percent: number; current?: number; total?: number };
	} = scan.body;
	for (let attempt = 0; attempt < 60 && job.status === "running"; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		const [polled, health] = await Promise.all([
			jsonRequest<{
				status: string;
				progress: { percent: number; current?: number; total?: number };
			}>(`/api/qa/scan/${scan.body.id}`, { headers: adminHeaders }),
			request("/api/health"),
		]);
		assert.equal(health.status, 200);
		job = polled.body;
		progress.push(job.progress.percent);
	}
	assert.equal(job.status, "completed");
	assert.ok(progress.some((value) => value > 0));
	assert.equal(progress.at(-1), 100);
	for (let index = 1; index < progress.length; index++) {
		assert.ok(progress[index] >= progress[index - 1]);
	}
	// User-facing contract: polled progress carries current/total counts.
	assert.equal(typeof job.progress.current, "number");
	assert.equal(typeof job.progress.total, "number");
	assert.ok((job.progress.total ?? 0) > 0);

	const mismatch = await jsonRequest<{
		total: number;
		items: Array<{
			issues: Array<{ code: string }>;
			attachmentEvidence: Array<{
				confidence: string;
				candidates: Array<{ key: string; sameQuest: boolean }>;
			}>;
		}>;
	}>(
		"/api/qa/items?issue=attachment_mismatch&q=QA_MisalignedCurrent&page_size=1",
	);
	assert.equal(mismatch.response.status, 200);
	assert.equal(mismatch.body.total, 1);
	assert.equal(
		mismatch.body.items[0]?.issues.some(
			(issue) => issue.code === "attachment_mismatch",
		),
		true,
	);
	assert.equal(
		mismatch.body.items[0]?.attachmentEvidence[0]?.confidence,
		"high",
	);
	assert.equal(
		mismatch.body.items[0]?.attachmentEvidence[0]?.candidates[0]?.key,
		"QA_CrossQuestCandidate",
	);
	assert.equal(
		mismatch.body.items[0]?.attachmentEvidence[0]?.candidates.some(
			(candidate) =>
				candidate.key === "QA_CrossQuestCandidate" && !candidate.sameQuest,
		),
		true,
		JSON.stringify(mismatch.body.items[0]?.attachmentEvidence[0]),
	);

	const exported = await request(
		"/api/qa/export?format=csv&status=all&limit=999999",
		{
			headers: editorHeaders,
		},
	);
	assert.equal(exported.status, 200);
	assert.equal(exported.headers.get("X-Export-Returned"), "10000");
	assert.equal(exported.headers.get("X-Export-Truncated"), "true");
	await exported.body?.cancel();

	const unauthenticatedExport = await request(
		"/api/qa/export?format=json&status=all",
	);
	assert.equal(unauthenticatedExport.status, 401);

	const files = await readdir(path.join(fixtureRoot, "state"));
	assert.equal(
		files.some((file) => file.includes("translation_qa.db.tmp-")),
		false,
	);
});

test("reuses the persistent cache for category changes and matches a full scan", async () => {
	const categoryPath = path.join(
		fixtureRoot,
		"data/quests/categories/QA/Items.json",
	);
	const categoryItems = JSON.parse(
		await readFile(categoryPath, "utf8"),
	) as Record<string, { en: string; id: string; text_id: string }>;
	categoryItems.QA_Item_00000.text_id = "Terjemahan";
	categoryItems.QA_Item_10001 = {
		en: "Added item",
		id: "Item tambahan",
		text_id: "Item tambahan",
	};
	await writeFile(categoryPath, JSON.stringify(categoryItems), "utf8");

	const { TranslationQAService } = await import("./translationQa.js");
	const incrementalService = new TranslationQAService();
	const incrementalProgress: Array<{
		stage: string;
		total: number;
		detail: string;
	}> = [];
	const incrementalSummary = incrementalService.getSummary(false, (progress) => {
		incrementalProgress.push(progress);
	});
	assert.ok(
		incrementalProgress.some(
			(progress) => progress.detail === "Alignment tidak berubah",
		),
	);
	assert.equal(incrementalSummary.totalItems, 10_006);
	const incrementalItems = incrementalService.listItems({
		kind: "category",
		query: "QA_Item_10001",
		page: 1,
		pageSize: 5,
	}).items;
	assert.equal(incrementalItems.length, 1);
	const incrementalMismatch = incrementalService.listItems({
		kind: "quest",
		query: "QA_MisalignedCurrent",
		page: 1,
		pageSize: 5,
	}).items[0];
	assert.ok(
		incrementalMismatch?.attachmentEvidence[0]?.candidates.some(
			(candidate) =>
				candidate.key === "QA_CrossQuestCandidate" && !candidate.sameQuest,
		),
		JSON.stringify(incrementalMismatch?.attachmentEvidence[0]),
	);

	const stateFiles = await readdir(path.join(fixtureRoot, "state"));
	assert.ok(stateFiles.includes("translation_qa_cache.json.gz"));
	const restartedService = new TranslationQAService();
	assert.deepEqual(restartedService.getSummary(), incrementalSummary);

	const restartedCategoryItems = JSON.parse(
		await readFile(categoryPath, "utf8"),
	) as Record<string, { en: string; id: string; text_id: string }>;
	restartedCategoryItems.QA_Item_00001.text_id = "Pasca restart";
	await writeFile(categoryPath, JSON.stringify(restartedCategoryItems), "utf8");
	const restartedProgress: Array<{
		stage: string;
		total: number;
		detail: string;
	}> = [];
	const restartedSummary = restartedService.getSummary(false, (progress) => {
		restartedProgress.push(progress);
	});
	assert.ok(
		restartedProgress.some(
			(progress) => progress.detail === "Alignment tidak berubah",
		),
	);
	assert.equal(restartedSummary.totalItems, 10_006);
	const restartedSnapshot = readQaItemsSnapshot();

	const fullProgress: Array<{ stage: string; total: number; detail: string }> =
		[];
	const fullSummary = restartedService.getSummary(true, (progress) => {
		fullProgress.push(progress);
	});
	assert.ok(
		fullProgress.some(
			(progress) => progress.stage === "parse" && progress.total === 3,
		),
	);
	const fullSnapshot = readQaItemsSnapshot();
	assert.deepEqual(fullSnapshot, restartedSnapshot);
	assert.deepEqual(
		{ ...fullSummary, generatedAt: "" },
		{ ...restartedSummary, generatedAt: "" },
	);
	const fullMismatch = restartedService.listItems({
		kind: "quest",
		query: "QA_MisalignedCurrent",
		page: 1,
		pageSize: 5,
	}).items[0];
	assert.ok(
		fullMismatch?.attachmentEvidence[0]?.candidates.some(
			(candidate) =>
				candidate.key === "QA_CrossQuestCandidate" && !candidate.sameQuest,
		),
	);

	const cachePath = path.join(fixtureRoot, "state/translation_qa_cache.json.gz");
	await writeFile(cachePath, Buffer.from("corrupt cache"));
	const corruptCategoryItems = JSON.parse(
		await readFile(categoryPath, "utf8"),
	) as Record<string, { en: string; id: string; text_id: string }>;
	corruptCategoryItems.QA_Item_00002.text_id = "Corrupt cache fallback";
	await writeFile(categoryPath, JSON.stringify(corruptCategoryItems), "utf8");
	const corruptCacheProgress: Array<{
		stage: string;
		total: number;
		detail: string;
	}> = [];
	const corruptCacheSummary = new TranslationQAService().getSummary(
		false,
		(progress) => corruptCacheProgress.push(progress),
	);
	assert.ok(
		corruptCacheProgress.some(
			(progress) => progress.stage === "parse" && progress.total === 3,
		),
	);
	assert.equal(corruptCacheSummary.totalItems, fullSummary.totalItems);
	assert.notEqual(
		corruptCacheSummary.dataFingerprint,
		fullSummary.dataFingerprint,
	);

	const questPath = path.join(
		fixtureRoot,
		"data/quests/quests/TestQuestTwo/dialogue.json",
	);
	const changedQuest = JSON.parse(await readFile(questPath, "utf8")) as {
		all_lines: Array<Record<string, unknown>>;
	};
	changedQuest.all_lines[0].text_en =
		"Changed cross quest candidate text to force the safe full fallback.";
	await writeFile(questPath, JSON.stringify(changedQuest), "utf8");
	const questChangeProgress: Array<{
		stage: string;
		total: number;
		detail: string;
	}> = [];
	const questChangedService = new TranslationQAService();
	questChangedService.getSummary(false, (progress) =>
		questChangeProgress.push(progress),
	);
	assert.ok(
		questChangeProgress.some(
			(progress) => progress.stage === "parse" && progress.total === 3,
		),
	);
	const questFallbackSnapshot = readQaItemsSnapshot();
	questChangedService.getSummary(true);
	assert.deepEqual(readQaItemsSnapshot(), questFallbackSnapshot);

	await writeFile(
		path.join(fixtureRoot, "data/glossary/glossary_draft_merged.json"),
		JSON.stringify({ Added: { term: "Added", translation: "Tambahan" } }),
		"utf8",
	);
	const invalidatedService = new TranslationQAService();
	const invalidationProgress: Array<{
		stage: string;
		total: number;
		detail: string;
	}> = [];
	invalidatedService.getSummary(false, (progress) =>
		invalidationProgress.push(progress),
	);
	assert.ok(
		invalidationProgress.some(
			(progress) => progress.detail === "Alignment selesai",
		),
	);

	const previousRuleVersion = process.env.WUWAID_QA_RULE_VERSION;
	const previousScannerVersion = process.env.WUWAID_QA_SCANNER_VERSION;
	try {
		process.env.WUWAID_QA_RULE_VERSION = "integration-rule-v2";
		const ruleProgress: Array<{
			stage: string;
			total: number;
			detail: string;
		}> = [];
		new TranslationQAService().getSummary(false, (progress) =>
			ruleProgress.push(progress),
		);
		assert.ok(
			ruleProgress.some(
				(progress) => progress.stage === "parse" && progress.total === 3,
			),
		);

		process.env.WUWAID_QA_SCANNER_VERSION = "integration-scanner-v2";
		const scannerProgress: Array<{
			stage: string;
			total: number;
			detail: string;
		}> = [];
		new TranslationQAService().getSummary(false, (progress) =>
			scannerProgress.push(progress),
		);
		assert.ok(
			scannerProgress.some(
				(progress) => progress.stage === "parse" && progress.total === 3,
			),
		);
	} finally {
		if (previousRuleVersion === undefined)
			delete process.env.WUWAID_QA_RULE_VERSION;
		else process.env.WUWAID_QA_RULE_VERSION = previousRuleVersion;
		if (previousScannerVersion === undefined)
			delete process.env.WUWAID_QA_SCANNER_VERSION;
		else process.env.WUWAID_QA_SCANNER_VERSION = previousScannerVersion;
	}

	// Auditor gap: corruption WITHOUT any source change must never silently
	// serve the SQLite snapshot; the persistent cache must be validated first.
	const stableSnapshot = readQaItemsSnapshot();
	await writeFile(cachePath, Buffer.from("corrupt"));
	const corruptNoChangeProgress: Array<{ stage: string; total: number }> = [];
	const corruptNoChangeSummary = new TranslationQAService().getSummary(
		false,
		(progress) => corruptNoChangeProgress.push(progress),
	);
	assert.ok(
		corruptNoChangeProgress.some(
			(progress) => progress.stage === "parse" && progress.total === 3,
		),
	);
	assert.equal(corruptNoChangeSummary.totalItems, fullSummary.totalItems);
	assert.deepEqual(readQaItemsSnapshot(), stableSnapshot);

	// A MISSING cache file must force the same full-scan fallback.
	await rm(cachePath);
	const missingCacheProgress: Array<{ stage: string; total: number }> = [];
	new TranslationQAService().getSummary(false, (progress) =>
		missingCacheProgress.push(progress),
	);
	assert.ok(
		missingCacheProgress.some(
			(progress) => progress.stage === "parse" && progress.total === 3,
		),
	);

	// Valid gzip wrapping garbage JSON is structurally invalid too.
	await writeFile(cachePath, gzipSync(Buffer.from("not json")));
	const structuralProgress: Array<{ stage: string; total: number }> = [];
	new TranslationQAService().getSummary(false, (progress) =>
		structuralProgress.push(progress),
	);
	assert.ok(
		structuralProgress.some(
			(progress) => progress.stage === "parse" && progress.total === 3,
		),
	);

	// Content fingerprints: a SAME-SIZE source edit whose mtime is restored to
	// its previous value must still trigger a rescan and change QA results.
	const sameSizeItems = JSON.parse(
		await readFile(categoryPath, "utf8"),
	) as Record<string, { en: string; id: string; text_id: string }>;
	sameSizeItems.QA_Item_00003.text_id = "Item XXXXX";
	await writeFile(categoryPath, JSON.stringify(sameSizeItems), "utf8");
	utimesSync(categoryPath, new Date(0), new Date(0));
	const sameSizeProgress: Array<{ stage: string }> = [];
	new TranslationQAService().getSummary(false, (progress) =>
		sameSizeProgress.push(progress),
	);
	assert.ok(sameSizeProgress.some((progress) => progress.stage === "parse"));
	const sameSizeRow = readQaItemsSnapshot().find(
		(row) => row.key === "QA_Item_00003",
	);
	assert.equal(sameSizeRow?.target_text, "Item XXXXX");

	// Auditor repro, WARM PATH: the SAME service instance that previously served
	// the snapshot must not tolerate an invalid cache on later requests.
	const warmBaselineProgress: Array<{ stage: string }> = [];
	restartedService.getSummary(false, (progress) =>
		warmBaselineProgress.push(progress),
	);
	assert.equal(
		warmBaselineProgress.filter((progress) => progress.stage === "parse").length,
		0,
	);

	await writeFile(cachePath, Buffer.from("corrupt"));
	const warmCorruptProgress: Array<{ stage: string; total: number }> = [];
	restartedService.getSummary(false, (progress) =>
		warmCorruptProgress.push(progress),
	);
	assert.ok(
		warmCorruptProgress.some(
			(progress) => progress.stage === "parse" && progress.total === 3,
		),
	);

	// Parseable cache with empty coverage must also force a full rescan.
	const tampered = JSON.parse(
		gunzipSync(await readFile(cachePath)).toString("utf8"),
	) as { files: Record<string, unknown> };
	tampered.files = {};
	await writeFile(cachePath, gzipSync(Buffer.from(JSON.stringify(tampered))));
	const warmCoverageProgress: Array<{ stage: string; total: number }> = [];
	restartedService.getSummary(false, (progress) =>
		warmCoverageProgress.push(progress),
	);
	assert.ok(
		warmCoverageProgress.some(
			(progress) => progress.stage === "parse" && progress.total === 3,
		),
	);

	// Auditor repro refinement: ONLY category entries missing from an otherwise
	// parseable cache must still force a TRUE full alignment scan — not an
	// incremental pass that reports "Alignment tidak berubah".
	const partialCoverage = JSON.parse(
		gunzipSync(await readFile(cachePath)).toString("utf8"),
	) as { files: Record<string, { sourceKind: string }> };
	for (const [relativePath, entry] of Object.entries(partialCoverage.files)) {
		if (entry.sourceKind === "category")
			delete partialCoverage.files[relativePath];
	}
	await writeFile(
		cachePath,
		gzipSync(Buffer.from(JSON.stringify(partialCoverage))),
	);
	sameSizeItems.QA_Item_00004.text_id = "Item YYYYY";
	await writeFile(categoryPath, JSON.stringify(sameSizeItems), "utf8");
	utimesSync(categoryPath, new Date(0), new Date(0));
	const partialCoverageProgress: Array<{
		stage: string;
		total: number;
		detail: string;
	}> = [];
	restartedService.getSummary(false, (progress) =>
		partialCoverageProgress.push(progress),
	);
	assert.ok(
		partialCoverageProgress.some(
			(progress) => progress.stage === "parse" && progress.total === 3,
		),
	);

	// User-facing progress labels always carry current/total when available.
	assert.equal(
		formatQaScanProgressLabel({ current: 531, total: 1105, percent: 52 }),
		"531/1105 · 52%",
	);
	assert.equal(
		formatQaScanProgressLabel({ current: 0, total: 0, percent: 100 }),
		"100%",
	);

	// The partial-coverage scan above performed full alignment work and applied
	// the source change end-to-end.
	assert.ok(
		partialCoverageProgress.some(
			(progress) => progress.detail === "Alignment selesai",
		),
	);
	assert.ok(
		!partialCoverageProgress.some(
			(progress) => progress.detail === "Alignment tidak berubah",
		),
	);
	const partialCoverageRow = readQaItemsSnapshot().find(
		(row) => row.key === "QA_Item_00004",
	);
	assert.equal(partialCoverageRow?.target_text, "Item YYYYY");

	// Auditor regression: a rule IMPLEMENTATION change (actual module bytes)
	// without any version bump must force a full scan. The shared rules module
	// at ../src/lib/translationQaRules is content-fingerprinted; append a probe
	// comment, expect a full scan (parse total=3), then restore exact bytes.
	const rulesFilePath = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../src/lib/translationQaRules.ts",
	);
	const originalRulesBytes = await readFile(rulesFilePath);
	try {
		await writeFile(
			rulesFilePath,
			Buffer.concat([
				originalRulesBytes,
				Buffer.from("\n// integration rule-bytes probe\n"),
			]),
		);
		const rulesEditProgress: Array<{ stage: string; total: number }> = [];
		new TranslationQAService().getSummary(false, (progress) =>
			rulesEditProgress.push(progress),
		);
		assert.ok(
			rulesEditProgress.some(
				(progress) => progress.stage === "parse" && progress.total === 3,
			),
		);
	} finally {
		await writeFile(rulesFilePath, originalRulesBytes);
	}
});

test("QA stays lazy across workbench and database mutation jobs", async () => {
	const { TranslationQAService, translationQaService } = await import(
		"./translationQa.js"
	);
	const stateDirectory = path.join(fixtureRoot, "state");
	const qaDatabasePath = path.join(stateDirectory, "translation_qa.db");
	const qaCachePath = path.join(stateDirectory, "translation_qa_cache.json.gz");
	const databaseBefore = await readFile(qaDatabasePath);
	const cacheBefore = await readFile(qaCachePath);
	const filesBefore = await readdir(stateDirectory);
	new TranslationQAService();
	assert.deepEqual(await readdir(stateDirectory), filesBefore);

	const mutationRoot = await mkdtemp(path.join(tmpdir(), "wuwaid-qa-mutation-"));
	try {
		const questsJsonDir = path.join(mutationRoot, "quests");
		const categoriesJsonDir = path.join(mutationRoot, "categories");
		const mutationJobs = path.join(mutationRoot, "jobs");
		const indexDbFile = path.join(mutationRoot, "index.db");
		await mkdir(questsJsonDir, { recursive: true });
		await mkdir(categoriesJsonDir, { recursive: true });
		await writeFile(
			path.join(questsJsonDir, "quest.json"),
			JSON.stringify({
				quest_id: "mutation-quest",
				all_lines: [{ id: 1, text_en: "Hello", text_id: "" }],
			}),
			"utf8",
		);
		await writeFile(
			path.join(categoriesJsonDir, "Text.json"),
			JSON.stringify({ A: { en: "A", id: "", text_id: "" } }),
			"utf8",
		);
		const importDbFile = path.join(mutationRoot, "input.db");
		const importDatabase = new DatabaseSync(importDbFile);
		try {
			importDatabase.exec(
				"CREATE TABLE MultiText (Id TEXT PRIMARY KEY, Content TEXT NOT NULL)",
			);
			importDatabase
				.prepare("INSERT INTO MultiText (Id, Content) VALUES (?, ?)")
				.run("A", "Terjemahan");
		} finally {
			importDatabase.close();
		}

		const manager = new DatabaseJobManager(mutationJobs, {
			invalidateCaches: false,
			processorOptions: { questsJsonDir, categoriesJsonDir, indexDbFile },
		});
		const importJob = manager.enqueueSingleImport(
			"input.db",
			await readFile(importDbFile),
		);
		const imported = await waitForDatabaseJob(manager, importJob.id);
		assert.equal(imported.status, "completed", imported.error);
		const resetJob = manager.enqueueReset();
		const reset = await waitForDatabaseJob(manager, resetJob.id);
		assert.equal(reset.status, "completed", reset.error);

		const originalStatuses = db.drafts.map((draft) => draft.status);
		const admin = await adminLogin();
		try {
			for (const draft of db.drafts) draft.status = "pending";
			const workbenchResponse = await request("/api/workbench/drafts/apply", {
				method: "POST",
				headers: { Authorization: `Bearer ${admin.token}` },
			});
			assert.equal(workbenchResponse.status, 200);
			assert.equal((await workbenchResponse.json()).status, "none");
		} finally {
			db.drafts.forEach((draft, index) => {
				draft.status = originalStatuses[index];
			});
		}
	} finally {
		await rm(mutationRoot, { recursive: true, force: true });
	}

	assert.deepEqual(await readFile(qaDatabasePath), databaseBefore);
	assert.deepEqual(await readFile(qaCachePath), cacheBefore);
	assert.equal(translationQaService.getScanJob("mutation-job"), null);
});

test("login preserves the legacy password-compatible response contract", async () => {
	const editor = await jsonRequest<{ role: string }>("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: "wrong-password" }),
	});
	assert.equal(editor.response.status, 200);
	assert.equal(editor.body.role, "editor");

	const admin = await jsonRequest<{ role: string }>("/api/auth/admin/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: "wrong-password" }),
	});
	assert.equal(admin.response.status, 200);
	assert.equal(admin.body.role, "admin");
});

test("production startup validates configured auth credentials", async () => {
	const port = await getFreePort();
	const probe = spawn(
		process.execPath,
		[
			path.resolve(
				path.dirname(fileURLToPath(import.meta.url)),
				"../node_modules/tsx/dist/cli.mjs",
			),
			"server/start.ts",
		],
		{
			cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
			env: {
				...process.env,
				NODE_ENV: "production",
				PORT: String(port),
				WUWAID_EDITOR_PASSWORD: "editor-secret",
				WUWAID_ADMIN_PASSWORD: "admin-secret",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	try {
		let ready = false;
		for (let attempt = 0; attempt < 200; attempt++) {
			try {
				const health = await fetch(`http://127.0.0.1:${port}/api/health`);
				if (health.ok) {
					ready = true;
					break;
				}
			} catch {
				// The probe is still starting.
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.equal(ready, true);
		const invalid = await fetch(
			`http://127.0.0.1:${port}/api/auth/admin/login`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password: "admin" }),
			},
		);
		assert.equal(invalid.status, 401);
		const response = await fetch(
			`http://127.0.0.1:${port}/api/auth/admin/login`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password: "admin-secret" }),
			},
		);
		assert.equal(response.status, 200);
	} finally {
		probe.kill("SIGTERM");
		await once(probe, "exit").catch(() => undefined);
	}
});
