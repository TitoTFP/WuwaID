import type React from "react";
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { QuestDetail, LanguageCode } from "../../types";
import { DialogueLineCard } from "./DialogueLineCard";
import { Search, Globe, Filter, PenTool } from "lucide-react";
import { downloadQuestDb, type ExportMode } from "../../lib/api";
import { ExportDbMenu } from "../common/ExportDbMenu";

interface QuestStreamViewerProps {
	quest: QuestDetail;
}

export const QuestStreamViewer: React.FC<QuestStreamViewerProps> = ({
	quest,
}) => {
	const navigate = useNavigate();
	const [primaryLang, setPrimaryLang] = useState<LanguageCode>("id");
	const [secondaryLang, setSecondaryLang] = useState<LanguageCode>("en");
	const [selectedSpeaker, setSelectedSpeaker] = useState<string>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [exportingMode, setExportingMode] = useState<ExportMode | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);

	const handleExport = async (mode: ExportMode) => {
		setExportingMode(mode);
		setExportError(null);
		try {
			await downloadQuestDb(quest.id, mode);
		} catch (error) {
			setExportError(error instanceof Error ? error.message : "Ekspor gagal.");
		} finally {
			setExportingMode(null);
		}
	};

	const uniqueSpeakers = useMemo(() => {
		if (!quest.lines) return [];
		const speakerMap = new Map<string, string>();
		quest.lines.forEach((l) => {
			if (l.speaker && l.speaker.name) {
				const name =
					l.speaker.name[primaryLang] || l.speaker.name.en || l.speaker.id;
				speakerMap.set(l.speaker.id, name);
			}
		});
		return Array.from(speakerMap.entries()).map(([id, name]) => ({ id, name }));
	}, [quest, primaryLang]);

	const filteredLines = useMemo(() => {
		if (!quest.lines) return [];
		return quest.lines.filter((line) => {
			if (selectedSpeaker !== "all" && line.speaker?.id !== selectedSpeaker) {
				return false;
			}
			if (searchQuery.trim() !== "") {
				const query = searchQuery.toLowerCase();
				const textPri = (line.text[primaryLang] || "").toLowerCase();
				const textSec = secondaryLang
					? (line.text[secondaryLang] || "").toLowerCase()
					: "";
				const speakerName = (
					line.speaker?.name[primaryLang] || ""
				).toLowerCase();
				return (
					textPri.includes(query) ||
					textSec.includes(query) ||
					speakerName.includes(query)
				);
			}
			return true;
		});
	}, [quest, selectedSpeaker, searchQuery, primaryLang, secondaryLang]);

	useEffect(() => {
		const hash = window.location.hash;
		if (!hash.startsWith("#line-")) return;
		const timer = window.setTimeout(() => {
			document.getElementById(hash.slice(1))?.scrollIntoView({
				behavior: "smooth",
				block: "center",
			});
		}, 100);
		return () => window.clearTimeout(timer);
	}, [quest.id]);

	return (
		<div className="h-full flex flex-col space-y-3 overflow-hidden animate-fade-in">
			{/* Compact Quest Header */}
			<div className="cyber-card p-3.5 shrink-0 border-obsidian-800 flex items-center justify-between gap-3 bg-obsidian-900/90">
				<div className="flex items-center space-x-3">
					<div>
						<div className="flex items-center space-x-2 text-xs font-mono">
							<span className="text-cyber-cyan font-bold">
								{quest.chapterTitle}
							</span>
							<span className="text-slate-500">•</span>
							<span className="text-slate-400">
								{quest.translatedLines ?? 0} /{" "}
								{quest.translatedTextTotal ?? quest.totalLines} tertranslasi
							</span>
						</div>
						<h1 className="text-base sm:text-lg font-bold text-slate-100 font-sans">
							{quest.title[primaryLang] || quest.title.en}
						</h1>
					</div>
				</div>

				{/* Reader Control Toolbar */}
				<div className="flex flex-wrap items-center gap-2">
					{/* Buka di Workbench Button */}
					<button
						onClick={() => navigate(`/workbench?questId=${quest.id}`)}
						className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-cyber-gold/15 border border-cyber-gold/40 text-cyber-gold hover:bg-cyber-gold/25 font-mono text-xs font-bold transition-all shadow-gold-glow"
						title="Buka quest ini di Workbench untuk diterjemahkan"
					>
						<PenTool className="w-3.5 h-3.5" />
						<span>Buka di Workbench</span>
					</button>

					<ExportDbMenu
						onExport={(mode) => void handleExport(mode)}
						exportingMode={exportingMode}
						error={exportError}
					/>

					{/* Language Selectors */}
					<div className="flex items-center space-x-1.5 text-xs font-mono bg-obsidian-950 p-1 rounded border border-obsidian-800">
						<Globe className="w-3.5 h-3.5 text-cyber-cyan shrink-0 ml-1" />
						<select
							value={primaryLang}
							onChange={(e) => setPrimaryLang(e.target.value as LanguageCode)}
							className="bg-transparent text-cyber-cyan text-xs font-mono focus:outline-none"
						>
							<option value="id">Indonesia (ID)</option>
							<option value="en">English (EN)</option>
							<option value="zh-Hans">简体中文 (ZH)</option>
							<option value="ja">日本語 (JA)</option>
						</select>
						<span className="text-slate-500">+</span>
						<select
							value={secondaryLang || ""}
							onChange={(e) => setSecondaryLang(e.target.value as LanguageCode)}
							className="bg-transparent text-slate-300 text-xs font-mono focus:outline-none"
						>
							<option value="en">Pembanding: EN</option>
							<option value="zh-Hans">Pembanding: ZH</option>
							<option value="ja">Pembanding: JA</option>
							<option value="id">Pembanding: ID</option>
						</select>
					</div>

					{/* Speaker Filter */}
					<div className="flex items-center space-x-1 text-xs font-mono bg-obsidian-950 p-1 rounded border border-obsidian-800">
						<Filter className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
						<select
							value={selectedSpeaker}
							onChange={(e) => setSelectedSpeaker(e.target.value)}
							className="bg-transparent text-slate-300 text-xs font-mono focus:outline-none max-w-[140px] truncate"
						>
							<option value="all">Semua Speaker</option>
							{uniqueSpeakers.map((sp) => (
								<option key={sp.id} value={sp.id}>
									{sp.name}
								</option>
							))}
						</select>
					</div>

					{/* Dialogue Search Input */}
					<div className="relative">
						<Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Cari..."
							className="bg-obsidian-950 border border-obsidian-800 rounded pl-8 pr-2 py-1 text-xs font-mono text-slate-200 w-28 focus:w-44 focus:border-cyber-cyan transition-all outline-none"
						/>
					</div>
				</div>
			</div>

			{/* Stream Dialogue Cards List */}
			<div className="flex-1 overflow-y-auto space-y-2 pr-1">
				{filteredLines.length === 0 ? (
					<div className="py-12 text-center text-xs font-mono text-slate-400">
						Tidak ada baris dialog yang cocok dengan filter.
					</div>
				) : (
					filteredLines.map((line) => (
						<DialogueLineCard
							key={line.id}
							line={line}
							primaryLang={primaryLang}
							secondaryLang={secondaryLang}
						/>
					))
				)}
			</div>
		</div>
	);
};
