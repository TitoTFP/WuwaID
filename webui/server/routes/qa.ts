import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { requireAdmin, requireEditor } from "../requestAuth.js";
import {
	QA_EXPORT_DEFAULT_LIMIT,
	QA_EXPORT_MAX_ITEMS,
	TranslationQAScanInProgressError,
	TranslationQAScanRateLimitError,
	translationQaService,
} from "../translationQa.js";
import type {
	TranslationQASourceKind,
	TranslationQAStatus,
} from "../../src/types/index.js";

export const qaRouter = Router();

function requireQaEditor(req: Request, res: Response): boolean {
	return Boolean(
		requireEditor(req, res, "Login editor diperlukan untuk mengubah status QA."),
	);
}

function requireQaAdmin(req: Request, res: Response): boolean {
	return Boolean(
		requireAdmin(req, res, "Admin login diperlukan untuk menjalankan scan QA."),
	);
}

function queryText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function queryStatus(value: unknown): TranslationQAStatus | "all" {
	const status = queryText(value);
	return status === "pass" || status === "review" || status === "approved"
		? status
		: "all";
}

function queryKind(value: unknown): TranslationQASourceKind | "all" {
	const kind = queryText(value);
	return kind === "quest" || kind === "category" ? kind : "all";
}

function queryInteger(value: unknown, fallback: number, maximum: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(0, Math.min(maximum, Math.floor(parsed)));
}

function serviceError(res: Response, error: unknown): void {
	if (error instanceof TranslationQAScanInProgressError) {
		res.setHeader("Retry-After", String(error.retryAfterSeconds));
		res.status(409).json({
			error: error.message,
			retryAfterSeconds: error.retryAfterSeconds,
		});
		return;
	}
	if (error instanceof TranslationQAScanRateLimitError) {
		res.setHeader("Retry-After", String(error.retryAfterSeconds));
		res.status(429).json({
			error: error.message,
			retryAfterSeconds: error.retryAfterSeconds,
		});
		return;
	}
	console.error("[TranslationQA] Request failed:", error);
	res.status(500).json({
		error: error instanceof Error ? error.message : "Translation QA request failed.",
	});
}

function listOptions(req: Request) {
	return {
		status: queryStatus(req.query.status),
		kind: queryKind(req.query.kind),
		query: queryText(req.query.q),
		issue: queryText(req.query.issue),
		sample: req.query.sample === "true",
		page: Number(req.query.page || 1),
		pageSize: Number(req.query.page_size || 25),
	};
}

// GET /api/qa/summary - Current corpus QA summary.
qaRouter.get(["/summary", "/qa/summary"], (_req: Request, res: Response) => {
	try {
		res.json(translationQaService.getSummary());
	} catch (error) {
		serviceError(res, error);
	}
});

// POST /api/qa/scan - Force a fresh scan of the source corpus.
qaRouter.post(["/scan", "/qa/scan"], (req: Request, res: Response) => {
	if (!requireQaAdmin(req, res)) return;
	try {
		res.status(202).json(translationQaService.startForceScan());
	} catch (error) {
		serviceError(res, error);
	}
});

// GET /api/qa/scan/:id - Poll a background scan job.
qaRouter.get(["/scan/:id", "/qa/scan/:id"], (req: Request, res: Response) => {
	if (!requireQaAdmin(req, res)) return;
	try {
		const job = translationQaService.getScanJob(req.params.id);
		if (!job) {
			res.status(404).json({ error: `QA scan '${req.params.id}' not found` });
			return;
		}
		res.json(job);
	} catch (error) {
		serviceError(res, error);
	}
});

// GET /api/qa/items - Paginated QA units with filters.
qaRouter.get(["/items", "/qa/items"], (req: Request, res: Response) => {
	try {
		res.json(translationQaService.listItems(listOptions(req)));
	} catch (error) {
		serviceError(res, error);
	}
});

// GET /api/qa/items/:id - Full context for one QA unit.
qaRouter.get(["/items/:id", "/qa/items/:id"], (req: Request, res: Response) => {
	try {
		const item = translationQaService.getItem(req.params.id);
		if (!item) {
			res.status(404).json({ error: `QA item '${req.params.id}' not found` });
			return;
		}
		res.json(item);
	} catch (error) {
		serviceError(res, error);
	}
});

// PATCH /api/qa/items/:id - Human review status and comment.
qaRouter.patch(["/items/:id", "/qa/items/:id"], (req: Request, res: Response) => {
	if (!requireQaEditor(req, res)) return;
	try {
		const status = queryText(req.body?.status);
		if (status !== "review" && status !== "approved" && status !== "reset") {
			res.status(400).json({ error: "status harus review, approved, atau reset." });
			return;
		}
		const authorization = req.headers.authorization || "";
		const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
		const reviewer = token ? db.getSession(token)?.username || "Editor" : "Editor";
		const item = translationQaService.updateReview(
			req.params.id,
			status,
			queryText(req.body?.comment),
			reviewer,
		);
		if (!item) {
			res.status(404).json({ error: `QA item '${req.params.id}' not found` });
			return;
		}
		res.json({ item });
	} catch (error) {
		serviceError(res, error);
	}
});

// GET /api/qa/export - Export the filtered report for offline review.
qaRouter.get(["/export", "/qa/export"], (req: Request, res: Response) => {
	if (!requireQaEditor(req, res)) return;
	try {
		const format = queryText(req.query.format) === "csv" ? "csv" : "json";
		const result = translationQaService.exportItems({
			status: queryStatus(req.query.status),
			kind: queryKind(req.query.kind),
			query: queryText(req.query.q),
			issue: queryText(req.query.issue),
			format,
			limit: queryInteger(req.query.limit, QA_EXPORT_DEFAULT_LIMIT, QA_EXPORT_MAX_ITEMS),
			offset: queryInteger(req.query.offset, 0, Number.MAX_SAFE_INTEGER),
		});
		res.setHeader("Content-Type", result.contentType);
		res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
		res.setHeader("X-Export-Total", String(result.total));
		res.setHeader("X-Export-Returned", String(result.returned));
		res.setHeader("X-Export-Truncated", String(result.truncated));
		res.send(result.content);
	} catch (error) {
		serviceError(res, error);
	}
});
