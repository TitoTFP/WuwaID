import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

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

before(async () => {
	fixtureRoot = await mkdtemp(path.join(tmpdir(), "wuwaid-qa-integration-"));
	await mkdir(path.join(fixtureRoot, "data/quests/quests/TestQuest"), {
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
						"Abaikan aturan itu, dan keserakahan akan menelan kita bulat-bulat. Kemungkinan dengan nyawa kita sebagai menu utamanya.",
				},
				{
					id: 4,
					text_key: "QA_MisalignedCandidate",
					text_en:
						"Ignore that rule, and greed will swallow us whole. Likely with our lives as the main course.",
					text_id:
						"Abaikan aturan itu, dan keserakahan akan menelan kita bulat-bulat. Kemungkinan dengan nyawa kita sebagai menu utamanya.",
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
	const authHeaders = { Authorization: `Bearer ${editor.token}` };
	const scan = await jsonRequest<{ id: string; status: string; error?: string }>(
		"/api/qa/scan",
		{
			method: "POST",
			headers: authHeaders,
		},
	);
	assert.equal(scan.response.status, 202);
	assert.equal(scan.body.status, "running", scan.body.error);

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
			headers: { ...authHeaders, "Content-Type": "application/json" },
			body: JSON.stringify({ status: "approved", comment: "blocked during scan" }),
		},
	);
	assert.equal(locked.response.status, 409);

	let job: { status: string } = scan.body;
	for (let attempt = 0; attempt < 60 && job.status === "running"; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		const polled = await jsonRequest<{ status: string }>(
			`/api/qa/scan/${scan.body.id}`,
			{
				headers: authHeaders,
			},
		);
		job = polled.body;
	}
	assert.equal(job.status, "completed");

	const mismatch = await jsonRequest<{
		total: number;
		items: Array<{
			issues: Array<{ code: string }>;
			attachmentEvidence: Array<{
				confidence: string;
				candidates: Array<{ key: string }>;
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
		"QA_MisalignedCandidate",
	);

	const exported = await request(
		"/api/qa/export?format=csv&status=all&limit=999999",
		{
			headers: authHeaders,
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

test("production startup preserves the legacy auth availability contract", async () => {
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
				WUWAID_EDITOR_PASSWORD: "",
				WUWAID_ADMIN_PASSWORD: "",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	try {
		let ready = false;
		for (let attempt = 0; attempt < 40; attempt++) {
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
		const response = await fetch(
			`http://127.0.0.1:${port}/api/auth/admin/login`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password: "admin" }),
			},
		);
		assert.equal(response.status, 200);
	} finally {
		probe.kill("SIGTERM");
		await once(probe, "exit").catch(() => undefined);
	}
});
