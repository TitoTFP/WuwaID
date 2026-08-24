import { parentPort } from "node:worker_threads";
import {
	runDatabaseJob,
	type DatabaseJobFile,
	type DatabaseJobKind,
	type DatabaseJobProcessorOptions,
} from "./databaseJobProcessor.js";

if (!parentPort) {
	throw new Error("Database job worker requires parentPort");
}

parentPort.on(
	"message",
	(message: {
		kind: DatabaseJobKind;
		files: DatabaseJobFile[];
		processorOptions?: DatabaseJobProcessorOptions;
	}) => {
		void runDatabaseJob(
			message.kind,
			message.files,
			(progress) => parentPort?.postMessage({ type: "progress", progress }),
			message.processorOptions,
		)
			.then((result) => {
				parentPort?.postMessage({ type: "completed", result });
				parentPort?.close();
			})
			.catch((error: unknown) => {
				parentPort?.postMessage({
					type: "failed",
					error: error instanceof Error ? error.message : String(error),
				});
				parentPort?.close();
			});
	},
);
