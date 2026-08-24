import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const port = Number(process.env.BENCHMARK_PORT || 3197);
const baseUrl = `http://127.0.0.1:${port}`;
const cwd = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const server = spawn("./node_modules/.bin/tsx", ["server/dev.ts"], {
	cwd,
	env: { ...process.env, NODE_ENV: "development", PORT: String(port) },
	stdio: ["ignore", "pipe", "pipe"],
});

const request = async (path) => {
	const started = performance.now();
	const response = await fetch(`${baseUrl}${path}`, {
		signal: AbortSignal.timeout(30_000),
	});
	await response.arrayBuffer();
	return { status: response.status, elapsed: performance.now() - started };
};

try {
	let health;
	for (let attempt = 0; attempt < 120; attempt++) {
		try {
			health = await request("/api/health");
			if (health.status === 200) break;
		} catch {
			// The server is still starting.
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	if (!health || health.status !== 200) {
		throw new Error("WebUI server did not become healthy within 6 seconds.");
	}

	const started = performance.now();
	const [overview, chapter] = await Promise.all([
		request("/api/reader/overview"),
		request("/api/reader/quests?chapterId=1"),
	]);
	const coldReaderLoad = performance.now() - started;
	const [extremeFirstPage, extremeLaterPage] = await Promise.all([
		request("/api/reader/quests/1?page=1&pageSize=2"),
		request("/api/reader/quests/1?page=2&pageSize=2"),
	]);
	if (
		overview.status !== 200 ||
		chapter.status !== 200 ||
		extremeFirstPage.status !== 200 ||
		extremeLaterPage.status !== 200
	) {
		throw new Error(
			`Reader endpoints failed: overview=${overview.status}, chapter=${chapter.status}, extremeFirstPage=${extremeFirstPage.status}, extremeLaterPage=${extremeLaterPage.status}`,
		);
	}

	console.log(`cold reader load: ${coldReaderLoad.toFixed(1)} ms`);
	console.log(`overview request: ${overview.elapsed.toFixed(1)} ms`);
	console.log(`chapter request: ${chapter.elapsed.toFixed(1)} ms`);
	console.log(`extreme first page: ${extremeFirstPage.elapsed.toFixed(1)} ms`);
	console.log(`extreme later page: ${extremeLaterPage.elapsed.toFixed(1)} ms`);
	if (coldReaderLoad >= 1000) {
		throw new Error(
			`cold reader load exceeded 1000 ms: ${coldReaderLoad.toFixed(1)} ms`,
		);
	}
	if (extremeFirstPage.elapsed >= 1000 || extremeLaterPage.elapsed >= 1000) {
		throw new Error(
			`extreme quest page exceeded 1000 ms: first=${extremeFirstPage.elapsed.toFixed(1)} ms, later=${extremeLaterPage.elapsed.toFixed(1)} ms`,
		);
	}
} finally {
	server.kill("SIGTERM");
}
