import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import test, { after, before } from "node:test";
import { createApp } from "./app.js";

let server: Server;
let baseUrl = "";

before(async () => {
	server = createServer(createApp());
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Export test server did not expose a port.");
	}
	baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
});

test("exports a quest stored in a nested dialogue.json file", async () => {
	const response = await fetch(
		`${baseUrl}/api/ops/databases/export/quest/155000000?mode=id`,
	);
	const body = Buffer.from(await response.arrayBuffer());

	assert.equal(response.status, 200, body.toString("utf8"));
	assert.match(
		response.headers.get("content-disposition") ?? "",
		/quest_155000000\.db/,
	);
	assert.deepEqual(body.subarray(0, 16), Buffer.from("SQLite format 3\0"));
});

test("global ConfigDB export uses the SQLite read model", async () => {
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
			`${baseUrl}/api/ops/databases/export/lang_multi_text.db?mode=id`,
		);
		const body = Buffer.from(await response.arrayBuffer());
		assert.equal(response.status, 200, body.toString("utf8"));
		fs.writeFileSync(outputPath, body);
		const database = new DatabaseSync(outputPath, { readOnly: true });
		try {
			const row = database
				.prepare("SELECT Content FROM MultiText WHERE Id = ?")
				.get("Event_TXCQDEBF_1_1") as { Content?: string } | undefined;
			assert.equal(row?.Content, "Apa itu, Pak Li? Kelihatannya enak banget!");
		} finally {
			database.close();
		}
	} finally {
		fs.readFileSync = originalReadFileSync;
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});
