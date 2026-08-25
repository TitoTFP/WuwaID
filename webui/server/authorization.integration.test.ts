import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import test, { after, before } from "node:test";
import { createApp } from "./app.js";
import { db, type UserSession } from "./db.js";

let server: Server;
let baseUrl = "";
const sessions: UserSession[] = [];

function createSession(role: UserSession["role"]): UserSession {
	const session = db.createSession(role, `Integration ${role}`);
	sessions.push(session);
	return session;
}

async function request(pathname: string, init?: RequestInit): Promise<Response> {
	return fetch(`${baseUrl}${pathname}`, init);
}

async function status(pathname: string, init?: RequestInit): Promise<number> {
	return (await request(pathname, init)).status;
}

function bearer(session: UserSession): Record<string, string> {
	return { Authorization: `Bearer ${session.token}` };
}

function withEnvironment<T>(
	values: Record<string, string | undefined>,
	callback: () => Promise<T>,
): Promise<T> {
	const previous = new Map<string, string | undefined>();
	for (const [name, value] of Object.entries(values)) {
		previous.set(name, process.env[name]);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	return callback().finally(() => {
		for (const [name, value] of previous) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	});
}

before(async () => {
	server = createServer(createApp());
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Authorization test server did not expose a port.");
	}
	baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
	for (const session of sessions) db.sessions.delete(session.token);
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
});

test("draft and version mutations distinguish 401, 403, and editor access", async () => {
	const originalDrafts = structuredClone(db.drafts);
	const reader = createSession("reader");
	const editor = createSession("editor");
	try {
		const draftPayload = {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ proposedText: "Terjemahan integration" }),
		};
		assert.equal(await status("/api/workbench/drafts", draftPayload), 401);
		assert.equal(
			await status("/api/workbench/drafts", {
				...draftPayload,
				headers: { ...draftPayload.headers, ...bearer(reader) },
			}),
			403,
		);
		assert.equal(
			await status("/api/workbench/drafts", {
				...draftPayload,
				headers: { ...draftPayload.headers, ...bearer(editor) },
			}),
			201,
		);

		assert.equal(
			await status("/api/workbench/drafts/apply", {
			method: "POST",
			headers: bearer(editor),
		}),
			403,
		);
		assert.equal(
			await status("/api/workbench/versions", {
			method: "GET",
			headers: bearer(reader),
		}),
			403,
		);
		assert.equal(await status("/api/workbench/versions"), 401);
		assert.equal(
			await status("/api/workbench/versions", { headers: bearer(editor) }),
			200,
		);
	} finally {
		db.drafts = originalDrafts;
		db.saveDrafts();
	}
});

test("database jobs and QA scans are admin-only operational mutations", async () => {
	const reader = createSession("reader");
	const editor = createSession("editor");
	const admin = createSession("admin");
	const importRequest = {
		method: "POST",
		headers: { "Content-Type": "application/octet-stream" },
		body: Buffer.alloc(0),
	};

	assert.equal(
		await status("/api/ops/databases/import?filename=empty.db", importRequest),
		401,
	);
	assert.equal(
		await status("/api/ops/databases/import?filename=empty.db", {
			...importRequest,
			headers: { ...importRequest.headers, ...bearer(reader) },
		}),
		403,
	);
	assert.equal(
		await status("/api/ops/databases/import?filename=empty.db", {
			...importRequest,
			headers: { ...importRequest.headers, ...bearer(editor) },
		}),
		403,
	);
	assert.equal(
		await status("/api/ops/databases/import?filename=empty.db", {
			...importRequest,
			headers: { ...importRequest.headers, ...bearer(admin) },
		}),
		400,
	);
	assert.equal(
		await status("/api/ops/databases/reset-id", {
			method: "POST",
			headers: bearer(editor),
		}),
		403,
	);
	assert.equal(
		await status("/api/qa/scan", {
			method: "POST",
			headers: bearer(editor),
		}),
		403,
	);
});

test("configured credentials reject invalid role escalation and fail closed in production", async () => {
	await withEnvironment(
		{
			NODE_ENV: "test",
			WUWAID_EDITOR_PASSWORD: "editor-secret",
			WUWAID_ADMIN_PASSWORD: "admin-secret",
		},
		async () => {
			assert.equal(
				await status("/api/auth/login", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "wrong" }),
				}),
				401,
			);
			assert.equal(
				await status("/api/auth/login", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "editor-secret" }),
				}),
				200,
			);
			assert.equal(
				await status("/api/auth/admin/login", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "wrong" }),
				}),
				401,
			);
			assert.equal(
				await status("/api/auth/admin/login", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "admin-secret" }),
				}),
				200,
			);
		},
	);

	await withEnvironment(
		{
			NODE_ENV: "production",
			WUWAID_EDITOR_PASSWORD: undefined,
			WUWAID_ADMIN_PASSWORD: undefined,
		},
		async () => {
			const login = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password: "anything" }),
			};
			assert.equal(await status("/api/auth/login", login), 503);
			assert.equal(await status("/api/auth/admin/login", login), 503);
		},
	);
});

test("remote log ingestion requires a configured telemetry token in production", async () => {
	const originalLogs = [...db.logEntries];
	try {
		await withEnvironment(
			{ NODE_ENV: "production", WUWAID_TELEMETRY_TOKEN: "telemetry-secret" },
			async () => {
				const payload = {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ message: "integration log" }),
				};
				assert.equal(await status("/api/ops/logs", payload), 401);
				assert.equal(
					await status("/api/ops/logs", {
						...payload,
						headers: {
							...payload.headers,
							"X-WuwaID-Telemetry-Token": "wrong",
						},
					}),
					403,
				);
				assert.equal(
					await status("/api/ops/logs", {
						...payload,
						headers: {
							...payload.headers,
							"X-WuwaID-Telemetry-Token": "telemetry-secret",
						},
					}),
					201,
				);
			},
		);
	} finally {
		db.logEntries = originalLogs;
	}
});
