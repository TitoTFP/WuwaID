import type React from "react";
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import {
	Activity,
	BookOpen,
	Database,
	FileText,
	Layers,
	MessageSquare,
	PenTool,
	Search,
	Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { searchGlobal, type GlobalSearchResult } from "../lib/api";

interface CommandPaletteProps {
	isOpen: boolean;
	onOpen: () => void;
	onClose: () => void;
}

type SearchScope = "all" | "dialogue" | "quest" | "category";
type SearchLang = "en" | "id" | "zh" | "ja";

interface ParsedSearch {
	query: string;
	scope: SearchScope;
	lang: SearchLang;
	speaker?: string;
	untranslated: boolean;
	hasFilter: boolean;
}

function parseSearch(input: string): ParsedSearch {
	let scope: SearchScope = "all";
	let lang: SearchLang = "id";
	let speaker: string | undefined;
	let untranslated = false;
	let hasFilter = false;
	const queryParts: string[] = [];

	for (const part of input.trim().split(/\s+/).filter(Boolean)) {
		const match = part.match(
			/^(quest|category|dialogue|speaker|lang|untranslated):(.*)$/i,
		);
		if (!match) {
			queryParts.push(part);
			continue;
		}

		const value = match[2].trim();
		hasFilter = true;
		switch (match[1].toLowerCase()) {
			case "quest":
				scope = "quest";
				if (value) queryParts.push(value);
				break;
			case "category":
				scope = "category";
				if (value) queryParts.push(value);
				break;
			case "dialogue":
				scope = "dialogue";
				if (value) queryParts.push(value);
				break;
			case "speaker":
				speaker = value || undefined;
				break;
			case "lang":
				if (["en", "id", "zh", "ja"].includes(value.toLowerCase())) {
					lang = value.toLowerCase() as SearchLang;
				}
				break;
			case "untranslated":
				untranslated = true;
				if (["dialog", "dialogue"].includes(value.toLowerCase())) {
					scope = "dialogue";
				} else if (value) {
					queryParts.push(value);
				}
				break;
		}
	}

	return {
		query: queryParts.join(" "),
		scope,
		lang,
		speaker,
		untranslated,
		hasFilter,
	};
}

function resultLabel(result: GlobalSearchResult): string {
	if (result.kind === "dialogue")
		return result.text || result.englishText || "";
	if (result.kind === "quest") return result.title || result.id;
	return result.text || result.title || result.key || result.categoryName || "";
}

function displayRoute(route: string): string {
	try {
		return (
			new URL(route, window.location.origin).pathname.replace("/reader/", "") ||
			"Reader"
		);
	} catch {
		return route;
	}
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
	isOpen,
	onOpen,
	onClose,
}) => {
	const navigate = useNavigate();
	const [search, setSearch] = useState("");
	const [results, setResults] = useState<GlobalSearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [recentRoutes, setRecentRoutes] = useState<string[]>([]);
	const parsed = parseSearch(search);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				isOpen ? onClose() : onOpen();
			}
			if (event.key === "Escape" && isOpen) onClose();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose, onOpen]);

	useEffect(() => {
		if (!isOpen) return;
		setSearch("");
		setResults([]);
		try {
			const saved = JSON.parse(
				localStorage.getItem("wuwaid_recent_routes") || "[]",
			) as unknown;
			setRecentRoutes(
				Array.isArray(saved)
					? saved.filter((item): item is string => typeof item === "string")
					: [],
			);
		} catch {
			setRecentRoutes([]);
		}
	}, [isOpen]);

	useEffect(() => {
		const canSearch =
			parsed.query.length >= 2 ||
			parsed.untranslated ||
			Boolean(parsed.speaker);
		if (!canSearch) {
			setResults([]);
			setIsSearching(false);
			return;
		}

		let active = true;
		setIsSearching(true);
		const timer = window.setTimeout(() => {
			void searchGlobal({
				q: parsed.query,
				lang: parsed.lang,
				scope: parsed.scope,
				speaker: parsed.speaker,
				untranslated: parsed.untranslated,
				limit: 6,
			})
				.then((response) => {
					if (active) setResults(response.results || []);
				})
				.catch(() => {
					if (active) setResults([]);
				})
				.finally(() => {
					if (active) setIsSearching(false);
				});
		}, 150);

		return () => {
			active = false;
			window.clearTimeout(timer);
		};
	}, [
		parsed.query,
		parsed.scope,
		parsed.lang,
		parsed.speaker,
		parsed.untranslated,
	]);

	if (!isOpen) return null;

	const handleSelect = (path: string) => {
		navigate(path);
		const recent = [
			path,
			...recentRoutes.filter((route) => route !== path),
		].slice(0, 5);
		setRecentRoutes(recent);
		localStorage.setItem("wuwaid_recent_routes", JSON.stringify(recent));
		onClose();
	};

	const dialogueResults = results.filter(
		(result) => result.kind === "dialogue",
	);
	const questResults = results.filter((result) => result.kind === "quest");
	const categoryResults = results.filter(
		(result) => result.kind === "category",
	);
	const showRecent = !search.trim() && recentRoutes.length > 0;
	const showCommands = !search.trim() || parsed.hasFilter;
	const filterHint = parsed.hasFilter
		? "Filter: " +
			[
				parsed.scope !== "all" ? parsed.scope : "",
				parsed.lang !== "id" ? `lang=${parsed.lang}` : "",
				parsed.speaker ? `speaker=${parsed.speaker}` : "",
				parsed.untranslated ? "belum diterjemahkan" : "",
			]
				.filter(Boolean)
				.join(" · ")
		: "";

	const renderResult = (result: GlobalSearchResult) => {
		if (result.kind === "dialogue") {
			return (
				<Command.Item
					key={result.id}
					value={`${search} ${resultLabel(result)} ${result.questTitle || ""}`}
					onSelect={() =>
						handleSelect(
							`/reader/quest/${result.questId}#line-${result.lineId}`,
						)
					}
					className="flex flex-col px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-cyber-cyan/10 hover:text-cyber-cyan cursor-pointer transition-colors"
				>
					<div className="flex items-center justify-between text-xs font-mono text-cyber-gold font-bold">
						<span className="flex items-center space-x-1.5 min-w-0">
							<MessageSquare className="w-3.5 h-3.5 shrink-0" />
							<span className="truncate">
								{result.speakerName || "Narrator"} · {result.questTitle}
							</span>
						</span>
						<span className="shrink-0 ml-2">Baris #{result.lineNo}</span>
					</div>
					<p className="text-xs font-sans text-slate-300 line-clamp-1 mt-0.5">
						{result.text || result.englishText}
					</p>
					<span className="text-[10px] font-mono text-slate-500 mt-1">
						{result.translated ? "Sudah ada ID" : "Belum diterjemahkan ke ID"}
					</span>
				</Command.Item>
			);
		}

		if (result.kind === "quest") {
			return (
				<Command.Item
					key={result.id}
					value={`${search} ${result.title || ""} ${result.id}`}
					onSelect={() => handleSelect(`/reader/quest/${result.id}`)}
					className="flex items-center px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-cyber-gold/10 hover:text-cyber-gold cursor-pointer transition-colors"
				>
					<BookOpen className="w-4 h-4 mr-3 text-cyber-gold shrink-0" />
					<div className="min-w-0">
						<p className="truncate font-bold">{result.title}</p>
						<p className="text-[10px] font-mono text-slate-500 truncate">
							{result.id} · {result.chapterTitle} ·{" "}
							{result.translatedLines || 0}/
							{result.translatedTextTotal || result.totalLines || 0} ID
						</p>
					</div>
				</Command.Item>
			);
		}

		const categoryName = result.categoryName || "";
		const encodedCategory = categoryName
			.split("/")
			.map(encodeURIComponent)
			.join("/");
		const categoryPath = result.key
			? `/reader/category/${encodedCategory}?q=${encodeURIComponent(result.key)}`
			: `/reader/category/${encodedCategory}`;
		return (
			<Command.Item
				key={result.id}
				value={`${search} ${resultLabel(result)} ${result.categoryName || ""} ${result.key || ""}`}
				onSelect={() => handleSelect(categoryPath)}
				className="flex items-center px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-cyber-emerald/10 hover:text-cyber-emerald cursor-pointer transition-colors"
			>
				<Layers className="w-4 h-4 mr-3 text-cyber-emerald shrink-0" />
				<div className="min-w-0">
					<p className="truncate font-bold">{resultLabel(result)}</p>
					<p className="text-[10px] font-mono text-slate-500 truncate">
						{result.categoryName}
						{result.key ? ` · ${result.key}` : ""}
						{result.key && <span className="text-cyber-cyan"> · ID</span>}
					</p>
				</div>
			</Command.Item>
		);
	};

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-obsidian-950/80 backdrop-blur-md animate-fade-in">
			<div className="fixed inset-0" onClick={onClose} />
			<div className="relative w-full max-w-2xl bg-obsidian-900 border border-obsidian-700/80 rounded-xl shadow-cyber-glow overflow-hidden z-10">
				<Command className="w-full">
					<div className="flex items-center px-4 border-b border-obsidian-800 bg-obsidian-950/50">
						<Search className="w-5 h-5 text-cyber-cyan mr-3 shrink-0" />
						<Command.Input
							value={search}
							onValueChange={setSearch}
							placeholder="Cari quest, kategori, dialog, atau perintah..."
							className="w-full h-14 bg-transparent text-slate-100 placeholder-slate-400 font-sans focus:outline-none text-sm"
							autoFocus
						/>
						{filterHint && (
							<span className="hidden sm:inline text-[10px] font-mono text-cyber-cyan whitespace-nowrap">
								{filterHint}
							</span>
						)}
						<kbd className="px-2 py-0.5 text-xs font-mono bg-obsidian-800 text-slate-300 rounded border border-obsidian-700">
							ESC
						</kbd>
					</div>

					<Command.List className="max-h-[min(32rem,70vh)] overflow-y-auto p-2 space-y-1">
						{isSearching && (
							<p className="px-3 py-2 text-[10px] font-mono text-cyber-cyan">
								Mencari...
							</p>
						)}
						{dialogueResults.length > 0 && (
							<Command.Group heading="DIALOG" className="palette-heading">
								{dialogueResults.map(renderResult)}
							</Command.Group>
						)}
						{questResults.length > 0 && (
							<Command.Group heading="QUEST" className="palette-heading">
								{questResults.map(renderResult)}
							</Command.Group>
						)}
						{categoryResults.length > 0 && (
							<Command.Group heading="KATEGORI" className="palette-heading">
								{categoryResults.map(renderResult)}
							</Command.Group>
						)}

						{showRecent && (
							<Command.Group
								heading="TERAKHIR DIBUKA"
								className="palette-heading"
							>
								{recentRoutes.map((route) => (
									<Command.Item
										key={route}
										value={`recent ${route}`}
										onSelect={() => handleSelect(route)}
										className="flex items-center px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-obsidian-800 cursor-pointer"
									>
										<Sparkles className="w-4 h-4 mr-3 text-slate-400" />
										<span>{displayRoute(route)}</span>
									</Command.Item>
								))}
							</Command.Group>
						)}

						{showCommands && (
							<>
								<Command.Group heading="NAVIGASI" className="palette-heading">
									<Command.Item
										value="reader buka reader"
										onSelect={() => handleSelect("/reader")}
										className="palette-item"
									>
										<BookOpen className="palette-icon text-cyber-cyan" />
										<span>Buka Reader</span>
									</Command.Item>
									<Command.Item
										value="workbench buka workbench"
										onSelect={() => handleSelect("/workbench")}
										className="palette-item"
									>
										<PenTool className="palette-icon text-cyber-gold" />
										<span>Buka Workbench</span>
									</Command.Item>
									<Command.Item
										value="operations buka operations"
										onSelect={() => handleSelect("/operations")}
										className="palette-item"
									>
										<Activity className="palette-icon text-cyber-emerald" />
										<span>Buka Operations</span>
									</Command.Item>
									<Command.Item
										value="databases buka databases"
										onSelect={() => handleSelect("/databases")}
										className="palette-item"
									>
										<Database className="palette-icon text-cyber-gold" />
										<span>Buka Databases</span>
									</Command.Item>
								</Command.Group>
								<Command.Group heading="AKSI CEPAT" className="palette-heading">
									<Command.Item
										value="drafts review pending"
										onSelect={() => handleSelect("/drafts")}
										className="palette-item"
									>
										<FileText className="palette-icon text-slate-300" />
										<span>Lihat Draft Pending</span>
									</Command.Item>
									<Command.Item
										value="versions riwayat versi"
										onSelect={() => handleSelect("/versions")}
										className="palette-item"
									>
										<Sparkles className="palette-icon text-slate-300" />
										<span>Riwayat Versi Terapan</span>
									</Command.Item>
									<Command.Item
										value="untranslated belum diterjemahkan"
										onSelect={() => setSearch("untranslated:dialogue")}
										className="palette-item"
									>
										<MessageSquare className="palette-icon text-cyber-rose" />
										<span>Cari dialog belum diterjemahkan</span>
									</Command.Item>
								</Command.Group>
							</>
						)}

						{!isSearching && !results.length && search.trim() && (
							<Command.Empty className="py-8 text-center text-sm text-slate-400 font-sans">
								Tidak ada hasil untuk "{search}"
							</Command.Empty>
						)}
					</Command.List>
				</Command>
			</div>
		</div>
	);
};
