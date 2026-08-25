import express from "express";
import cors from "cors";
import { db } from "./db.js";
import { readerRouter } from "./routes/reader.js";
import { workbenchRouter } from "./routes/workbench.js";
import { createOpsRouter, opsRouter, type OpsRouterOptions } from "./routes/ops.js";
import type { DatabaseJobManager } from "./databaseJobManager.js";
import { authRouter } from "./routes/auth.js";
import { qaRouter } from "./routes/qa.js";

export function createApp(
	options: {
		databaseJobManager?: DatabaseJobManager;
		opsRouterOptions?: OpsRouterOptions;
	} = {},
) {
	const app = express();
	const operationsRouter = options.databaseJobManager || options.opsRouterOptions
		? createOpsRouter(options.databaseJobManager, options.opsRouterOptions)
		: opsRouter;

	app.use(cors());
	app.use(express.json());

	app.get(
		[
			"/api/health",
			"/api/reader/health",
			"/api/workbench/health",
			"/api/ops/health",
		],
		(_req, res) => {
			res.json({
				status: "ok",
				service: "WuwaID Standalone Fullstack WebUI Server",
				version: "1.0.0",
				timestamp: new Date().toISOString(),
			});
		},
	);

	app.get(["/api/metrics", "/api/reader/metrics"], (_req, res) => {
		res.json(db.getSystemMetrics());
	});

	app.use("/api/reader", readerRouter);
	app.use("/api/workbench", workbenchRouter);
	app.use("/api/ops", operationsRouter);
	app.use("/api/auth", authRouter);
	app.use("/api/qa", qaRouter);

	app.use("/api", readerRouter);
	app.use("/api", workbenchRouter);
	app.use("/api", operationsRouter);
	app.use("/api", authRouter);
	app.use("/api", qaRouter);

	return app;
}
