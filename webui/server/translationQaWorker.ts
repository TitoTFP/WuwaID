import { parentPort } from "node:worker_threads";
import { translationQaService } from "./translationQa.js";

if (!parentPort) {
	throw new Error("Translation QA worker requires a parent port.");
}

try {
	const delay = Number(process.env.WUWAID_QA_TEST_DELAY_MS || 0);
	if (delay > 0) {
		await new Promise((resolve) => setTimeout(resolve, delay));
	}
	const summary = translationQaService.getSummary(true);
	parentPort.postMessage({ ok: true, summary });
} catch (error) {
	parentPort.postMessage({
		ok: false,
		error: error instanceof Error ? error.message : "Translation QA scan failed.",
	});
}
