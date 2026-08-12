import type React from "react";
import { useState } from "react";
import type { QuestDetail } from "../../types";
import { GitCommit, CornerDownRight, Plus } from "lucide-react";

interface DialogueTreeEditorProps {
	quest: QuestDetail;
}

export const DialogueTreeEditor: React.FC<DialogueTreeEditorProps> = ({
	quest,
}) => {
	const [selectedNodeId, setSelectedNodeId] = useState<string>(
		quest.lines[0]?.id || "",
	);

	const selectedLine =
		quest.lines.find((l) => l.id === selectedNodeId) || quest.lines[0];

	return (
		<div className="space-y-4 animate-fade-in">
			<div className="cyber-card p-4 flex items-center justify-between bg-obsidian-900 border-obsidian-800">
				<div>
					<h2 className="text-sm font-bold text-slate-100 flex items-center space-x-2 font-mono">
						<GitCommit className="w-4 h-4 text-cyber-gold" />
						<span>Interactive Dialogue Tree & Branch Structure Editor</span>
					</h2>
					<p className="text-xs text-slate-400 font-mono mt-0.5">
						Kelola alur percakapan, cabang pilihan (Dialogue Choices), dan
						struktur ID speaker.
					</p>
				</div>
				<span className="px-2.5 py-1 bg-cyber-gold/10 border border-cyber-gold/30 text-cyber-gold text-xs font-mono rounded">
					Structural Mode
				</span>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
				{/* Left Column (5 cols): Visual Dialogue Tree Navigator */}
				<div className="lg:col-span-5 cyber-card p-4 space-y-3 max-h-[600px] overflow-y-auto">
					<div className="flex items-center justify-between pb-2 border-b border-obsidian-800 text-xs font-mono">
						<span className="text-slate-400 font-bold uppercase">
							Pohon Percabangan Dialog
						</span>
						<span className="text-cyber-gold">{quest.lines.length} Node</span>
					</div>

					<div className="space-y-2">
						{quest.lines.map((line) => {
							const isSelected = line.id === selectedNodeId;
							const isSeparator = line.type === "scene_separator";
							const isChoice = line.type === "choice";

							if (isSeparator) {
								return (
									<div
										key={line.id}
										className="py-2 text-center text-xs font-mono text-cyber-cyan border-y border-obsidian-800"
									>
										{line.text.id || ""}
									</div>
								);
							}

							return (
								<div
									key={line.id}
									onClick={() => setSelectedNodeId(line.id)}
									className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
										isSelected
											? "bg-cyber-cyan/15 border-cyber-cyan/50 shadow-cyber-glow"
											: "bg-obsidian-950 border-obsidian-800 hover:border-obsidian-700"
									}`}
								>
									<div className="flex items-center justify-between font-mono mb-1">
										<span className="font-bold text-slate-200">
											#{line.lineNo} •{" "}
											{line.speaker.name.id || line.speaker.name.en}
										</span>
										{isChoice && (
											<span className="px-2 py-0.5 bg-cyber-gold/20 text-cyber-gold rounded text-[10px]">
												Choice Branch
											</span>
										)}
									</div>
									<p className="text-slate-400 text-xs font-sans line-clamp-1">
										{line.text.id || ""}
									</p>

									{isChoice && line.options && (
										<div className="mt-2 space-y-1 pl-3 border-l border-cyber-gold/40">
											{line.options.map((opt) => (
												<div
													key={opt.id}
													className="text-[11px] text-cyber-gold flex items-center space-x-1"
												>
													<CornerDownRight className="w-3 h-3 shrink-0" />
													<span className="line-clamp-1">
														{opt.text.id || ""}
													</span>
												</div>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>

				{/* Right Column (7 cols): Selected Node Inspector & Branch Editor */}
				<div className="lg:col-span-7 cyber-card p-5 space-y-4">
					<div className="flex items-center justify-between pb-3 border-b border-obsidian-800">
						<span className="text-xs font-mono text-cyber-cyan font-bold uppercase">
							Inspector Node #{selectedLine?.lineNo} ({selectedLine?.id})
						</span>
						<div className="flex items-center space-x-2">
							<button className="px-2.5 py-1 rounded bg-cyber-cyan/10 border border-cyber-cyan/30 text-cyber-cyan text-xs font-mono flex items-center space-x-1 hover:bg-cyber-cyan/20">
								<Plus className="w-3.5 h-3.5" />
								<span>Tambah Node Baru</span>
							</button>
						</div>
					</div>

					<div className="space-y-4">
						{/* Speaker ID & Name Field */}
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className="text-[11px] font-mono text-slate-400 block mb-1">
									Speaker ID:
								</label>
								<input
									type="text"
									value={selectedLine?.speaker.id || ""}
									readOnly
									className="w-full bg-obsidian-950 border border-obsidian-800 rounded px-3 py-1.5 text-xs font-mono text-slate-300"
								/>
							</div>
							<div>
								<label className="text-[11px] font-mono text-slate-400 block mb-1">
									Nama Speaker (EN):
								</label>
								<input
									type="text"
									value={selectedLine?.speaker.name.en || ""}
									readOnly
									className="w-full bg-obsidian-950 border border-obsidian-800 rounded px-3 py-1.5 text-xs font-mono text-slate-300"
								/>
							</div>
						</div>

						{/* Teks Sumber EN */}
						<div>
							<label className="text-[11px] font-mono text-slate-400 block mb-1">
								Teks Dialog Sumber (English):
							</label>
							<textarea
								value={selectedLine?.text.en || ""}
								readOnly
								rows={3}
								className="w-full bg-obsidian-950 border border-obsidian-800 rounded p-3 text-xs font-mono text-slate-300"
							/>
						</div>

						{/* If Choice Node, show options editor */}
						{selectedLine?.type === "choice" && selectedLine.options && (
							<div className="space-y-2 pt-2 border-t border-obsidian-800">
								<label className="text-[11px] font-mono text-cyber-gold font-bold block">
									Cabang Opsi Percakapan (Choices Options):
								</label>

								{selectedLine.options.map((opt, idx) => (
									<div
										key={opt.id}
										className="p-3 rounded bg-obsidian-950 border border-obsidian-800 space-y-2"
									>
										<div className="flex items-center justify-between text-xs font-mono">
											<span className="text-cyber-gold font-bold">
												Opsi #{idx + 1} ({opt.id})
											</span>
										</div>
										<input
											type="text"
											value={opt.text.id || ""}
											readOnly
											className="w-full bg-obsidian-900 border border-obsidian-800 rounded px-2.5 py-1 text-xs font-sans text-slate-200"
										/>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};
