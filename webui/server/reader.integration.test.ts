import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createApp } from "./app.js";
import { db } from "./db.js";
import { realDataLoader } from "./realDataLoader.js";
import { rebuildCategoryIndex } from "./categoryStore.js";

const QUEST_ID = "165000004";
const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const hasRealQuestData = fs.existsSync(
	path.join(REPO_ROOT, "data/quests/index.db"),
);
let server: Server;
let baseUrl = "";

before(async () => {
	server = createServer(createApp());
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Reader test server did not expose a port.");
	}
	baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
});

test("reader overview is a single compatible initial payload", async () => {
	const response = await fetch(`${baseUrl}/api/reader/overview`);
	const body = (await response.json()) as {
		chapters?: unknown[];
		categories?: unknown[];
		metrics?: { serverStatus?: string };
	};

	assert.equal(response.status, 200);
	assert.ok(Array.isArray(body.chapters));
	assert.ok(Array.isArray(body.categories));
	assert.equal(body.metrics?.serverStatus, "online");
});

test("quest selector limits results but still finds any numeric ID by search", {
	skip: !hasRealQuestData,
}, async () => {
	const limitedResponse = await fetch(`${baseUrl}/api/reader/quests?limit=100`);
	const limited = (await limitedResponse.json()) as { quests?: unknown[] };
	assert.equal(limitedResponse.status, 200);
	assert.ok((limited.quests || []).length <= 100);

	const pageResponse = await fetch(
		`${baseUrl}/api/reader/quests?chapterId=0&page=2&pageSize=100`,
	);
	const page = (await pageResponse.json()) as {
		quests?: unknown[];
		page?: number;
		totalPages?: number;
	};
	assert.equal(pageResponse.status, 200);
	assert.equal(page.page, 2);
	assert.equal(page.quests?.length, 100);
	assert.ok((page.totalPages || 0) > 2);

	const searchResponse = await fetch(
		`${baseUrl}/api/reader/quests?q=${QUEST_ID}&limit=100`,
	);
	const search = (await searchResponse.json()) as {
		quests?: Array<{ id?: string }>;
	};
	assert.equal(searchResponse.status, 200);
	assert.ok(search.quests?.some((quest) => quest.id === QUEST_ID));
});

test("fallback quest details honor the additive page contract", async () => {
	const id = "__reader_fallback_page_test__";
	db.quests[id] = {
		id,
		chapterId: "ch_test",
		chapterTitle: "Test",
		title: { en: "Fallback", id: "Fallback" },
		type: "side",
		totalLines: 3,
		lines: [1, 2, 3].map((lineNo) => ({
			id: `line_${lineNo}`,
			lineNo,
			type: "dialogue",
			speaker: { id: "narrator", name: { en: "Narrator", id: "Narator" } },
			text: { en: `Line ${lineNo}`, id: "" },
			options:
				lineNo === 2
					? [{ id: "choice", text: { en: "Choice clue", id: "" } }]
					: undefined,
		})),
		updatedAt: new Date().toISOString(),
	};

	try {
		const response = await fetch(
			`${baseUrl}/api/reader/quests/${id}?page=2&pageSize=1`,
		);
		const body = (await response.json()) as {
			lines?: Array<{ lineNo?: number }>;
			page?: number;
			totalPages?: number;
		};
		assert.equal(response.status, 200);
		assert.equal(body.page, 2);
		assert.equal(body.totalPages, 3);
		assert.deepEqual(
			body.lines?.map((line) => line.lineNo),
			[2],
		);

		const optionSearchResponse = await fetch(
			`${baseUrl}/api/reader/quests/${id}?q=Choice%20clue`,
		);
		const optionSearchBody = (await optionSearchResponse.json()) as {
			lines?: Array<{ lineNo?: number }>;
		};
		assert.equal(optionSearchResponse.status, 200);
		assert.deepEqual(
			optionSearchBody.lines?.map((line) => line.lineNo),
			[2],
		);
	} finally {
		delete db.quests[id];
	}
});

test("extreme quest pages use indexed first and later windows", {
	skip: !hasRealQuestData,
}, async () => {
	const firstStartedAt = Date.now();
	const firstResponse = await fetch(
		`${baseUrl}/api/reader/quests/1?page=1&pageSize=2`,
	);
	const first = (await firstResponse.json()) as {
		lines?: Array<{ lineNo?: number }>;
		totalPages?: number;
	};
	assert.equal(firstResponse.status, 200);
	assert.equal(first.lines?.length, 2);
	assert.equal(first.lines?.[0]?.lineNo, 1);
	assert.ok((first.totalPages || 0) > 1000);
	assert.ok(Date.now() - firstStartedAt < 1000);

	const lastStartedAt = Date.now();
	const lastResponse = await fetch(
		`${baseUrl}/api/reader/quests/1?page=${first.totalPages}&pageSize=2`,
	);
	const last = (await lastResponse.json()) as {
		lines?: Array<{ lineNo?: number }>;
		page?: number;
		totalPages?: number;
	};
	assert.equal(lastResponse.status, 200);
	assert.equal(last.page, first.totalPages);
	assert.equal(last.totalPages, first.totalPages);
	assert.ok((last.lines || []).length > 0);
	assert.ok(Date.now() - lastStartedAt < 1000);
});

test("approved category drafts update raw JSON and the category read model", {
	skip: !hasRealQuestData,
}, async () => {
	const categoryName = "__reader_draft_test__/Text";
	const categoryDirectory = path.join(
		REPO_ROOT,
		"data/quests/categories/__reader_draft_test__",
	);
	const categoryFile = path.join(categoryDirectory, "Text.json");
	const previousDrafts = [...db.drafts];
	fs.mkdirSync(categoryDirectory, { recursive: true });
	fs.writeFileSync(
		categoryFile,
		JSON.stringify({ test_key: { en: "Test source", id: "" } }, null, 2),
	);

	try {
		db.drafts.length = 0;
		db.drafts.push({
			id: "reader-category-draft-test",
			questId: `cat:${categoryName}`,
			questTitle: categoryName,
			lineId: "line_test_key",
			lineNo: 1,
			speakerName: "key",
			author: { name: "Integration Test", role: "Editor" },
			sourceText: "Test source",
			previousText: "",
			proposedText: "Teks uji",
			status: "approved",
			createdAt: new Date().toISOString(),
		});
		const result = db.applyApprovedDrafts();
		assert.equal(result.appliedCount, 1);
		const updated = JSON.parse(fs.readFileSync(categoryFile, "utf8")) as {
			test_key?: { id?: string; text_id?: string };
		};
		assert.equal(updated.test_key?.id, "Teks uji");
		assert.equal(updated.test_key?.text_id, "Teks uji");

		const response = await fetch(
			`${baseUrl}/api/reader/categories/${categoryName}?page=1&limit=10`,
		);
		const body = (await response.json()) as {
			items?: Array<{ key?: string; text?: { id?: string } }>;
		};
		assert.equal(response.status, 200);
		assert.equal(body.items?.[0]?.key, "test_key");
		assert.equal(body.items?.[0]?.text?.id, "Teks uji");
	} finally {
		db.drafts.length = 0;
		db.drafts.push(...previousDrafts);
		db.saveDrafts();
		fs.rmSync(categoryDirectory, { recursive: true, force: true });
		realDataLoader.invalidateTranslationStats();
		rebuildCategoryIndex(path.join(REPO_ROOT, "data/quests/index.db"));
		realDataLoader.invalidateTranslationStats();
	}
});

test("category selector queries remain bounded and searchable", {
	skip: !hasRealQuestData,
}, async () => {
	const response = await fetch(
		`${baseUrl}/api/reader/categories?q=Item&limit=10`,
	);
	const body = (await response.json()) as {
		categories?: Array<{ name?: string }>;
	};
	assert.equal(response.status, 200);
	assert.ok((body.categories || []).length <= 10);
	assert.ok(
		(body.categories || []).every((category) =>
			category.name?.toLowerCase().includes("item"),
		),
	);
});

test("global search applies one bound across all scopes", {
	skip: !hasRealQuestData,
}, async () => {
	const response = await fetch(
		`${baseUrl}/api/reader/search?q=quest&scope=all&limit=1`,
	);
	const body = (await response.json()) as {
		results?: unknown[];
		total?: number;
	};
	assert.equal(response.status, 200);
	assert.ok((body.results || []).length <= 1);
	assert.ok((body.total || 0) <= 1);
});

test("global search finds dialogue and option text keys from SQLite", {
	skip: !hasRealQuestData,
}, async () => {
	const dialogueResponse = await fetch(
		`${baseUrl}/api/reader/search?q=Event_TXCQDEBF_1_1&scope=dialogue&lang=en&limit=10`,
	);
	const dialogueBody = (await dialogueResponse.json()) as {
		results?: Array<{
			id?: string;
			text?: string;
			lineId?: string;
		}>;
	};
	assert.equal(dialogueResponse.status, 200);
	assert.ok(
		dialogueBody.results?.some(
			(result) =>
				result.id?.includes(":Event_TXCQDEBF_1_1") &&
				result.lineId === "1" &&
				result.text?.includes("What's that"),
		),
	);

	const optionResponse = await fetch(
		`${baseUrl}/api/reader/search?q=Event_TXCQDEBF_2_4&scope=dialogue&lang=en&limit=10`,
	);
	const optionBody = (await optionResponse.json()) as {
		results?: Array<{ id?: string; text?: string }>;
	};
	assert.equal(optionResponse.status, 200);
	assert.ok(
		optionBody.results?.some(
			(result) =>
				result.id?.includes(":Event_TXCQDEBF_2_4") &&
				result.text?.includes("Must be tough"),
		),
	);

	const filteredResponse = await fetch(
		`${baseUrl}/api/reader/search?q=Event_TXCQDEBF_1_1&scope=dialogue&speaker=__missing_speaker__&limit=10`,
	);
	const filteredBody = (await filteredResponse.json()) as {
		results?: unknown[];
	};
	assert.equal(filteredResponse.status, 200);
	assert.deepEqual(filteredBody.results, []);
});

test("category detail pagination exposes later editor pages", {
	skip: !hasRealQuestData,
}, async () => {
	const response = await fetch(
		`${baseUrl}/api/reader/categories/UI?page=2&limit=200`,
	);
	const body = (await response.json()) as {
		page?: number;
		items?: unknown[];
		totalPages?: number;
	};
	assert.equal(response.status, 200);
	assert.equal(body.page, 2);
	assert.ok((body.totalPages || 0) > 1);
	assert.ok((body.items || []).length > 0);
});

test("legacy quest detail stays full while pagination is additive", {
	skip: !hasRealQuestData,
}, async () => {
	const legacyResponse = await fetch(`${baseUrl}/api/reader/quests/${QUEST_ID}`);
	const legacy = (await legacyResponse.json()) as {
		lines?: unknown[];
		page?: number;
	};
	assert.equal(legacyResponse.status, 200);
	assert.ok(Array.isArray(legacy.lines));
	assert.equal(legacy.page, undefined);

	const pageResponse = await fetch(
		`${baseUrl}/api/reader/quests/${QUEST_ID}?page=2&pageSize=2`,
	);
	const page = (await pageResponse.json()) as {
		lines?: unknown[];
		page?: number;
		pageSize?: number;
		totalPages?: number;
		hasPreviousPage?: boolean;
	};
	assert.equal(pageResponse.status, 200);
	assert.equal(page.page, 2);
	assert.equal(page.pageSize, 2);
	assert.equal(page.lines?.length, 2);
	assert.ok((page.totalPages || 0) > 2);
	assert.equal(page.hasPreviousPage, true);

	const speakerResponse = await fetch(
		`${baseUrl}/api/reader/quests/${QUEST_ID}?page=1&pageSize=1&speaker=Excited`,
	);
	const speakerPage = (await speakerResponse.json()) as {
		lines?: Array<{
			speaker?: { id?: string; name?: { id?: string } };
		}>;
	};
	assert.equal(speakerResponse.status, 200);
	assert.equal(speakerPage.lines?.[0]?.speaker?.id, "雀跃的女生");
	assert.equal(speakerPage.lines?.[0]?.speaker?.name?.id, "Excited Girl");
});

test("quest pagination clamps invalid pages and supports zero-result search", {
	skip: !hasRealQuestData,
}, async () => {
	const response = await fetch(
		`${baseUrl}/api/reader/quests/${QUEST_ID}?page=999999&pageSize=0&q=__no_such_reader_text__`,
	);
	const body = (await response.json()) as {
		lines?: unknown[];
		page?: number;
		pageSize?: number;
		filteredLines?: number;
		totalPages?: number;
	};
	assert.equal(response.status, 200);
	assert.equal(body.page, 1);
	assert.equal(body.pageSize, 200);
	assert.equal(body.totalPages, 1);
	assert.equal(body.filteredLines, 0);
	assert.deepEqual(body.lines, []);
});
