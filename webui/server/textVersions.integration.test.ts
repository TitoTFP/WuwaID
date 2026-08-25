import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import test, { after, before } from "node:test";
import { createApp } from "./app.js";
import {
	createTextVersionFromSource,
	getTextVersionDiff,
	getTextVersionGroups,
	invalidateTextVersionWorkingSet,
	exportStructuredTextDiff,
	exportTextVersionCsv,
	exportTextVersionSqlite,
	TEXT_VERSION_HISTORY_PATH,
	VERSION_WORKING,
	type TextVersion,
} from "./textVersions.js";

const runPrefix = `__test_text_versions_${process.pid}_${Date.now()}`;
const hasZipTools =
	spawnSync("zip", ["-v"], { stdio: "ignore" }).status === 0 &&
	spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0;

let fixtureRoot = "";
let baseVersion: TextVersion;
let targetVersion: TextVersion;
let server: Server;
let baseUrl = "";

async function writeDataset(
	root: string,
	category: Record<string, unknown>,
	quest: Record<string, unknown>,
	newCategory?: Record<string, unknown>,
): Promise<void> {
	await mkdir(path.join(root, "categories/Ui"), { recursive: true });
	await mkdir(path.join(root, "quests"), { recursive: true });
	await writeFile(
		path.join(root, "categories/Ui/Text.json"),
		JSON.stringify(category),
		"utf8",
	);
	if (newCategory) {
		await mkdir(path.join(root, "categories/New"), { recursive: true });
		await writeFile(
			path.join(root, "categories/New/More.json"),
			JSON.stringify(newCategory),
			"utf8",
		);
	}
	await writeFile(
		path.join(root, "quests/quest.json"),
		JSON.stringify(quest),
		"utf8",
	);
}

function removeTestVersions(): void {
	if (!fs.existsSync(TEXT_VERSION_HISTORY_PATH)) return;
	const database = new DatabaseSync(TEXT_VERSION_HISTORY_PATH, {
		timeout: 5000,
	});
	try {
		database.exec("PRAGMA foreign_keys = ON");
		const rows = database
			.prepare("SELECT id FROM versions WHERE tag LIKE ?")
			.all(`${runPrefix}%`) as Array<{ id: number }>;
		for (const row of rows) {
			database
				.prepare("DELETE FROM version_rows WHERE version_id = ?")
				.run(row.id);
			database.prepare("DELETE FROM versions WHERE id = ?").run(row.id);
		}
	} finally {
		database.close();
		invalidateTextVersionWorkingSet();
	}
}

before(async () => {
	fixtureRoot = await mkdtemp(path.join(tmpdir(), "wuwaid-text-versions-"));
	const baseRoot = path.join(fixtureRoot, "base");
	const targetRoot = path.join(fixtureRoot, "target");

	await writeDataset(
		baseRoot,
		{
			Category_Changed: { en: "Old category", "zh-Hans": "旧分类", ja: "旧分類" },
			Category_Removed: { en: "Removed category", "zh-Hans": "删除", ja: "削除" },
		},
		{
			quest_id: "quest-1",
			dialogue: [
				{
					text_key: "Quest_Changed",
					text_en: "Old quest",
					"text_zh-Hans": "旧任务",
					text_ja: "旧クエスト",
					speaker_en: "Guide",
				},
				{
					text_key: "Quest_Removed",
					text_en: "Gone quest",
					"text_zh-Hans": "消失任务",
					text_ja: "削除クエスト",
				},
			],
		},
	);
	await writeDataset(
		targetRoot,
		{
			Category_Changed: {
				en: "New category",
				"zh-Hans": "新分类",
				ja: "新分類",
			},
		},
		{
			quest_id: "quest-1",
			dialogue: [
				{
					text_key: "Quest_Changed",
					text_en: "New quest, with comma",
					"text_zh-Hans": "新任务",
					text_ja: "新クエスト",
					speaker_en: "Guide",
				},
				{
					text_key: "Quest_Added",
					text_en: "Added quest",
					"text_zh-Hans": "新增任务",
					text_ja: "追加クエスト",
				},
			],
		},
		{
			Category_Added: {
				en: "Added category",
				"zh-Hans": "新增分类",
				ja: "追加分類",
			},
		},
	);

	baseVersion = createTextVersionFromSource(
		`${runPrefix}-base`,
		"base fixture",
		baseRoot,
	);
	targetVersion = createTextVersionFromSource(
		`${runPrefix}-target`,
		"target fixture",
		targetRoot,
	);

	server = createServer(createApp());
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Text version test server did not expose a port.");
	}
	baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
	if (server) {
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	}
	removeTestVersions();
	await rm(fixtureRoot, { recursive: true, force: true });
});

test("snapshots expose row diffs and groups", () => {
	const diff = getTextVersionDiff({
		base: baseVersion.tag,
		target: targetVersion.tag,
		language: "en",
		page: 1,
		pageSize: 20,
	});
	assert.deepEqual(diff.summary, { added: 2, removed: 2, changed: 2 });
	assert.equal(diff.total, 6);
	assert.deepEqual(
		diff.items.map((item) => [item.status, item.text_id]),
		[
			["added", "Category_Added"],
			["changed", "Category_Changed"],
			["removed", "Category_Removed"],
			["added", "Quest_Added"],
			["changed", "Quest_Changed"],
			["removed", "Quest_Removed"],
		],
	);

	const filtered = getTextVersionDiff({
		base: baseVersion.tag,
		target: targetVersion.tag,
		language: "en",
		status: "changed",
		query: "new quest",
		pageSize: 1,
	});
	assert.equal(filtered.total, 1);
	assert.equal(filtered.items[0]?.text_id, "Quest_Changed");
	assert.equal(filtered.items[0]?.old_content, "Old quest");

	const groups = getTextVersionGroups({
		base: baseVersion.tag,
		target: targetVersion.tag,
		language: "en",
	});
	assert.equal(groups.exportable_rows, 4);
	assert.deepEqual(
		groups.groups.map((group) => group.group_id).sort(),
		["category:New/More", "category:Ui/Text", "quest:quest-1"].sort(),
	);
	const newGroup = groups.groups.find(
		(group) => group.group_id === "category:New/More",
	);
	assert.equal(newGroup?.is_new_group, true);
	assert.equal(newGroup?.db_path, "categories/New/More.db");
	assert.equal(
		groups.groups.find((group) => group.group_id === "quest:quest-1")?.total,
		2,
	);
});

test("snapshot exports preserve row content and grouping", async () => {
	const csv = exportTextVersionCsv(baseVersion.tag, targetVersion.tag, "en");
	assert.match(
		csv,
		/^status,Id,old_content,new_content,source_kind,source_ref\n/,
	);
	assert.match(
		csv,
		/changed,Quest_Changed,Old quest,"New quest, with comma",quest,quest-1/,
	);
	assert.match(csv, /removed,Quest_Removed,Gone quest,,quest,quest-1/);

	const sqlitePath = path.join(fixtureRoot, "diff.db");
	await writeFile(
		sqlitePath,
		exportTextVersionSqlite(baseVersion.tag, targetVersion.tag, "en"),
	);
	const database = new DatabaseSync(sqlitePath, { readOnly: true });
	try {
		const rows = database
			.prepare("SELECT Id, Name, Content FROM MultiText ORDER BY Id")
			.all() as Array<{ Id: string; Name: string; Content: string }>;
		assert.deepEqual(
			rows.map((row) => ({ ...row })),
			[
				{ Id: "Category_Added", Name: "", Content: "Added category" },
				{ Id: "Category_Changed", Name: "", Content: "New category" },
				{ Id: "Quest_Added", Name: "", Content: "Added quest" },
				{ Id: "Quest_Changed", Name: "Guide", Content: "New quest, with comma" },
			],
		);
	} finally {
		database.close();
	}

	if (hasZipTools) {
		const structured = exportStructuredTextDiff({
			base: baseVersion.tag,
			target: targetVersion.tag,
			language: "en",
			groupIds: ["quest:quest-1", "category:New/More"],
		});
		assert.equal(
			structured.filename,
			`wuwaid-${baseVersion.tag}-to-${targetVersion.tag}-en.zip`,
		);
		assert.ok(structured.buffer.length > 0);
		const archivePath = path.join(fixtureRoot, "structured.zip");
		await writeFile(archivePath, structured.buffer);
		const manifest = JSON.parse(
			execFileSync("unzip", ["-p", archivePath, "manifest.json"], {
				encoding: "utf8",
			}),
		) as { selected_group_count?: number; exported_row_count?: number };
		assert.equal(manifest.selected_group_count, 2);
		assert.equal(manifest.exported_row_count, 3);
	}
});

test("version routes require editor access and reject invalid tags", async () => {
	assert.throws(
		() =>
			createTextVersionFromSource(
				VERSION_WORKING,
				null,
				path.join(fixtureRoot, "base"),
			),
		/reserved/,
	);
	assert.throws(
		() =>
			createTextVersionFromSource(
				baseVersion.tag,
				null,
				path.join(fixtureRoot, "base"),
			),
		/immutable/,
	);

	const unauthenticated = await fetch(`${baseUrl}/api/workbench/versions`);
	assert.equal(unauthenticated.status, 401);

	const login = await fetch(`${baseUrl}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: "editor" }),
	});
	assert.equal(login.status, 200);
	const session = (await login.json()) as { token: string };
	const headers = { Authorization: `Bearer ${session.token}` };

	const versions = await fetch(`${baseUrl}/api/workbench/versions`, { headers });
	assert.equal(versions.status, 200);
	const versionBody = (await versions.json()) as { versions: TextVersion[] };
	assert.ok(
		versionBody.versions.some((version) => version.tag === baseVersion.tag),
	);

	const diff = await fetch(
		`${baseUrl}/api/workbench/versions/diff?base=${encodeURIComponent(baseVersion.tag)}&target=${encodeURIComponent(targetVersion.tag)}&lang=en`,
		{ headers },
	);
	assert.equal(diff.status, 200);
	const diffBody = (await diff.json()) as { summary: { changed: number } };
	assert.equal(diffBody.summary.changed, 2);

	const invalidLanguage = await fetch(
		`${baseUrl}/api/workbench/versions/diff?base=${encodeURIComponent(baseVersion.tag)}&target=${encodeURIComponent(targetVersion.tag)}&lang=ko`,
		{ headers },
	);
	assert.equal(invalidLanguage.status, 400);
});
