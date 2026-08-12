import type React from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import type { ExportMode } from "../../lib/api";

const EXPORT_OPTIONS: Array<{ mode: ExportMode; description: string }> = [
	{ mode: "id", description: "Terjemahan Indonesia, fallback English" },
	{ mode: "untranslated", description: "Hanya teks yang belum diterjemahkan" },
	{ mode: "en", description: "Teks English penuh" },
];

const EXPORT_LABELS: Record<ExportMode, string> = {
	id: "ID penuh",
	untranslated: "Belum diterjemahkan",
	en: "English",
};

interface ExportDbMenuProps {
	onExport: (mode: ExportMode) => void;
	exportingMode: ExportMode | null;
	error: string | null;
}

export const ExportDbMenu: React.FC<ExportDbMenuProps> = ({
	onExport,
	exportingMode,
	error,
}) => {
	const [isOpen, setIsOpen] = useState(false);

	const handleExport = (mode: ExportMode) => {
		setIsOpen(false);
		onExport(mode);
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setIsOpen(true)}
				disabled={exportingMode !== null}
				className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-cyber-emerald/15 border border-cyber-emerald/40 text-cyber-emerald hover:bg-cyber-emerald/25 font-mono text-xs font-bold transition-all disabled:opacity-50"
				title="Pilih format ekspor database"
			>
				<Download className="w-3.5 h-3.5" />
				<span>{exportingMode ? "Mengekspor..." : "Ekspor .db"}</span>
			</button>

			{error && (
				<span className="text-[10px] font-mono text-cyber-rose">{error}</span>
			)}

			{isOpen &&
				createPortal(
					<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
						<button
							type="button"
							aria-label="Tutup pilihan ekspor"
							className="absolute inset-0 cursor-default"
							onClick={() => setIsOpen(false)}
						/>

						<div
							role="dialog"
							aria-modal="true"
							aria-labelledby="export-db-title"
							className="relative z-10 w-full max-w-sm rounded-xl border border-obsidian-700 bg-obsidian-950 p-4 shadow-2xl animate-fade-in"
						>
							<div className="mb-3 flex items-center justify-between border-b border-obsidian-800 pb-3">
								<div>
									<h2
										id="export-db-title"
										className="text-sm font-bold text-slate-100"
									>
										Pilih format ekspor
									</h2>
									<p className="mt-0.5 text-[10px] font-mono text-slate-500">
										File .db akan diunduh ke storage user.
									</p>
								</div>
								<button
									type="button"
									onClick={() => setIsOpen(false)}
									className="rounded p-1 text-slate-400 hover:bg-obsidian-800 hover:text-slate-100"
									aria-label="Tutup pilihan ekspor"
								>
									<X className="h-4 w-4" />
								</button>
							</div>

							<div className="space-y-2">
								{EXPORT_OPTIONS.map(({ mode, description }) => (
									<button
										key={mode}
										type="button"
										onClick={() => handleExport(mode)}
										className="w-full rounded-lg border border-obsidian-800 bg-obsidian-900 px-3 py-2.5 text-left transition-colors hover:border-cyber-emerald/50 hover:bg-cyber-emerald/10"
									>
										<span className="block text-xs font-bold text-cyber-emerald">
											{EXPORT_LABELS[mode]}
										</span>
										<span className="mt-0.5 block text-[10px] font-mono text-slate-400">
											{description}
										</span>
									</button>
								))}
							</div>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
};
