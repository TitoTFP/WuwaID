import type React from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FolderTree, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchCategories } from "../lib/api";
import type { TextCategory } from "../types";

export const CategoriesView: React.FC = () => {
	const navigate = useNavigate();
	const [search, setSearch] = useState("");
	const { data, isLoading } = useQuery({
		queryKey: ["categories"],
		queryFn: fetchCategories,
	});

	const categories = data?.categories || [];
	const roots = useMemo(
		() =>
			Array.from(
				new Set(categories.map((category) => category.name.split("/")[0])),
			).sort((a, b) => a.localeCompare(b)),
		[categories],
	);
	const [activeRoot, setActiveRoot] = useState("");
	const selectedRoot = activeRoot || roots[0] || "";
	const visibleCategories = categories.filter((category) => {
		const matchesRoot = category.name.split("/")[0] === selectedRoot;
		const matchesSearch = category.name
			.toLowerCase()
			.includes(search.trim().toLowerCase());
		return matchesRoot && matchesSearch;
	});

	return (
		<div className="h-full flex flex-col space-y-4 overflow-hidden animate-fade-in">
			<div className="shrink-0 border-b border-obsidian-800 pb-3">
				<div className="flex items-center justify-between gap-3">
					<div>
						<p className="text-xs font-mono uppercase tracking-wider text-cyber-gold">
							Database teks game
						</p>
						<h1 className="text-xl font-bold text-slate-100">
							Kategori Teks UI
						</h1>
						<p className="text-xs text-slate-400 font-mono mt-1">
							{categories.length} file kategori terindeks
						</p>
					</div>
					<div className="relative w-56">
						<Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
						<input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Cari kategori..."
							className="w-full bg-obsidian-950 border border-obsidian-800 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyber-gold"
						/>
					</div>
				</div>
			</div>

			<div className="flex gap-2 overflow-x-auto pb-1 shrink-0">
				{roots.map((root) => (
					<button
						key={root}
						type="button"
						onClick={() => setActiveRoot(root)}
						className={`px-3 py-1.5 rounded-lg border text-xs font-mono whitespace-nowrap transition-all ${
							root === selectedRoot
								? "bg-cyber-gold/15 text-cyber-gold border-cyber-gold/40"
								: "bg-obsidian-900 text-slate-400 border-obsidian-800 hover:text-slate-100"
						}`}
					>
						{root}
					</button>
				))}
			</div>

			<div className="flex-1 min-h-0 overflow-y-auto pr-1">
				{isLoading ? (
					<div className="py-16 text-center text-xs font-mono text-slate-400">
						Memuat kategori...
					</div>
				) : visibleCategories.length === 0 ? (
					<div className="py-16 text-center text-xs font-mono text-slate-400">
						Kategori tidak ditemukan.
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
						{visibleCategories.map((category: TextCategory) => (
							<button
								key={category.id}
								type="button"
								onClick={() => navigate(`/categories/${category.name}`)}
								className="text-left cyber-card p-4 space-y-3 bg-obsidian-900/90 border-obsidian-800 hover:border-cyber-gold/50 transition-all group"
							>
								<div className="flex items-start justify-between gap-3">
									<div className="flex items-start gap-2 min-w-0">
										<FolderTree className="w-4 h-4 text-cyber-gold shrink-0 mt-0.5" />
										<span className="text-sm font-mono font-bold text-slate-100 break-words">
											{category.name}
										</span>
									</div>
									<ChevronRight className="w-4 h-4 text-cyber-gold opacity-0 group-hover:opacity-100 shrink-0" />
								</div>
								<div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
									<span>{category.totalItems.toLocaleString()} teks</span>
									<span className="text-cyber-emerald">
										{category.progressPercentage ?? 0}% ID
									</span>
								</div>
								<div className="w-full bg-obsidian-800 rounded-full h-1 overflow-hidden">
									<div
										className="bg-gradient-to-r from-cyber-emerald via-cyber-gold to-cyber-cyan h-full"
										style={{ width: `${category.progressPercentage ?? 0}%` }}
									/>
								</div>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
};
