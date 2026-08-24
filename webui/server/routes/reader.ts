import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { realDataLoader, type GlobalSearchOptions } from "../realDataLoader.js";
import type {
	QuestDetail,
	QuestDetailPage,
	QuestSummary,
} from "../../src/types/index.js";

export const readerRouter = Router();

function paginateQuestSummaries(
	quests: QuestSummary[],
	page: number,
	pageSize: number,
) {
	const totalPages = Math.max(1, Math.ceil(quests.length / pageSize));
	const validPage = Math.min(totalPages, Math.max(1, page));
	const start = (validPage - 1) * pageSize;
	return {
		quests: quests.slice(start, start + pageSize),
		page: validPage,
		pageSize,
		filteredQuests: quests.length,
		totalPages,
		hasNextPage: validPage < totalPages,
		hasPreviousPage: validPage > 1,
	};
}

function paginateFallbackQuest(
	quest: QuestDetail,
	opts: { page?: number; pageSize?: number; q?: string; speaker?: string },
): QuestDetailPage {
	const query = opts.q?.toLowerCase() || "";
	const speakerQuery =
		opts.speaker && opts.speaker !== "all" ? opts.speaker.toLowerCase() : "";
	const filteredLines = quest.lines.filter((line) => {
		const searchableValues = [
			...Object.values(line.text),
			...Object.values(line.speaker.name),
			...(line.options || []).flatMap((option) => Object.values(option.text)),
		];
		const matchesText =
			!query ||
			searchableValues.some((value) =>
				String(value || "")
					.toLowerCase()
					.includes(query),
			);
		const matchesSpeaker =
			!speakerQuery ||
			line.speaker.id.toLowerCase().includes(speakerQuery) ||
			Object.values(line.speaker.name).some((value) =>
				String(value || "")
					.toLowerCase()
					.includes(speakerQuery),
			);
		return matchesText && matchesSpeaker;
	});
	const pageSize = Math.max(1, Math.min(200, Math.floor(opts.pageSize || 200)));
	const totalPages = Math.max(1, Math.ceil(filteredLines.length / pageSize));
	const page = Math.min(totalPages, Math.max(1, Math.floor(opts.page || 1)));
	const start = (page - 1) * pageSize;

	return {
		...quest,
		lines: filteredLines.slice(start, start + pageSize),
		page,
		pageSize,
		filteredLines: filteredLines.length,
		totalPages,
		hasNextPage: page < totalPages,
		hasPreviousPage: page > 1,
	};
}

// GET /api/reader/overview or /api/overview - Initial reader payload
readerRouter.get(
	["/overview", "/reader/overview"],
	(_req: Request, res: Response) => {
		const chapters = realDataLoader.getChapters() || db.chapters;
		const categories = realDataLoader.getCategories() || db.categories;
		res.json({ chapters, categories, metrics: db.getSystemMetrics() });
	},
);

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
			const rawLimit =
				req.query.limit === undefined ? undefined : Number(req.query.limit);
			const limit = Number.isFinite(rawLimit)
				? Math.max(1, Math.min(200, Math.floor(rawLimit as number)))
				: undefined;
			const rawPage =
				req.query.page === undefined ? undefined : Number(req.query.page);
			const rawPageSize =
				req.query.pageSize === undefined ? undefined : Number(req.query.pageSize);
			const wantsPagination = rawPage !== undefined || rawPageSize !== undefined;
			const page = Number.isFinite(rawPage) ? Math.floor(rawPage as number) : 1;
			const pageSize = Number.isFinite(rawPageSize)
				? Math.max(1, Math.min(200, Math.floor(rawPageSize as number)))
				: 200;

			const realQuests = realDataLoader.getQuestsSummary({
				chapterId,
				search,
				type,
				sort,
				limit: wantsPagination ? undefined : limit,
				unbounded: wantsPagination,
			});
			if (realQuests) {
				res.json(
					wantsPagination
						? paginateQuestSummaries(realQuests, page, pageSize)
						: { quests: realQuests },
				);
				return;
			}

			let questList: QuestDetail[] = Object.values(db.quests);

			if (chapterId) {
				questList = questList.filter((q: QuestDetail) => q.chapterId === chapterId);
			}

			let summaries = questList.map((q: QuestDetail) => ({
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

			if (search) {
				const normalizedSearch = search.toLowerCase();
				summaries = summaries.filter(
					(quest) =>
						quest.id.toLowerCase().includes(normalizedSearch) ||
						Object.values(quest.title).some((title) =>
							(title || "").toLowerCase().includes(normalizedSearch),
						),
				);
			}
			if (type && type !== "all") {
				summaries = summaries.filter((quest) =>
					type === "main" || type === "side" ? quest.type === type : true,
				);
			}
			if (sort) {
				summaries.sort((left, right) => {
					if (sort === "name_asc" || sort === "name_desc") {
						const direction = sort === "name_asc" ? 1 : -1;
						return (
							direction *
							(left.title.id || left.title.en || "").localeCompare(
								right.title.id || right.title.en || "",
							)
						);
					}
					const direction = sort === "id_desc" ? -1 : 1;
					return direction * (Number(left.id) - Number(right.id));
				});
			}
			if (!wantsPagination && limit !== undefined)
				summaries = summaries.slice(0, limit);

			res.json(
				wantsPagination
					? paginateQuestSummaries(summaries, page, pageSize)
					: { quests: summaries },
			);
		} catch (err) {
			console.error("[Error GET /api/reader/quests]:", err);
			res.status(500).json({ error: String(err) });
		}
	},
);

// GET /api/reader/quests/:id or /api/quests/:id - Detail of a specific quest
readerRouter.get(
	["/quests/:id", "/reader/quests/:id"],
	async (req: Request, res: Response) => {
		const qid = req.params.id;
		const rawPage = req.query.page;
		const rawPageSize = req.query.pageSize;
		const pageValue = rawPage === undefined ? undefined : Number(rawPage);
		const pageSizeValue =
			rawPageSize === undefined ? undefined : Number(rawPageSize);
		const page = Number.isFinite(pageValue)
			? Math.floor(pageValue as number)
			: undefined;
		const pageSize = Number.isFinite(pageSizeValue)
			? Math.floor(pageSizeValue as number)
			: undefined;
		const query = String(req.query.q || "").trim();
		const speaker = String(req.query.speaker || "").trim();
		const wantsPage =
			page !== undefined ||
			pageSize !== undefined ||
			Boolean(query) ||
			Boolean(speaker);

		const fallbackQuest = db.quests[qid];
		const realDetail = fallbackQuest
			? null
			: wantsPage
				? await realDataLoader.getQuestDetailPage(qid, {
						page,
						pageSize,
						q: query,
						speaker,
					})
				: realDataLoader.getQuestDetail(qid);
		if (realDetail) {
			res.json(realDetail);
			return;
		}

		const quest = fallbackQuest;
		if (!quest) {
			res.status(404).json({ error: `Quest with id '${qid}' not found` });
			return;
		}

		res.json(
			wantsPage
				? paginateFallbackQuest(quest, { page, pageSize, q: query, speaker })
				: quest,
		);
	},
);

// GET /api/reader/categories or /api/categories - List text categories
readerRouter.get(
	["/categories", "/reader/categories"],
	(req: Request, res: Response) => {
		const query = String(req.query.q || "")
			.trim()
			.toLowerCase();
		const rawLimit =
			req.query.limit === undefined ? undefined : Number(req.query.limit);
		const limit = Number.isFinite(rawLimit)
			? Math.max(1, Math.min(200, Math.floor(rawLimit as number)))
			: undefined;
		const realCategories = realDataLoader.getCategories({ q: query, limit });
		if (realCategories) {
			res.json({ categories: realCategories });
			return;
		}

		let categories = db.categories;
		if (query) {
			categories = categories.filter((category) =>
				category.name.toLowerCase().includes(query),
			);
		}
		if (limit !== undefined) categories = categories.slice(0, limit);
		res.json({ categories });
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
		const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

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
