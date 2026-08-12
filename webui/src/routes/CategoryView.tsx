import type React from "react";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	Search,
	Globe,
	ChevronLeft,
	ChevronRight,
	FileText,
	CheckCircle2,
	PenTool,
} from "lucide-react";
import {
	downloadCategoryDb,
	type ExportMode,
	fetchCategoryDetail,
} from "../lib/api";
import { ExportDbMenu } from "../components/common/ExportDbMenu";

import type { LanguageCode } from "../types";

export const CategoryView: React.FC = () => {
	const params = useParams<{ "*": string }>();
	const categoryName = params["*"] || "";
	const navigate = useNavigate();

	const [searchQuery, setSearchQuery] = useState(() => {
		const params = new URLSearchParams(window.location.search);
		return params.get("q") || "";
	});
	const [page, setPage] = useState(1);
	const [primaryLang, setPrimaryLang] = useState<LanguageCode>("id");
	const [secondaryLang, setSecondaryLang] = useState<LanguageCode>("en");
	const [exportingMode, setExportingMode] = useState<ExportMode | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);

	const handleExport = async (mode: ExportMode) => {
		setExportingMode(mode);
		setExportError(null);
		try {
			await downloadCategoryDb(categoryName!, mode);
		} catch (error) {
			setExportError(error instanceof Error ? error.message : "Ekspor gagal.");
		} finally {
			setExportingMode(null);
		}
	};

	const { data, isLoading } = useQuery({
		queryKey: ["categoryDetail", categoryName, searchQuery, page],
		queryFn: () =>
			fetchCategoryDetail(categoryName!, { q: searchQuery, page, limit: 50 }),
		enabled: !!categoryName,
	});

	if (!categoryName) {
		return (
			<div className="p-4 text-xs font-mono text-slate-400">
				Kategori tidak ditemukan.
			</div>
		);
	}

	const items = data?.items || [];
	const totalPages = data?.totalPages || 1;

	return (
		<div className="h-full flex flex-col space-y-3 overflow-hidden animate-fade-in">
			{/* Top Navigation Bar */}
			<div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-obsidian-800 pb-2.5">
				<div className="flex items-center space-x-3">
					<button
						onClick={() => navigate("/reader")}
						className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-obsidian-900 border border-obsidian-800 hover:border-cyber-cyan text-xs font-mono text-cyber-cyan transition-all"
					>
						<ArrowLeft className="w-4 h-4" />
						<span>Kembali ke Reader</span>
					</button>

					<div className="space-y-1">
						<h1 className="text-base sm:text-lg font-bold text-slate-100 font-sans flex items-center space-x-2">
							<span className="text-cyber-gold font-mono text-xs px-2 py-0.5 bg-cyber-gold/10 rounded border border-cyber-gold/30 uppercase">
								{data?.name || categoryName}
							</span>
							<span>Kategori Teks UI Game</span>
							<span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-cyber-emerald/10 text-cyber-emerald border border-cyber-emerald/30">
								{data?.progressPercentage ?? 0}% Terjemah
							</span>
						</h1>

						<div className="flex items-center space-x-3 text-xs text-slate-400 font-mono">
							<span>
								{data?.translatedItems ?? 0} /{" "}
								{data?.translatedTextTotal ?? data?.totalItems ?? 0}{" "}
								tertranslasi
							</span>
							<span className="text-slate-500">
								• {data?.filteredItems ?? 0} teks ditemukan
							</span>
							<span>•</span>
							<div className="flex items-center space-x-2 w-48">
								<div className="w-full bg-obsidian-800 rounded-full h-1.5 overflow-hidden">
									<div
										className="bg-gradient-to-r from-cyber-emerald via-cyber-gold to-cyber-cyan h-full rounded-full transition-all duration-300"
										style={{ width: `${data?.progressPercentage ?? 0}%` }}
									/>
								</div>
								<span className="text-cyber-emerald font-bold">
									{data?.progressPercentage ?? 0}%
								</span>
							</div>
						</div>
					</div>
				</div>

				{/* Toolbar Controls */}
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={() =>
							navigate(
								`/workbench?categoryName=${encodeURIComponent(categoryName)}`,
							)
						}
						className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-cyber-gold/15 text-cyber-gold border border-cyber-gold/40 hover:bg-cyber-gold/25 text-xs font-mono font-bold transition-all shadow-gold-glow cursor-pointer"
						title="Buka kategori teks ini di Workbench untuk diedit/diterjemahkan"
					>
						<PenTool className="w-3.5 h-3.5" />
						<span>Buka di Workbench</span>
					</button>

					<ExportDbMenu
						onExport={(mode) => void handleExport(mode)}
						exportingMode={exportingMode}
						error={exportError}
					/>
					{/* Search Input */}
					<div className="relative w-56">
						<Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => {
								setSearchQuery(e.target.value);
								setPage(1);
							}}
							placeholder="Cari key ID atau teks..."
							className="w-full bg-obsidian-950 border border-obsidian-800 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-cyber-cyan"
						/>
					</div>

					{/* Language Selector */}
					<div className="flex items-center space-x-1.5 text-xs font-mono bg-obsidian-950 p-1 rounded border border-obsidian-800">
						<Globe className="w-3.5 h-3.5 text-cyber-gold shrink-0 ml-1" />
						<select
							value={primaryLang}
							onChange={(e) => setPrimaryLang(e.target.value as LanguageCode)}
							className="bg-transparent text-cyber-gold text-xs font-mono focus:outline-none"
						>
							<option value="id">Indonesia (ID)</option>
							<option value="en">English (EN)</option>
							<option value="zh-Hans">简体中文 (ZH)</option>
							<option value="ja">日本語 (JA)</option>
						</select>
						<span className="text-slate-500">+</span>
						<select
							value={secondaryLang}
							onChange={(e) => setSecondaryLang(e.target.value as LanguageCode)}
							className="bg-transparent text-slate-300 text-xs font-mono focus:outline-none"
						>
							<option value="en">Pembanding: EN</option>
							<option value="zh-Hans">Pembanding: ZH</option>
							<option value="ja">Pembanding: JA</option>
							<option value="id">Pembanding: ID</option>
						</select>
					</div>
				</div>
			</div>

			{/* Main Content Area */}
			<div className="flex-1 min-h-0 overflow-y-auto pr-1">
				{isLoading ? (
					<div className="py-16 text-center text-xs font-mono text-slate-400">
						Memuat data teks kategori {categoryName}...
					</div>
				) : items.length === 0 ? (
					<div className="py-16 text-center text-xs font-mono text-slate-400">
						Tidak ada item teks yang cocok dengan kata kunci "{searchQuery}".
					</div>
				) : (
					<div className="space-y-2.5">
						{items.map((item) => {
							const textPrimary = item.text[primaryLang] || "";
							const textSecondary =
								item.text[secondaryLang] || item.text["zh-Hans"] || "";

							return (
								<div
									key={item.key}
									className="cyber-card p-3.5 space-y-2 bg-obsidian-900/90 border-obsidian-800 hover:border-cyber-gold/40 transition-all"
								>
									<div className="flex items-center justify-between text-xs font-mono">
										<span className="flex items-center space-x-1.5 text-cyber-gold font-bold bg-cyber-gold/10 px-2 py-0.5 rounded border border-cyber-gold/30">
											<FileText className="w-3 h-3" />
											<span>{item.key}</span>
										</span>
										<CheckCircle2 className="w-3.5 h-3.5 text-cyber-emerald" />
									</div>

									<div className="space-y-1">
										<p className="text-sm font-sans font-semibold text-slate-100 leading-relaxed">
											{textPrimary}
										</p>
										{textSecondary && (
											<p className="text-xs font-sans text-slate-400 pt-1 border-t border-obsidian-800/60">
												<span className="text-[10px] font-mono text-cyber-cyan font-bold uppercase mr-1">
													[{secondaryLang}]
												</span>{" "}
												{textSecondary}
											</p>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Pagination Footer */}
			{totalPages > 1 && (
				<div className="shrink-0 flex items-center justify-between pt-2 border-t border-obsidian-800 text-xs font-mono">
					<span className="text-slate-400">
						Halaman {page} dari {totalPages}
					</span>

					<div className="flex items-center space-x-2">
						<button
							onClick={() => setPage((p) => Math.max(1, p - 1))}
							disabled={page === 1}
							className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-obsidian-950 border border-obsidian-800 text-slate-300 hover:text-slate-100 disabled:opacity-40"
						>
							<ChevronLeft className="w-4 h-4" />
							<span>Sebelumnya</span>
						</button>

						<button
							onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
							disabled={page === totalPages}
							className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-obsidian-950 border border-obsidian-800 text-slate-300 hover:text-slate-100 disabled:opacity-40"
						>
							<span>Berikutnya</span>
							<ChevronRight className="w-4 h-4" />
						</button>
					</div>
				</div>
			)}
		</div>
	);
};
