import type React from "react";
import { useState, useEffect, useMemo } from "react";
import type { QuestDetail } from "../../types";
import { runQACheck, findGlossaryMatches } from "../../lib/qaChecker";
import { submitDraft } from "../../lib/api";
import {
	Save,
	AlertTriangle,
	CheckCircle2,
	Book,
	Sparkles,
	ArrowRight,
	ArrowLeft,
} from "lucide-react";

interface TranslatorWorkbenchProps {
	quest: QuestDetail;
}

export const TranslatorWorkbench: React.FC<TranslatorWorkbenchProps> = ({
	quest,
}) => {
	const [selectedLineIndex, setSelectedLineIndex] = useState<number>(0);
	const [linePage, setLinePage] = useState(1);
	const [targetTexts, setTargetTexts] = useState<Record<string, string>>({});
	const [isSaved, setIsSaved] = useState(true);
	const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);

	const editableLines = useMemo(() => {
		return quest.lines
			? quest.lines.filter((l) => l.type !== "scene_separator")
			: [];
	}, [quest]);
	const linePageSize = 100;
	const linePageCount = Math.max(
		1,
		Math.ceil(editableLines.length / linePageSize),
	);
	const visibleStart = (linePage - 1) * linePageSize;
	const visibleLines = editableLines.slice(
		visibleStart,
		visibleStart + linePageSize,
	);

	useEffect(() => {
		setSelectedLineIndex(0);
		setLinePage(1);
	}, [quest.id, quest.lines]);

	const selectLine = (index: number) => {
		const nextIndex = Math.max(0, Math.min(editableLines.length - 1, index));
		setSelectedLineIndex(nextIndex);
		setLinePage(Math.floor(nextIndex / linePageSize) + 1);
	};

	useEffect(() => {
		const initial: Record<string, string> = {};
		editableLines.forEach((l) => {
			initial[l.id] = l.text.id || "";
		});
		setTargetTexts(initial);
	}, [editableLines]);

	const currentLine = editableLines[selectedLineIndex] || editableLines[0];
	const sourceEn = currentLine?.text.en || "";
	const sourceZh = currentLine?.text["zh-Hans"] || "";
	const currentTargetText = currentLine ? targetTexts[currentLine.id] || "" : "";

	const qaResult = useMemo(() => {
		return runQACheck(sourceEn, currentTargetText);
	}, [sourceEn, currentTargetText]);

	const glossaryMatches = useMemo(() => {
		return findGlossaryMatches(sourceEn);
	}, [sourceEn]);

	const handleTextChange = (newVal: string) => {
		if (!currentLine) return;
		setTargetTexts((prev) => ({
			...prev,
			[currentLine.id]: newVal,
		}));
		setIsSaved(false);
	};

	const handleSaveLine = async () => {
		if (!currentLine) return;
		try {
			await submitDraft({
				questId: quest.id,
				lineId: currentLine.id,
				lineNo: currentLine.lineNo,
				speakerName: currentLine.speaker.name.id || currentLine.speaker.name.en,
				sourceText: sourceEn,
				previousText: currentLine.text.id || "",
				proposedText: currentTargetText,
			});
			setIsSaved(true);
			setSaveSuccessMsg(true);
			setTimeout(() => setSaveSuccessMsg(false), 2000);
		} catch (e) {
			console.error("Failed submitting draft:", e);
		}
	};

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				e.preventDefault();
				handleSaveLine();
				if (selectedLineIndex < editableLines.length - 1) {
					selectLine(selectedLineIndex + 1);
				}
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [selectedLineIndex, editableLines, currentLine, currentTargetText]);

	if (!currentLine) {
		return (
			<div className="h-full flex items-center justify-center text-xs font-mono text-slate-400">
				Tidak ada baris dialog pada quest ini.
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col overflow-hidden animate-fade-in">
			{/* Main 3-Column Split Pane Grid taking 100% full height */}
			<div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch overflow-hidden">
				{/* Left Pane (3 cols): Dialogue Line Selector List */}
				<div className="lg:col-span-3 cyber-card p-3 flex flex-col overflow-hidden">
					<div className="flex items-center justify-between pb-2 border-b border-obsidian-800 text-xs font-mono shrink-0">
						<span className="text-slate-300 font-bold uppercase">Daftar Baris</span>
						<span className="text-cyber-cyan font-bold">
							{editableLines.length} Baris
						</span>
					</div>

					<div className="flex-1 overflow-y-auto pt-2 space-y-1.5 pr-1">
						{visibleLines.map((line, idx) => {
							const globalIndex = visibleStart + idx;
							const textId = targetTexts[line.id] || "";
							const isSelected = globalIndex === selectedLineIndex;

							return (
								<div
									key={line.id}
									onClick={() => selectLine(globalIndex)}
									className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
										isSelected
											? "bg-cyber-gold/15 border-cyber-gold/50 shadow-gold-glow"
											: "bg-obsidian-950/60 border-obsidian-800/80 hover:border-obsidian-700"
									}`}
								>
									<div className="flex items-center justify-between mb-1 font-mono">
										<span
											className={`font-bold ${isSelected ? "text-cyber-gold" : "text-slate-300"}`}
										>
											{line.speaker.name.id || line.speaker.name.en}
										</span>
										<span className="text-[10px] text-slate-400">#{line.lineNo}</span>
									</div>
									<p className="text-[11px] text-slate-400 line-clamp-1 font-sans">
										{textId}
									</p>
								</div>
							);
						})}
					</div>
					{linePageCount > 1 && (
						<div className="flex items-center justify-between border-t border-obsidian-800 pt-2 text-[10px] font-mono text-slate-400">
							<span>
								Halaman {linePage} / {linePageCount}
							</span>
							<div className="flex gap-1">
								<button
									type="button"
									onClick={() => selectLine(visibleStart - 1)}
									disabled={linePage === 1}
									className="rounded border border-obsidian-700 px-1.5 py-1 disabled:opacity-40"
								>
									‹
								</button>
								<button
									type="button"
									onClick={() => selectLine(visibleStart + linePageSize)}
									disabled={linePage === linePageCount}
									className="rounded border border-obsidian-700 px-1.5 py-1 disabled:opacity-40"
								>
									›
								</button>
							</div>
						</div>
					)}
				</div>

				{/* Center Pane (6 cols): Active Line Source & Translation Editor */}
				<div className="lg:col-span-6 cyber-card p-4 flex flex-col justify-between overflow-hidden">
					<div className="flex items-center justify-between pb-2 border-b border-obsidian-800 shrink-0">
						<span className="text-xs font-mono text-cyber-gold uppercase font-bold">
							Baris #{currentLine.lineNo} —{" "}
							{currentLine.speaker.name.id || currentLine.speaker.name.en}
						</span>
						<div className="flex items-center space-x-2">
							<button
								onClick={() => selectLine(selectedLineIndex - 1)}
								disabled={selectedLineIndex === 0}
								className="p-1 rounded bg-obsidian-950 border border-obsidian-800 text-slate-400 hover:text-slate-100 disabled:opacity-30"
							>
								<ArrowLeft className="w-3.5 h-3.5" />
							</button>
							<span className="text-xs font-mono text-slate-300 font-bold">
								{selectedLineIndex + 1} / {editableLines.length}
							</span>
							<button
								onClick={() => selectLine(selectedLineIndex + 1)}
								disabled={selectedLineIndex === editableLines.length - 1}
								className="p-1 rounded bg-obsidian-950 border border-obsidian-800 text-slate-400 hover:text-slate-100 disabled:opacity-30"
							>
								<ArrowRight className="w-3.5 h-3.5" />
							</button>
						</div>
					</div>

					<div className="flex-1 overflow-y-auto space-y-3 py-2 pr-1">
						{/* Source Text Box */}
						<div className="space-y-1 bg-obsidian-950 p-3.5 rounded-lg border border-obsidian-800">
							<span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block font-bold">
								Teks Sumber (Source Text):
							</span>
							<p className="text-sm font-sans text-slate-100 font-semibold leading-relaxed">
								{sourceEn}
							</p>
							{sourceZh && (
								<p className="text-xs font-sans text-slate-300 pt-1.5 border-t border-obsidian-800/60">
									<span className="text-[10px] font-mono text-cyber-cyan font-bold mr-1">
										[ZH]
									</span>{" "}
									{sourceZh}
								</p>
							)}
						</div>

						{/* Target Translation Input */}
						<div className="space-y-1">
							<div className="flex items-center justify-between text-[11px] font-mono">
								<span className="text-cyber-cyan font-bold uppercase">
									Terjemahan Indonesia (Target Input):
								</span>
								{!isSaved && (
									<span className="text-cyber-amber animate-pulse">
										● Belum tersimpan di Draf
									</span>
								)}
							</div>

							<textarea
								value={currentTargetText}
								onChange={(e) => handleTextChange(e.target.value)}
								rows={4}
								placeholder="Ketik terjemahan bahasa Indonesia di sini..."
								className="w-full bg-obsidian-950 border border-obsidian-700 rounded-lg p-3.5 text-sm font-sans text-slate-100 focus:border-cyber-cyan outline-none leading-relaxed"
							/>
						</div>
					</div>

					{/* Action Buttons */}
					<div className="flex items-center justify-between pt-2 border-t border-obsidian-800 shrink-0">
						{saveSuccessMsg ? (
							<span className="text-xs font-mono text-cyber-emerald flex items-center space-x-1 font-bold">
								<CheckCircle2 className="w-3.5 h-3.5" />
								<span>Terjemahan tersimpan ke Draf Backend!</span>
							</span>
						) : (
							<div className="flex items-center space-x-2 text-xs font-mono text-slate-400">
								<kbd className="px-1.5 py-0.5 bg-obsidian-950 border border-obsidian-700 rounded text-cyber-gold font-bold">
									Ctrl+Enter
								</kbd>
								<span>Simpan & Next</span>
							</div>
						)}

						<button
							onClick={handleSaveLine}
							className="flex items-center space-x-2 px-4 py-1.5 rounded-lg bg-cyber-cyan text-obsidian-950 hover:bg-cyber-cyan/90 font-mono text-xs font-bold transition-all shadow-cyber-glow"
						>
							<Save className="w-3.5 h-3.5" />
							<span>Simpan Terjemahan</span>
						</button>
					</div>
				</div>

				{/* Right Pane (3 cols): QA Checker & Glossary Assistant */}
				<div className="lg:col-span-3 flex flex-col space-y-3 overflow-hidden">
					{/* QA Checks Panel */}
					<div className="cyber-card p-3 space-y-2 border-obsidian-800">
						<div className="flex items-center space-x-2 border-b border-obsidian-800 pb-1.5 text-xs font-mono">
							<Sparkles className="w-3.5 h-3.5 text-cyber-cyan" />
							<span className="text-slate-200 font-bold uppercase">QA Check</span>
						</div>

						{qaResult.isValid ? (
							<div className="p-2 rounded bg-cyber-emerald/10 border border-cyber-emerald/30 text-xs font-mono text-cyber-emerald flex items-center space-x-1.5 font-bold">
								<CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
								<span>Format & variabel valid</span>
							</div>
						) : (
							<div className="space-y-1">
								{qaResult.warnings.map((warn, idx) => (
									<div
										key={idx}
										className="p-2 rounded bg-cyber-amber/10 border border-cyber-amber/30 text-xs font-sans text-cyber-amber flex items-start space-x-1"
									>
										<AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
										<span>{warn}</span>
									</div>
								))}
							</div>
						)}
					</div>

					{/* Glossary Matches Panel */}
					<div className="cyber-card p-3 flex-1 flex flex-col overflow-hidden border-obsidian-800">
						<div className="flex items-center space-x-2 border-b border-obsidian-800 pb-1.5 text-xs font-mono shrink-0">
							<Book className="w-3.5 h-3.5 text-cyber-gold" />
							<span className="text-slate-200 font-bold uppercase">
								Saran Glosarium
							</span>
						</div>

						<div className="flex-1 overflow-y-auto pt-2 space-y-1.5 pr-1">
							{glossaryMatches.length > 0 ? (
								glossaryMatches.map((item, idx) => (
									<div
										key={idx}
										className="p-2 rounded bg-obsidian-950 border border-obsidian-800 text-xs space-y-0.5"
									>
										<div className="flex items-center justify-between font-mono">
											<span className="text-cyber-gold font-bold">{item.term}</span>
											<span className="text-[9px] text-slate-400">{item.category}</span>
										</div>
										<div className="text-slate-300 font-sans text-[11px]">
											Acuan:{" "}
											<strong className="text-cyber-cyan">{item.translation}</strong>
										</div>
									</div>
								))
							) : (
								<p className="text-xs font-mono text-slate-400 italic">
									Tidak ada istilah glosarium.
								</p>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
