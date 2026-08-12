import type React from "react";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
	BookOpen,
	Globe,
	Layers,
	Activity,
	Sparkles,
	ChevronRight,
	ArrowLeft,
	Search,
	FileText,
	Filter,
	ArrowUpDown,
} from "lucide-react";
import {
	fontMockData,
	MOCK_QUEST_DETAILS,
	MOCK_TEXT_CATEGORIES,
} from "../mockData/quests";
import { QuestStreamViewer } from "../components/reader/QuestStreamViewer";
import { CyberSelect } from "../components/common/CyberSelect";
import {
	fetchChapters,
	fetchQuests,
	fetchCategories,
	fetchMetrics,
	fetchQuestDetail,
} from "../lib/api";
import type { QuestSummary } from "../types";

export const ReaderView: React.FC = () => {
	const { chapterId: urlChapterId, questId: urlQuestId } = useParams<{
		chapterId?: string;
		questId?: string;
	}>();
	const navigate = useNavigate();

	const [questFilterQuery, setQuestFilterQuery] = useState("");
	const [questTypeFilter, setQuestTypeFilter] = useState<string>("all");
	const [questSortOption, setQuestSortOption] = useState<
		"id_asc" | "id_desc" | "lines_desc" | "lines_asc" | "name_asc" | "name_desc"
	>("id_asc");
	const [categorySearchQuery, setCategorySearchQuery] = useState("");

	const selectedChapterId = urlChapterId || null;
	const selectedQuestId = urlQuestId || null;

	// Helper for quest type badges
	const getQuestTypeBadge = (q: QuestSummary) => {
		const raw = q.rawQuestType;
		if (raw === 1)
			return {
				label: "MAIN (1)",
				style: "bg-cyber-cyan/10 text-cyber-cyan border-cyber-cyan/30",
			};
		if (raw === 2)
			return {
				label: "WORLD (2)",
				style: "bg-cyber-gold/10 text-cyber-gold border-cyber-gold/30",
			};
		if (raw === 3)
			return {
				label: "COMPANION (3)",
				style: "bg-purple-500/10 text-purple-400 border-purple-500/30",
			};
		if (raw === 4)
			return {
				label: "STORY (4)",
				style: "bg-blue-500/10 text-blue-400 border-blue-500/30",
			};
		if (raw === 7)
			return {
				label: "EVENT (7)",
				style: "bg-pink-500/10 text-pink-400 border-pink-500/30",
			};
		if (raw === 9)
			return {
				label: "DAILY (9)",
				style: "bg-cyber-emerald/10 text-cyber-emerald border-cyber-emerald/30",
			};
		if (raw === 10)
			return {
				label: "TUTORIAL (10)",
				style: "bg-amber-500/10 text-amber-400 border-amber-500/30",
			};
		if (raw === 11)
			return {
				label: "CHALLENGE (11)",
				style: "bg-rose-500/10 text-rose-400 border-rose-500/30",
			};
		if (raw === 14)
			return {
				label: "CHAIN (14)",
				style: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
			};
		if (raw === 100)
			return {
				label: "ACTIVITY (100)",
				style: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
			};
		return {
			label: `SIDE (${raw || "SIDE"})`,
			style: "bg-obsidian-800 text-slate-300 border-obsidian-700",
		};
	};

	// Queries
	const { data: chaptersData } = useQuery({
		queryKey: ["chapters"],
		queryFn: fetchChapters,
	});

	const { data: categoriesData } = useQuery({
		queryKey: ["categories"],
		queryFn: fetchCategories,
	});

	const { data: metricsData } = useQuery({
		queryKey: ["metrics"],
		queryFn: fetchMetrics,
	});

	const { data: chapterQuestsData, isLoading: isLoadingQuests } = useQuery({
		queryKey: [
			"quests",
			selectedChapterId,
			questFilterQuery,
			questTypeFilter,
			questSortOption,
		],
		queryFn: () =>
			fetchQuests({
				chapterId: selectedChapterId!,
				q: questFilterQuery,
				type: questTypeFilter,
				sort: questSortOption,
			}),
		enabled: !!selectedChapterId && !selectedQuestId,
	});

	const { data: questDetailData } = useQuery({
		queryKey: ["questDetail", selectedQuestId],
		queryFn: () => fetchQuestDetail(selectedQuestId!),
		enabled: !!selectedQuestId,
	});

	const chapters = chaptersData?.chapters || fontMockData;
	const categories = categoriesData?.categories || MOCK_TEXT_CATEGORIES;
	const metrics = metricsData || {
		totalQuests: 1248,
		totalDialogueLines: 42850,
		translationCoverageId: 0,
	};

	const currentChapter = chapters.find((ch) => {
		if (!selectedChapterId) return false;
		const cleanSel = selectedChapterId.replace("ch_", "");
		const cleanCh = ch.id.replace("ch_", "");
		return cleanCh === cleanSel || ch.id === selectedChapterId;
	});

	const activeQuestDetail =
		questDetailData ||
		(selectedQuestId ? MOCK_QUEST_DETAILS[selectedQuestId] : null);

	const questList: QuestSummary[] = chapterQuestsData?.quests || [];

	// Client side fallback filtering/sorting
	const filteredQuests = questList
		.filter((q) => {
			if (questTypeFilter !== "all") {
				if (questTypeFilter === "main" && q.type !== "main") return false;
				if (questTypeFilter === "side" && q.type !== "side") return false;
				if (
					!isNaN(Number(questTypeFilter)) &&
					q.rawQuestType !== Number(questTypeFilter)
				)
					return false;
			}
			if (!questFilterQuery.trim()) return true;
			const qName = (q.title.id || q.title.en || "").toLowerCase();
			return (
				qName.includes(questFilterQuery.toLowerCase()) ||
				q.id.includes(questFilterQuery)
			);
		})
		.sort((a, b) => {
			if (questSortOption === "id_desc") return Number(b.id) - Number(a.id);
			if (questSortOption === "name_asc")
				return (a.title.id || a.title.en || "").localeCompare(
					b.title.id || b.title.en || "",
				);
			if (questSortOption === "name_desc")
				return (b.title.id || b.title.en || "").localeCompare(
					a.title.id || a.title.en || "",
				);
			if (questSortOption === "lines_desc") return b.totalLines - a.totalLines;
			if (questSortOption === "lines_asc") return a.totalLines - b.totalLines;
			return Number(a.id) - Number(b.id);
		});

	// State 3: Active Quest Dialogue Stream View (/reader/quest/:questId)
	if (selectedQuestId && activeQuestDetail) {
		const parentChapterNum = activeQuestDetail.chapterId
			? activeQuestDetail.chapterId.replace("ch_", "")
			: "1";
		return (
			<div className="h-full flex flex-col space-y-2 overflow-hidden animate-fade-in">
				<div className="shrink-0 flex items-center justify-between pb-1">
					<button
						onClick={() => navigate(`/reader/chapter/${parentChapterNum}`)}
						className="flex items-center space-x-1 text-xs font-mono text-cyber-cyan hover:underline"
					>
						<ArrowLeft className="w-3.5 h-3.5" />
						<span>
							Kembali ke Daftar Quest (
							{activeQuestDetail.chapterTitle || "Chapter"})
						</span>
					</button>
				</div>
				<QuestStreamViewer quest={activeQuestDetail} />
			</div>
		);
	}

	// State 2: Selected Chapter Quest List View (/reader/chapter/:chapterId)
	if (selectedChapterId) {
		return (
			<div className="h-full flex flex-col space-y-3 overflow-hidden animate-fade-in">
				{/* Header toolbar */}
				<div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-obsidian-800 pb-2.5">
					<div className="flex items-center space-x-3">
						<button
							onClick={() => {
								setQuestFilterQuery("");
								navigate("/reader");
							}}
							className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-obsidian-900 border border-obsidian-800 hover:border-cyber-cyan text-xs font-mono text-cyber-cyan transition-all"
						>
							<ArrowLeft className="w-4 h-4" />
							<span>Daftar Chapter</span>
						</button>

						<div>
							<h1 className="text-base sm:text-lg font-bold text-slate-100 font-sans flex items-center space-x-2">
								<span className="text-cyber-cyan font-mono text-xs px-2 py-0.5 bg-cyber-cyan/10 rounded border border-cyber-cyan/30">
									{currentChapter
										? currentChapter.number
										: `Chapter ${selectedChapterId}`}
								</span>
								<span>
									{currentChapter ? currentChapter.title : "Daftar Quest"}
								</span>
							</h1>
							<p className="text-xs text-slate-400 font-mono mt-0.5">
								{filteredQuests.length} Quest ditampilkan ({questList.length}{" "}
								total di bab ini)
							</p>
						</div>
					</div>

					{/* Filter & Sort Controls Toolbar */}
					<div className="flex flex-wrap items-center gap-2">
						{/* Search Input */}
						<div className="relative w-48 sm:w-56">
							<Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
							<input
								type="text"
								value={questFilterQuery}
								onChange={(e) => setQuestFilterQuery(e.target.value)}
								placeholder="Cari judul / ID quest..."
								className="w-full bg-obsidian-950 border border-obsidian-800 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyber-cyan"
							/>
						</div>

						{/* Custom Cyber Type Filter */}
						<CyberSelect
							accentColor="cyan"
							icon={<Filter className="w-3.5 h-3.5" />}
							value={questTypeFilter}
							onChange={(val) => setQuestTypeFilter(val)}
							options={[
								{ value: "all", label: "All types" },
								{ value: "1", label: "Main (1)" },
								{ value: "2", label: "World (2)" },
								{ value: "3", label: "Companion (3)" },
								{ value: "4", label: "Story (4)" },
								{ value: "7", label: "Event (7)" },
								{ value: "9", label: "Daily (9)" },
								{ value: "10", label: "Tutorial (10)" },
								{ value: "11", label: "Challenge (11)" },
								{ value: "14", label: "Chain (14)" },
								{ value: "100", label: "Activity (100)" },
							]}
						/>

						{/* Custom Cyber Sort Selector */}
						<CyberSelect
							accentColor="gold"
							icon={<ArrowUpDown className="w-3.5 h-3.5" />}
							value={questSortOption}
							onChange={(val) => setQuestSortOption(val as any)}
							options={[
								{ value: "id_asc", label: "Sort: ID (Kecil → Besar)" },
								{ value: "id_desc", label: "Sort: ID (Besar → Kecil)" },
								{
									value: "lines_desc",
									label: "Sort: Baris Dialog (Terbanyak)",
								},
								{
									value: "lines_asc",
									label: "Sort: Baris Dialog (Tersedikit)",
								},
								{ value: "name_asc", label: "Sort: Nama Quest (A → Z)" },
								{ value: "name_desc", label: "Sort: Nama Quest (Z → A)" },
							]}
						/>
					</div>
				</div>

				{/* Quest Grid List */}
				<div className="flex-1 overflow-y-auto pr-1">
					{isLoadingQuests ? (
						<div className="py-12 text-center text-xs font-mono text-slate-400">
							Memuat daftar quest...
						</div>
					) : filteredQuests.length === 0 ? (
						<div className="py-12 text-center text-xs font-mono text-slate-400">
							Tidak ada quest yang cocok dengan filter atau kata kunci "
							{questFilterQuery}".
						</div>
					) : (
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
							{filteredQuests.map((q) => {
								const badge = getQuestTypeBadge(q);
								return (
									<div
										key={q.id}
										onClick={() => navigate(`/reader/quest/${q.id}`)}
										className="cyber-card cyber-card-hover p-4 space-y-2 cursor-pointer group bg-obsidian-900/90 border-obsidian-800"
									>
										<div className="flex items-center justify-between text-[10px] font-mono">
											<span
												className={`px-2 py-0.5 rounded font-bold border ${badge.style}`}
											>
												{badge.label}
											</span>
											<span className="text-slate-400">
												{q.translatedLines.id} /{" "}
												{q.translatedTextTotal ?? q.totalLines} tertranslasi
											</span>
										</div>

										<h3 className="text-sm font-bold text-slate-100 group-hover:text-cyber-cyan transition-colors flex items-center justify-between">
											<span className="line-clamp-1">
												{q.title.id || q.title.en}
											</span>
											<ChevronRight className="w-4 h-4 text-cyber-cyan opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
										</h3>

										<div className="text-[11px] font-mono text-slate-500 flex items-center space-x-2 pt-1 border-t border-obsidian-800/60">
											<FileText className="w-3 h-3 text-slate-400" />
											<span>ID: {q.id}</span>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>
		);
	}

	// State 1: Chapter Overview View (/reader)
	return (
		<div className="h-full flex flex-col space-y-4 overflow-hidden animate-fade-in">
			{/* Hero Banner */}
			<div className="relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-r from-obsidian-900 via-obsidian-850 to-obsidian-900 border border-obsidian-800 p-5 shadow-panel">
				<div className="absolute top-0 right-0 w-80 h-80 bg-cyber-cyan/5 rounded-full blur-3xl pointer-events-none" />

				<div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
					<div className="space-y-1.5 max-w-2xl">
						<div className="inline-flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-cyber-cyan/10 border border-cyber-cyan/30 text-cyber-cyan text-xs font-mono">
							<Sparkles className="w-3.5 h-3.5" />
							<span>Above the Fold • Standalone Fullstack WebUI</span>
						</div>

						<h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-100 font-sans">
							Wuthering Waves Indonesia{" "}
							<span className="text-transparent bg-clip-text bg-gradient-to-r from-cyber-cyan via-slate-200 to-cyber-gold">
								Quest & Dialogue Archive
							</span>
						</h1>

						<p className="text-slate-400 text-xs sm:text-sm leading-relaxed line-clamp-1">
							Eksplorasi cerita, percakapan dialog multibahasa (EN, ZH-Hans, JA,
							ID), dan database teks game secara instan.
						</p>
					</div>

					{/* Stat Cards */}
					<div className="flex items-center space-x-3">
						<div className="cyber-card px-3 py-2 flex items-center space-x-3">
							<BookOpen className="w-4 h-4 text-cyber-cyan" />
							<div>
								<div className="text-base font-bold font-mono text-slate-100">
									{metrics.totalQuests.toLocaleString()}
								</div>
								<div className="text-[10px] text-slate-500 font-mono">
									Quests
								</div>
							</div>
						</div>

						<div className="cyber-card px-3 py-2 flex items-center space-x-3">
							<Globe className="w-4 h-4 text-cyber-gold" />
							<div>
								<div className="text-base font-bold font-mono text-slate-100">
									{metrics.totalDialogueLines.toLocaleString()}
								</div>
								<div className="text-[10px] text-slate-500 font-mono">
									Baris ID
								</div>
							</div>
						</div>

						<div className="cyber-card px-3 py-2 flex items-center space-x-3">
							<Activity className="w-4 h-4 text-cyber-emerald" />
							<div>
								<div className="text-base font-bold font-mono text-slate-100">
									{metrics.translationCoverageId}%
								</div>
								<div className="text-[10px] text-slate-500 font-mono">
									Cakupan
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Grid Container */}
			<div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
				{/* Chapters Section (8 cols) */}
				<div className="lg:col-span-8 cyber-card p-4 flex flex-col overflow-hidden border-obsidian-800">
					<div className="flex items-center justify-between pb-2 border-b border-obsidian-800 shrink-0">
						<h2 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
							<Layers className="w-4 h-4 text-cyber-cyan" />
							<span>Chapter & Bab Cerita Utama</span>
						</h2>
						<span className="text-xs font-mono text-slate-500">
							{chapters.length} Chapter Aktif
						</span>
					</div>

					<div className="flex-1 overflow-y-auto pt-3 pr-1 space-y-2.5">
						{chapters.map((ch) => {
							const cleanId = ch.id.replace("ch_", "");
							return (
								<div
									key={ch.id}
									onClick={() => navigate(`/reader/chapter/${cleanId}`)}
									className="cyber-card cyber-card-hover p-3.5 space-y-2 cursor-pointer group bg-obsidian-950/60"
								>
									<div className="flex items-center justify-between">
										<span className="text-[11px] font-mono text-cyber-cyan bg-cyber-cyan/10 px-2 py-0.5 rounded border border-cyber-cyan/30 font-bold">
											{ch.number}
										</span>
										<span className="text-[11px] font-mono text-slate-400">
											{ch.progressPercentage}% Selesai
										</span>
									</div>
									<div>
										<h3 className="text-sm font-bold text-slate-100 group-hover:text-cyber-cyan transition-colors flex items-center justify-between">
											<span>{ch.title}</span>
											<ChevronRight className="w-4 h-4 text-cyber-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
										</h3>
										<p className="text-[11px] text-slate-400 mt-0.5 font-mono">
											{ch.questCount} Quests • {ch.totalLines.toLocaleString()}{" "}
											Baris Dialog • {ch.region}
										</p>
									</div>
									<div className="w-full bg-obsidian-800 rounded-full h-1 overflow-hidden">
										<div
											className="bg-gradient-to-r from-cyber-cyan to-cyber-gold h-full rounded-full transition-all duration-300"
											style={{ width: `${ch.progressPercentage}%` }}
										/>
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* Text Categories Section (4 cols) */}
				<div className="lg:col-span-4 cyber-card p-4 flex flex-col overflow-hidden border-obsidian-800">
					<button
						type="button"
						onClick={() => navigate("/categories")}
						className="w-full flex items-center justify-between pb-2 border-b border-obsidian-800 shrink-0 text-left group"
						aria-label="Buka tab kategori teks UI"
					>
						<h2 className="text-sm font-bold text-slate-100 flex items-center space-x-2 group-hover:text-cyber-gold transition-colors">
							<Globe className="w-4 h-4 text-cyber-gold" />
							<span>Kategori Teks UI</span>
						</h2>
						<span className="text-xs font-mono text-slate-500 group-hover:text-cyber-gold transition-colors">
							{categories.length} Kategori{" "}
							<ChevronRight className="inline w-3.5 h-3.5" />
						</span>
					</button>

					{/* Category Search Input */}
					<div className="pt-2 pb-1 shrink-0">
						<div className="relative">
							<Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
							<input
								type="text"
								value={categorySearchQuery}
								onChange={(e) => setCategorySearchQuery(e.target.value)}
								placeholder="Cari kategori (Item, Skill, UI...)..."
								className="w-full bg-obsidian-950 border border-obsidian-800 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyber-gold"
							/>
						</div>
					</div>

					<div className="flex-1 overflow-y-auto pt-2 pr-1 space-y-2.5">
						{categories
							.filter(
								(cat) =>
									!categorySearchQuery.trim() ||
									cat.name
										.toLowerCase()
										.includes(categorySearchQuery.toLowerCase()),
							)
							.map((cat, idx) => (
								<div
									key={cat.id ? `${cat.id}-${idx}` : `${cat.name}-${idx}`}
									onClick={() => navigate(`/reader/category/${cat.name}`)}
									className="cyber-card p-3 space-y-2 bg-obsidian-950/60 hover:border-cyber-gold/50 cursor-pointer group transition-all"
								>
									<div className="flex items-center justify-between">
										<span className="text-xs font-mono font-bold text-cyber-gold group-hover:underline flex items-center space-x-1">
											<span>{cat.name}</span>
											<ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
										</span>
										<span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyber-emerald/10 text-cyber-emerald border border-cyber-emerald/30">
											{cat.progressPercentage ?? 0}%
										</span>
									</div>

									<p className="text-[11px] text-slate-400 font-sans line-clamp-1">
										{cat.description}
									</p>

									<div className="space-y-1">
										<div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
											<span>
												{cat.translatedItems.toLocaleString()} /{" "}
												{cat.totalItems.toLocaleString()} Teks
											</span>
											<span>{cat.progressPercentage ?? 0}%</span>
										</div>
										<div className="w-full bg-obsidian-800 rounded-full h-1 overflow-hidden">
											<div
												className="bg-gradient-to-r from-cyber-emerald via-cyber-gold to-cyber-cyan h-full rounded-full transition-all duration-300"
												style={{ width: `${cat.progressPercentage ?? 0}%` }}
											/>
										</div>
									</div>
								</div>
							))}
					</div>
				</div>
			</div>
		</div>
	);
};
