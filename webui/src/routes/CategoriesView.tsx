import type React from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	ChevronRight,
	FolderTree,
	Search,
	Layers,
	FileText,
	CheckCircle2,
	Filter,
	PenTool,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchCategories } from "../lib/api";
import type { TextCategory } from "../types";

export const CategoriesView: React.FC = () => {
	const navigate = useNavigate();
	const [globalSearch, setGlobalSearch] = useState("");
	const [rootFilter, setRootFilter] = useState("");
	const [selectedRoot, setSelectedRoot] = useState<string>("ALL");

	const { data, isLoading } = useQuery({
		queryKey: ["categories"],
		queryFn: () => fetchCategories(),
	});

	const categories = data?.categories || [];

	// Compute root groups with aggregate statistics
	const rootGroups = useMemo(() => {
		const groupsMap = new Map<
			string,
			{
				name: string;
				count: number;
				totalItems: number;
				translatedItems: number;
				progressPercentage: number;
			}
		>();

		for (const cat of categories) {
			const rootName = cat.name.split("/")[0]?.trim() || "Other";
			const existing = groupsMap.get(rootName) || {
				name: rootName,
				count: 0,
				totalItems: 0,
				translatedItems: 0,
				progressPercentage: 0,
			};

			existing.count += 1;
			existing.totalItems += cat.totalItems || 0;
			existing.translatedItems += cat.translatedItems || 0;
			groupsMap.set(rootName, existing);
		}

		const result = Array.from(groupsMap.values()).map((g) => ({
			...g,
			progressPercentage:
				g.totalItems > 0
					? Math.round((g.translatedItems / g.totalItems) * 10000) / 100
					: 0,
		}));

		result.sort((a, b) => a.name.localeCompare(b.name));
		return result;
	}, [categories]);

	// Filtered list of root groups for left sidebar
	const filteredRootGroups = useMemo(() => {
		if (!rootFilter.trim()) return rootGroups;
		const query = rootFilter.toLowerCase();
		return rootGroups.filter((g) => g.name.toLowerCase().includes(query));
	}, [rootGroups, rootFilter]);

	// Categories matching current selection & search
	const visibleCategories = useMemo(() => {
		return categories.filter((cat) => {
			const catRoot = cat.name.split("/")[0]?.trim() || "";
			const matchesRoot =
				selectedRoot === "ALL" ||
				catRoot.toLowerCase() === selectedRoot.toLowerCase();
			const matchesSearch =
				!globalSearch.trim() ||
				cat.name.toLowerCase().includes(globalSearch.trim().toLowerCase());
			return matchesRoot && matchesSearch;
		});
	}, [categories, selectedRoot, globalSearch]);

	const currentGroupInfo = useMemo(() => {
		if (selectedRoot === "ALL") {
			const totalItems = categories.reduce(
				(acc, c) => acc + (c.totalItems || 0),
				0,
			);
			const translatedItems = categories.reduce(
				(acc, c) => acc + (c.translatedItems || 0),
				0,
			);
			const progressPercentage =
				totalItems > 0
					? Math.round((translatedItems / totalItems) * 10000) / 100
					: 0;
			return {
				name: "Semua Kategori",
				count: categories.length,
				totalItems,
				translatedItems,
				progressPercentage,
			};
		}
		return (
			rootGroups.find(
				(g) => g.name.toLowerCase() === selectedRoot.toLowerCase(),
			) || {
				name: selectedRoot,
				count: visibleCategories.length,
				totalItems: 0,
				translatedItems: 0,
				progressPercentage: 0,
			}
		);
	}, [selectedRoot, categories, rootGroups, visibleCategories]);

	return (
		<div className="h-full flex flex-col space-y-3 overflow-hidden animate-fade-in">
			{/* Top Header */}
			<div className="shrink-0 border-b border-obsidian-800 pb-3 flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="text-[10px] font-mono uppercase tracking-wider text-cyber-gold font-bold flex items-center space-x-1.5">
						<Layers className="w-3.5 h-3.5" />
						<span>Database Teks Resmi Game</span>
					</p>
					<h1 className="text-lg sm:text-xl font-bold text-slate-100 font-sans">
						Manajer Kategori Teks UI & Game
					</h1>
					<p className="text-xs text-slate-400 font-mono mt-0.5">
						{categories.length} file berkas terindeks · {rootGroups.length} grup utama
					</p>
				</div>

				{/* Global Search Input */}
				<div className="relative w-64 sm:w-80">
					<Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
					<input
						value={globalSearch}
						onChange={(e) => setGlobalSearch(e.target.value)}
						placeholder="Cari berkas (Item, UI, Skill...)..."
						className="w-full bg-obsidian-950 border border-obsidian-800 rounded-lg pl-9 pr-3 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyber-gold transition-colors"
					/>
				</div>
			</div>

			{/* Main Split Pane Layout (Vertical Sidebar + Detail Grid) */}
			<div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4 overflow-hidden">
				{/* Left Sidebar: Vertical Root Selector */}
				<div className="w-full md:w-64 lg:w-72 shrink-0 flex flex-col bg-obsidian-900/90 border border-obsidian-800 rounded-xl overflow-hidden shadow-panel">
					{/* Sidebar Header & Search */}
					<div className="p-3 border-b border-obsidian-800 bg-obsidian-950/60 space-y-2">
						<div className="flex items-center justify-between text-xs font-mono font-bold text-slate-300">
							<span className="flex items-center space-x-1.5">
								<FolderTree className="w-3.5 h-3.5 text-cyber-gold" />
								<span>Grup Kategori ({rootGroups.length})</span>
							</span>
						</div>
						<div className="relative">
							<Filter className="w-3 h-3 text-slate-500 absolute left-2.5 top-2" />
							<input
								type="text"
								value={rootFilter}
								onChange={(e) => setRootFilter(e.target.value)}
								placeholder="Filter grup..."
								className="w-full bg-obsidian-950 border border-obsidian-800 rounded pl-7 pr-2 py-1 text-[11px] font-mono text-slate-300 outline-none focus:border-cyber-gold"
							/>
						</div>
					</div>

					{/* Vertical Nav List */}
					<div className="flex-1 overflow-y-auto p-1.5 space-y-1 custom-scrollbar">
						{/* "ALL" Option */}
						<button
							type="button"
							onClick={() => setSelectedRoot("ALL")}
							className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition-all flex items-center justify-between group cursor-pointer ${
								selectedRoot === "ALL"
									? "bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/40 font-bold shadow-sm"
									: "text-slate-300 hover:bg-obsidian-800/80 hover:text-slate-100 border border-transparent"
							}`}
						>
							<span className="flex items-center space-x-2 truncate">
								<Layers className="w-3.5 h-3.5 shrink-0 text-cyber-cyan" />
								<span className="truncate">Semua Kategori</span>
							</span>
							<span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-obsidian-950 text-slate-400 border border-obsidian-800 shrink-0 ml-1">
								{categories.length}
							</span>
						</button>

						<div className="h-px bg-obsidian-800 my-1" />

						{/* Root Groups List */}
						{filteredRootGroups.map((group) => {
							const isSelected = selectedRoot === group.name;
							return (
								<button
									key={group.name}
									type="button"
									onClick={() => setSelectedRoot(group.name)}
									className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition-all flex items-center justify-between group cursor-pointer ${
										isSelected
											? "bg-cyber-gold/15 text-cyber-gold border border-cyber-gold/40 font-bold shadow-sm"
											: "text-slate-300 hover:bg-obsidian-800/80 hover:text-slate-100 border border-transparent"
									}`}
								>
									<div className="min-w-0 pr-2">
										<p className="truncate font-semibold">{group.name}</p>
										<p className="text-[10px] text-slate-500 font-sans truncate">
											{group.count} berkas · {group.totalItems.toLocaleString()} teks
										</p>
									</div>
									<span
										className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 border ${
											group.progressPercentage >= 90
												? "bg-cyber-emerald/10 text-cyber-emerald border-cyber-emerald/30"
												: "bg-cyber-gold/10 text-cyber-gold border-cyber-gold/30"
										}`}
									>
										{group.progressPercentage}%
									</span>
								</button>
							);
						})}
					</div>
				</div>

				{/* Right Content Panel: Category Cards Grid */}
				<div className="flex-1 min-h-0 flex flex-col space-y-3">
					{/* Active Group Header Summary */}
					<div className="shrink-0 bg-obsidian-900/90 border border-obsidian-800 rounded-xl p-3.5 shadow-panel flex flex-wrap items-center justify-between gap-3">
						<div className="space-y-0.5">
							<h2 className="text-sm sm:text-base font-bold text-slate-100 font-sans flex items-center space-x-2">
								<span>{currentGroupInfo.name}</span>
								<span className="text-xs font-mono px-2 py-0.5 rounded bg-cyber-gold/10 text-cyber-gold border border-cyber-gold/30">
									{visibleCategories.length} Berkas Ditampilkan
								</span>
							</h2>
							<p className="text-xs font-mono text-slate-400">
								Total {currentGroupInfo.totalItems.toLocaleString()} teks (
								{currentGroupInfo.translatedItems.toLocaleString()} terjemahan ID)
							</p>
						</div>

						<div className="flex items-center space-x-3 text-xs font-mono min-w-[200px]">
							<div className="flex-1 space-y-1">
								<div className="flex justify-between text-[11px]">
									<span className="text-slate-400">Progres Grup</span>
									<span className="text-cyber-emerald font-bold">
										{currentGroupInfo.progressPercentage}% ID
									</span>
								</div>
								<div className="w-full bg-obsidian-950 rounded-full h-1.5 overflow-hidden border border-obsidian-800">
									<div
										className="bg-gradient-to-r from-cyber-emerald via-cyber-gold to-cyber-cyan h-full transition-all duration-300"
										style={{
											width: `${currentGroupInfo.progressPercentage}%`,
										}}
									/>
								</div>
							</div>
						</div>
					</div>

					{/* Category Cards Grid */}
					<div className="flex-1 min-h-0 overflow-y-auto pr-1">
						{isLoading ? (
							<div className="py-16 text-center text-xs font-mono text-slate-400 flex flex-col items-center space-y-2">
								<div className="w-6 h-6 border-2 border-cyber-gold border-t-transparent rounded-full animate-spin" />
								<span>Memuat daftar kategori...</span>
							</div>
						) : visibleCategories.length === 0 ? (
							<div className="py-16 text-center text-xs font-mono text-slate-400 bg-obsidian-900/50 border border-obsidian-800 rounded-xl p-8">
								Tidak ada kategori yang cocok dengan filter.
							</div>
						) : (
							<div
								key={`grid-${selectedRoot}`}
								className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
							>
								{visibleCategories.map((category: TextCategory, idx: number) => (
									<button
										key={`${selectedRoot}-${category.id}-${idx}`}
										type="button"
										onClick={() => navigate(`/categories/${category.name}`)}
										className="text-left cyber-card p-4 space-y-3 bg-obsidian-900/90 border-obsidian-800 hover:border-cyber-gold/50 transition-all group cursor-pointer flex flex-col justify-between"
									>
										<div className="space-y-2 w-full">
											<div className="flex items-start justify-between gap-2">
												<div className="flex items-start gap-2 min-w-0">
													<FolderTree className="w-4 h-4 text-cyber-gold shrink-0 mt-0.5" />
													<span className="text-xs font-mono font-bold text-slate-100 break-words group-hover:text-cyber-gold transition-colors">
														{category.name}
													</span>
												</div>
												<ChevronRight className="w-4 h-4 text-cyber-gold opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
											</div>

											{category.description && (
												<p className="text-[11px] text-slate-400 font-sans line-clamp-1">
													{category.description}
												</p>
											)}
										</div>

										<div className="space-y-1.5 w-full pt-2 border-t border-obsidian-800/60">
											<div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
												<span>{(category.totalItems || 0).toLocaleString()} teks</span>
												<div className="flex items-center space-x-2">
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															navigate(
																`/workbench?categoryName=${encodeURIComponent(category.name)}`,
															);
														}}
														className="px-2 py-0.5 rounded bg-cyber-gold/15 hover:bg-cyber-gold/25 text-cyber-gold border border-cyber-gold/30 text-[10px] font-mono flex items-center space-x-1 transition-all"
														title="Buka kategori di Workbench"
													>
														<PenTool className="w-3 h-3" />
														<span>Workbench</span>
													</button>
													<span className="text-cyber-emerald font-bold">
														{category.progressPercentage ?? 0}% ID
													</span>
												</div>
											</div>
											<div className="w-full bg-obsidian-950 rounded-full h-1 overflow-hidden border border-obsidian-800">
												<div
													className="bg-gradient-to-r from-cyber-emerald via-cyber-gold to-cyber-cyan h-full"
													style={{
														width: `${category.progressPercentage ?? 0}%`,
													}}
												/>
											</div>
										</div>
									</button>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};
