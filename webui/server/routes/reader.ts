import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { realDataLoader, type GlobalSearchOptions } from "../realDataLoader.js";
import type { QuestDetail } from "../../src/types/index.js";

export const readerRouter = Router();

// GET /api/reader/chapters or /api/chapters - List chapters
readerRouter.get(
	["/chapters", "/reader/chapters"],
	(_req: Request, res: Response) => {
		const realChapters = realDataLoader.getChapters();
		if (realChapters && realChapters.length > 0) {
			res.json({ chapters: realChapters });
			return;
		}
		res.json({ chapters: db.chapters });
	},
);

// GET /api/reader/quests or /api/quests - List quest summaries
readerRouter.get(
	["/quests", "/reader/quests"],
	(req: Request, res: Response) => {
		try {
			const chapterId = req.query.chapterId as string | undefined;
			const search = req.query.q as string | undefined;
			const type = req.query.type as string | undefined;
			const sort = req.query.sort as string | undefined;

			const realQuests = realDataLoader.getQuestsSummary({
				chapterId,
				search,
				type,
				sort,
			});
			if (realQuests) {
				res.json({ quests: realQuests });
				return;
			}

			let questList: QuestDetail[] = Object.values(db.quests);

			if (chapterId) {
				questList = questList.filter(
					(q: QuestDetail) => q.chapterId === chapterId,
				);
			}

			const summaries = questList.map((q: QuestDetail) => ({
				id: q.id,
				chapterId: q.chapterId,
				chapterTitle: q.chapterTitle,
				title: q.title,
				type: q.type,
				totalLines: q.totalLines,
				translatedLines: {
					id: q.totalLines,
					zh: q.totalLines,
					ja: q.totalLines,
				},
				updatedAt: q.updatedAt,
			}));

			res.json({ quests: summaries });
		} catch (err) {
			console.error("[Error GET /api/reader/quests]:", err);
			res.status(500).json({ error: String(err) });
		}
	},
);

// GET /api/reader/quests/:id or /api/quests/:id - Detail of a specific quest
readerRouter.get(
	["/quests/:id", "/reader/quests/:id"],
	(req: Request, res: Response) => {
		const qid = req.params.id;

		const realDetail = realDataLoader.getQuestDetail(qid);
		if (realDetail) {
			res.json(realDetail);
			return;
		}

		const quest = db.quests[qid];
		if (!quest) {
			res.status(404).json({ error: `Quest with id '${qid}' not found` });
			return;
		}

		res.json(quest);
	},
);

// GET /api/reader/categories or /api/categories - List text categories
readerRouter.get(
	["/categories", "/reader/categories"],
	(_req: Request, res: Response) => {
		const realCategories = realDataLoader.getCategories();
		if (realCategories && realCategories.length > 0) {
			res.json({ categories: realCategories });
			return;
		}
		res.json({ categories: db.categories });
	},
);

// GET /api/reader/categories/:name or /api/categories/:name - Detail of a category
// GET /api/reader/categories/:name or /api/categories/:name - Category items
readerRouter.get(
	["/categories/*", "/reader/categories/*"],
	(req: Request, res: Response) => {
		const categoryName = req.params[0];
		const q = req.query.q as string | undefined;
		const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
		const limit = req.query.limit
			? parseInt(req.query.limit as string, 10)
			: 50;

		const realDetail = realDataLoader.getCategoryDetail(categoryName, {
			q,
			page,
			limit,
		});
		if (realDetail) {
			res.json(realDetail);
			return;
		}

		const category = db.categories.find(
			(c) =>
				c.name.toLowerCase() === categoryName.toLowerCase() ||
				c.id === categoryName,
		);

		if (!category) {
			res.status(404).json({ error: `Category '${categoryName}' not found` });
			return;
		}

		res.json({
			name: category.name,
			totalItems: category.totalItems,
			filteredItems: category.totalItems,
			page: 1,
			limit: 50,
			totalPages: 1,
			items: [],
		});
	},
);

// GET /api/reader/search or /api/search - Global search across reader data
readerRouter.get(
	["/search", "/reader/search"],
	(req: Request, res: Response) => {
		const query = String(req.query.q || "").trim();
		const scope = ["all", "dialogue", "quest", "category"].includes(
			String(req.query.scope),
		)
			? (String(req.query.scope) as GlobalSearchOptions["scope"])
			: "all";
		const lang = ["en", "id", "zh", "ja"].includes(String(req.query.lang))
			? (String(req.query.lang) as GlobalSearchOptions["lang"])
			: "id";
		const limit = Number(req.query.limit) || 8;
		const speaker = String(req.query.speaker || "").trim() || undefined;
		const untranslated = req.query.untranslated === "true";

		if (!query && !untranslated && !speaker) {
			res.json({ query, scope, lang, total: 0, results: [] });
			return;
		}

		const results = realDataLoader.search(query, {
			scope,
			lang,
			speaker,
			untranslated,
			limit,
		});
		res.json({ query, scope, lang, total: results.length, results });
	},
);
