import React, { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GitCommit, Split, Layers, BookOpen, PenTool } from "lucide-react";
import { MOCK_QUEST_DETAILS } from "../mockData/quests";
import { TranslatorWorkbench } from "../components/workbench/TranslatorWorkbench";
import { DialogueTreeEditor } from "../components/workbench/DialogueTreeEditor";
import {
	fetchQuestDetailPage,
	fetchCategoryDetail,
	fetchQuests,
	fetchCategories,
} from "../lib/api";
import type { QuestDetail, DialogueLine } from "../types";

export const WorkbenchView: React.FC = () => {
	const params = useParams<{ questId?: string; "*": string }>();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();

	const urlQuestId = params.questId || searchParams.get("questId");
	const wildCategory = params["*"];
	const urlCategoryName =
		wildCategory ||
		searchParams.get("categoryName") ||
		searchParams.get("category");

	const initialMode: "quest" | "category" = urlCategoryName
		? "category"
		: "quest";
	const [mode, setMode] = useState<"quest" | "category">(initialMode);
	const [selectedQuestId, setSelectedQuestId] = useState<string>(
		urlQuestId || "102000000",
	);
	const [selectedCategoryName, setSelectedCategoryName] = useState<string>(
		urlCategoryName || "Item/ItemInfo",
	);
	const [questSearch, setQuestSearch] = useState("");
	const [categorySearch, setCategorySearch] = useState("");
	const [questPage, setQuestPage] = useState(1);
	const [categoryPage, setCategoryPage] = useState(1);
	const questPageSize = 200;
	const categoryPageSize = 200;
	const [activeTab, setActiveTab] = useState<"translator" | "tree">(
		"translator",
	);

	useEffect(() => {
		if (urlCategoryName) {
			setMode("category");
			setSelectedCategoryName(urlCategoryName);
			setCategoryPage(1);
		} else if (urlQuestId) {
			setMode("quest");
			setSelectedQuestId(urlQuestId);
			setQuestPage(1);
		}
	}, [urlQuestId, urlCategoryName]);

	// Fetch lists for selector dropdown
	const { data: questListData } = useQuery({
		queryKey: ["questsListWorkbench", questSearch],
		queryFn: () => fetchQuests({ q: questSearch, sort: "id_asc", limit: 100 }),
	});

	const { data: categoryListData } = useQuery({
		queryKey: ["categoriesListWorkbench", categorySearch],
		queryFn: () => fetchCategories({ q: categorySearch, limit: 100 }),
	});

	// Fetch quest detail page when in quest mode
	const { data: questDetailData, isLoading: isLoadingQuest } = useQuery({
		queryKey: ["questDetail", selectedQuestId, questPage],
		queryFn: () =>
			fetchQuestDetailPage(selectedQuestId, {
				page: questPage,
				pageSize: questPageSize,
			}),
		enabled: mode === "quest" && !!selectedQuestId,
	});

	// Fetch category detail when in category mode
	const { data: categoryDetailData, isLoading: isLoadingCategory } = useQuery({
		queryKey: ["categoryDetailWorkbench", selectedCategoryName, categoryPage],
		queryFn: () =>
			fetchCategoryDetail(selectedCategoryName, {
				page: categoryPage,
				limit: categoryPageSize,
			}),
		enabled: mode === "category" && !!selectedCategoryName,
	});

	// Adapter converting Category items into QuestDetail interface for Workbench
	const categoryWorkbenchAdapter: QuestDetail | null = useMemo(() => {
		if (!categoryDetailData) return null;
		const items = categoryDetailData.items || [];
		const lines: DialogueLine[] = items.map((item, idx) => ({
			id: `line_${item.key || idx + 1}`,
			lineNo: (categoryPage - 1) * categoryPageSize + idx + 1,
			type: "dialogue",
			speaker: {
				id: "key",
				name: {
					en: item.key,
					id: item.key,
					"zh-Hans": item.key,
					ja: item.key,
				},
			},
			text: {
				en: item.text?.en || "",
				id: item.text?.id || "",
				"zh-Hans": item.text?.["zh-Hans"] || "",
				ja: item.text?.ja || "",
			},
		}));

		return {
			id: `cat:${categoryDetailData.name}`,
			chapterId: "category",
			chapterTitle: "Kategori Teks UI Game",
			title: {
				en: categoryDetailData.name,
				id: categoryDetailData.name,
				"zh-Hans": categoryDetailData.name,
				ja: categoryDetailData.name,
			},
			summary: {
				en: `Text category workbench: ${categoryDetailData.name}`,
				id: `Arsip penerjemahan kategori teks: ${categoryDetailData.name}`,
			},
			type: "side",
			totalLines: categoryDetailData.filteredItems,
			translatedLines: categoryDetailData.translatedItems || 0,
			lines,
			updatedAt: new Date().toISOString(),
		};
	}, [categoryDetailData, categoryPage, categoryPageSize]);

	const activeQuest: QuestDetail =
		mode === "category"
			? categoryWorkbenchAdapter || {
					id: `cat:${selectedCategoryName}`,
					chapterId: "category",
					chapterTitle: "Kategori Teks UI",
					title: {
						en: selectedCategoryName,
						id: selectedCategoryName,
						"zh-Hans": selectedCategoryName,
						ja: selectedCategoryName,
					},
					summary: { en: "", id: "" },
					type: "side",
					totalLines: 0,
					translatedLines: 0,
					lines: [],
					updatedAt: new Date().toISOString(),
				}
			: questDetailData || MOCK_QUEST_DETAILS["quest_ch1_01"];

	const quests = questListData?.quests || [];
	const categories = categoryListData?.categories || [];

	const handleTargetChange = (val: string) => {
		if (mode === "quest") {
			setSelectedQuestId(val);
			setQuestPage(1);
			navigate(`/workbench?questId=${encodeURIComponent(val)}`);
		} else {
			setSelectedCategoryName(val);
			navigate(`/workbench?categoryName=${encodeURIComponent(val)}`);
		}
	};

	return (
		<div className="h-full flex flex-col space-y-2 overflow-hidden animate-fade-in">
			{/* Sub-Header Bar */}
			<div className="cyber-card px-3.5 py-1.5 shrink-0 flex flex-wrap items-center justify-between gap-3 bg-obsidian-900/90 border-obsidian-800">
				{/* Left Target Switcher */}
				<div className="flex flex-wrap items-center gap-2 text-xs font-mono">
					{/* Mode Switcher Pills */}
					<div className="flex items-center space-x-1 bg-obsidian-950 p-0.5 rounded-lg border border-obsidian-800">
						<button
							onClick={() => {
								setMode("quest");
								navigate(`/workbench?questId=${encodeURIComponent(selectedQuestId)}`);
							}}
							className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-mono transition-all cursor-pointer ${
								mode === "quest"
									? "bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/40 font-bold"
									: "text-slate-400 hover:text-slate-200"
							}`}
						>
							<BookOpen className="w-3 h-3" />
							<span>Quest</span>
						</button>
						<button
							onClick={() => {
								setMode("category");
								navigate(
									`/workbench?categoryName=${encodeURIComponent(selectedCategoryName)}`,
								);
							}}
							className={`flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-mono transition-all cursor-pointer ${
								mode === "category"
									? "bg-cyber-gold/20 text-cyber-gold border border-cyber-gold/40 font-bold"
									: "text-slate-400 hover:text-slate-200"
							}`}
						>
							<Layers className="w-3 h-3" />
							<span>Kategori</span>
						</button>
					</div>

					<span className="text-slate-500">•</span>

					{/* Dropdown Selector */}
					{mode === "quest" ? (
						<>
							<input
								value={questSearch}
								onChange={(e) => setQuestSearch(e.target.value)}
								placeholder="Cari quest / ID..."
								aria-label="Cari quest atau ID"
								className="w-32 bg-obsidian-950 text-slate-200 border border-obsidian-800 rounded px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-cyber-cyan"
							/>
							<select
								value={selectedQuestId}
								onChange={(e) => handleTargetChange(e.target.value)}
								className="bg-obsidian-950 text-cyber-cyan border border-obsidian-800 rounded px-2.5 py-1 text-xs font-mono focus:outline-none max-w-xs truncate cursor-pointer"
							>
								{quests.map((q) => (
									<option key={q.id} value={q.id}>
										#{q.id} - {q.title.id || q.title.en}
									</option>
								))}
							</select>
						</>
					) : (
						<>
							<input
								value={categorySearch}
								onChange={(e) => setCategorySearch(e.target.value)}
								placeholder="Cari kategori..."
								aria-label="Cari kategori"
								className="w-32 bg-obsidian-950 text-slate-200 border border-obsidian-800 rounded px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-cyber-gold"
							/>
							<select
								value={selectedCategoryName}
								onChange={(e) => handleTargetChange(e.target.value)}
								className="bg-obsidian-950 text-cyber-gold border border-obsidian-800 rounded px-2.5 py-1 text-xs font-mono focus:outline-none max-w-xs truncate cursor-pointer"
							>
								{categories.map((c) => (
									<option key={c.id} value={c.name}>
										{c.name} ({c.totalItems} teks)
									</option>
								))}
							</select>
						</>
					)}

					<span className="text-slate-400 font-bold font-sans text-sm hidden sm:inline">
						{mode === "category"
							? selectedCategoryName
							: activeQuest.title?.id || activeQuest.title?.en}
					</span>
				</div>

				{/* View Mode Sub-Tab Switcher */}
				<div className="flex items-center space-x-1 bg-obsidian-950 p-0.5 rounded-lg border border-obsidian-800">
					<button
						onClick={() => setActiveTab("translator")}
						className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all cursor-pointer ${
							activeTab === "translator"
								? "bg-cyber-gold text-obsidian-950 shadow-gold-glow font-bold"
								: "text-slate-300 hover:text-slate-100 hover:bg-obsidian-800"
						}`}
					>
						<Split className="w-3.5 h-3.5" />
						<span>Split-Pane Penerjemah</span>
					</button>

					{mode === "quest" && (
						<button
							onClick={() => setActiveTab("tree")}
							className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all cursor-pointer ${
								activeTab === "tree"
									? "bg-cyber-cyan text-obsidian-950 shadow-cyber-glow font-bold"
									: "text-slate-300 hover:text-slate-100 hover:bg-obsidian-800"
							}`}
						>
							<GitCommit className="w-3.5 h-3.5" />
							<span>Editor Pohon Dialog</span>
						</button>
					)}
				</div>
			</div>

			{mode === "quest" && questDetailData && questDetailData.totalPages > 1 && (
				<div className="shrink-0 flex items-center justify-end gap-2 text-[10px] font-mono text-slate-400">
					<span>
						Dialog {questDetailData.page} / {questDetailData.totalPages}
					</span>
					<button
						type="button"
						onClick={() => setQuestPage((page) => Math.max(1, page - 1))}
						disabled={!questDetailData.hasPreviousPage}
						className="rounded border border-obsidian-700 px-1.5 py-1 disabled:opacity-40"
					>
						‹
					</button>
					<button
						type="button"
						onClick={() => setQuestPage((page) => page + 1)}
						disabled={!questDetailData.hasNextPage}
						className="rounded border border-obsidian-700 px-1.5 py-1 disabled:opacity-40"
					>
						›
					</button>
				</div>
			)}

			{mode === "category" &&
				categoryDetailData &&
				categoryDetailData.totalPages > 1 && (
					<div className="shrink-0 flex items-center justify-end gap-2 text-[10px] font-mono text-slate-400">
						<span>
							Item {categoryDetailData.page} / {categoryDetailData.totalPages}
						</span>
						<button
							type="button"
							onClick={() => setCategoryPage((page) => Math.max(1, page - 1))}
							disabled={categoryPage === 1}
							className="rounded border border-obsidian-700 px-1.5 py-1 disabled:opacity-40"
						>
							‹
						</button>
						<button
							type="button"
							onClick={() =>
								setCategoryPage((page) =>
									Math.min(categoryDetailData.totalPages, page + 1),
								)
							}
							disabled={categoryPage === categoryDetailData.totalPages}
							className="rounded border border-obsidian-700 px-1.5 py-1 disabled:opacity-40"
						>
							›
						</button>
					</div>
				)}

			{/* Active Sub-Tab Content Container */}
			<div className="flex-1 min-h-0 overflow-hidden">
				{mode === "quest" && isLoadingQuest ? (
					<div className="h-full flex items-center justify-center text-xs font-mono text-slate-400">
						Memuat data quest #{selectedQuestId}...
					</div>
				) : mode === "category" && isLoadingCategory ? (
					<div className="h-full flex items-center justify-center text-xs font-mono text-slate-400">
						Memuat berkas kategori {selectedCategoryName}...
					</div>
				) : activeTab === "translator" ? (
					<TranslatorWorkbench quest={activeQuest} />
				) : (
					<DialogueTreeEditor quest={activeQuest} />
				)}
			</div>
		</div>
	);
};
