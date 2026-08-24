import type React from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	Database,
	Download,
	FolderOpen,
	RefreshCw,
	RotateCcw,
	Upload,
} from "lucide-react";
import {
	downloadExportDb,
	fetchConfigDbs,
	fetchDatabaseJob,
	finishConfigDbImportBatch,
	resetIdTranslations,
	startConfigDbImportBatch,
	uploadConfigDbImportFile,
	type DatabaseJob,
} from "../lib/api";

const DATABASE_JOB_STORAGE_KEY = "wuwaid_database_job";

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForDatabaseJob(
	id: string,
	onUpdate: (job: DatabaseJob) => void,
): Promise<DatabaseJob> {
	for (;;) {
		const job = await fetchDatabaseJob(id);
		onUpdate(job);
		if (job.status === "completed" || job.status === "failed") return job;
		await sleep(500);
	}
}

function formatDatabaseJobResult(job: DatabaseJob): string {
	if (!job.result) return job.error || "Job database selesai tanpa hasil.";
	const fileSummary = job.result.fileCount
		? `${job.result.fileCount} database`
		: "Translasi ID";
	return `${fileSummary} selesai. ${job.result.updatedQuestLines} teks quest (termasuk pilihan) dan ${job.result.updatedCategoryItems} item kategori diproses.`;
}

export const DatabaseView: React.FC = () => {
	const [dbImporting, setDbImporting] = useState(false);
	const [dbImportProgress, setDbImportProgress] = useState<{
		current: number;
		total: number;
	} | null>(null);
	const [dbResetting, setDbResetting] = useState(false);
	const [dbJob, setDbJob] = useState<DatabaseJob | null>(null);
	const [dbExporting, setDbExporting] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const { data, error, isFetching, refetch } = useQuery({
		queryKey: ["configDbs"],
		queryFn: fetchConfigDbs,
	});

	useEffect(() => {
		const stored = localStorage.getItem(DATABASE_JOB_STORAGE_KEY);
		if (!stored) return;
		let cancelled = false;
		void (async () => {
			try {
				const parsed = JSON.parse(stored) as { id?: string };
				if (!parsed.id) return;
				const initial = await fetchDatabaseJob(parsed.id);
				if (cancelled) return;
				setDbJob(initial);
				if (initial.status === "completed" || initial.status === "failed") {
					localStorage.removeItem(DATABASE_JOB_STORAGE_KEY);
					setMessage(formatDatabaseJobResult(initial));
					return;
				}
				if (initial.status === "staging") {
					setMessage(
						`Import sebelumnya siap dilanjutkan; pilih kembali ${initial.expectedFiles} file .db yang sama untuk meneruskan upload.`,
					);
					return;
				}
				if (initial.kind === "import") setDbImporting(true);
				else setDbResetting(true);
				const finished = await waitForDatabaseJob(parsed.id, (job) => {
					if (!cancelled) setDbJob(job);
				});
				if (!cancelled) {
					setMessage(formatDatabaseJobResult(finished));
					localStorage.removeItem(DATABASE_JOB_STORAGE_KEY);
				}
			} catch {
				if (!cancelled) localStorage.removeItem(DATABASE_JOB_STORAGE_KEY);
			} finally {
				if (!cancelled) {
					setDbImporting(false);
					setDbResetting(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const handleImportDb = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? [])
			.filter((file) => file.name.toLowerCase().endsWith(".db"))
			.sort((left, right) =>
				(left.webkitRelativePath || left.name).localeCompare(
					right.webkitRelativePath || right.name,
				),
			);
		event.target.value = "";
		if (!files.length) {
			setMessage("Pilih file atau folder yang berisi file .db.");
			return;
		}

		const pendingBatch =
			dbJob?.kind === "import" && dbJob.status === "staging" ? dbJob : null;
		if (pendingBatch && pendingBatch.expectedFiles !== files.length) {
			setMessage(
				`Batch sebelumnya menunggu ${pendingBatch.expectedFiles} file; pilih jumlah file yang sama untuk melanjutkan.`,
			);
			return;
		}

		setDbImporting(true);
		setDbImportProgress({ current: 0, total: files.length });
		setDbJob(pendingBatch);
		setMessage(null);
		try {
			const batch = pendingBatch || (await startConfigDbImportBatch(files.length));
			if (!pendingBatch) {
				localStorage.setItem(
					DATABASE_JOB_STORAGE_KEY,
					JSON.stringify({ id: batch.id, kind: batch.kind }),
				);
			}
			setDbJob(batch);
			for (const [index, file] of files.entries()) {
				const staged = await uploadConfigDbImportFile(batch.id, file, index);
				setDbJob(staged);
				setDbImportProgress({ current: index + 1, total: files.length });
			}
			const queued = await finishConfigDbImportBatch(batch.id);
			setDbJob(queued);
			const finished = await waitForDatabaseJob(queued.id, (job) => {
				setDbJob(job);
				setDbImportProgress({
					current: job.progress.current,
					total: job.progress.total,
				});
			});
			if (finished.status === "failed") {
				localStorage.removeItem(DATABASE_JOB_STORAGE_KEY);
				throw new Error(finished.error || "Import database gagal.");
			}
			setMessage(formatDatabaseJobResult(finished));
			localStorage.removeItem(DATABASE_JOB_STORAGE_KEY);
		} catch (importError) {
			setMessage(
				importError instanceof Error
					? importError.message
					: "Import database gagal.",
			);
		} finally {
			setDbImporting(false);
			setDbImportProgress(null);
		}
	};

	const handleResetIdTranslations = async () => {
		if (
			!window.confirm(
				"Hapus semua translasi Bahasa Indonesia dari quest, pilihan, dan kategori? Tindakan ini tidak dapat dibatalkan.",
			)
		) {
			return;
		}

		setDbResetting(true);
		setDbJob(null);
		setMessage(null);
		try {
			const queued = await resetIdTranslations();
			localStorage.setItem(
				DATABASE_JOB_STORAGE_KEY,
				JSON.stringify({ id: queued.id, kind: queued.kind }),
			);
			setDbJob(queued);
			const finished = await waitForDatabaseJob(queued.id, setDbJob);
			if (finished.status === "failed") {
				throw new Error(finished.error || "Penghapusan translasi gagal.");
			}
			setMessage(formatDatabaseJobResult(finished));
			localStorage.removeItem(DATABASE_JOB_STORAGE_KEY);
		} catch (resetError) {
			setMessage(
				resetError instanceof Error
					? resetError.message
					: "Penghapusan translasi gagal.",
			);
		} finally {
			setDbResetting(false);
		}
	};

	const handleDownloadDb = async (
		name: string,
		downloader: (fileName: string) => Promise<void>,
	) => {
		setDbExporting(name);
		setMessage(null);
		try {
			await downloader(name);
			setMessage(`${name} berhasil diunduh ke storage user.`);
		} catch (downloadError) {
			setMessage(
				downloadError instanceof Error
					? downloadError.message
					: "Ekspor database gagal.",
			);
		} finally {
			setDbExporting(null);
		}
	};

	return (
		<div className="h-full flex flex-col space-y-3 overflow-hidden animate-fade-in">
			<div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-obsidian-800 pb-2.5">
				<div className="flex items-center space-x-2">
					<Database className="w-5 h-5 text-cyber-gold" />
					<div>
						<h1 className="text-base sm:text-lg font-bold text-slate-100 font-sans">
							ConfigDB Import / Export
						</h1>
						<p className="text-[10px] font-mono text-slate-500">
							Gunakan template en, isi Content dengan terjemahan ID dan fallback
							English.
						</p>
					</div>
				</div>
			</div>

			<section className="flex-1 min-h-0 cyber-card p-4 border-obsidian-800 bg-obsidian-900/90 flex flex-col overflow-hidden">
				<div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-obsidian-800 shrink-0">
					<div className="flex items-center space-x-2">
						<Database className="w-4 h-4 text-cyber-cyan" />
						<span className="text-xs font-bold text-slate-100">
							ConfigDB Indonesia
						</span>
					</div>
					<div className="flex items-center space-x-2">
						{[
							{
								icon: Upload,
								label: dbImporting ? "Mengimpor..." : "Impor .db",
								multiple: false,
							},
							{
								icon: FolderOpen,
								label: dbImporting
									? `Mengimpor ${dbImportProgress?.current ?? 0}/${dbImportProgress?.total ?? 0}...`
									: "Impor folder .db",
								multiple: true,
							},
						].map(({ icon: Icon, label, multiple }) => (
							<label
								key={label}
								className={`flex items-center space-x-1.5 px-3 py-1 rounded border font-mono text-[10px] font-bold cursor-pointer transition-all ${dbImporting || dbResetting ? "opacity-50 cursor-wait border-obsidian-700 text-slate-500" : "border-cyber-gold/50 text-cyber-gold hover:border-cyber-gold"}`}
							>
								<Icon className="w-3.5 h-3.5" />
								<span>{label}</span>
								<input
									type="file"
									accept=".db"
									className="hidden"
									disabled={dbImporting || dbResetting}
									multiple={multiple}
									ref={(element) => {
										if (multiple && element) {
											element.setAttribute("webkitdirectory", "");
										}
									}}
									onChange={handleImportDb}
								/>
							</label>
						))}
						<button
							type="button"
							onClick={() => void refetch()}
							disabled={isFetching || dbResetting}
							className="p-1.5 rounded border border-obsidian-800 text-slate-400 hover:text-cyber-cyan disabled:opacity-50"
							title="Muat ulang daftar"
						>
							<RefreshCw
								className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`}
							/>
						</button>
						<button
							type="button"
							onClick={() => void handleResetIdTranslations()}
							disabled={dbImporting || dbResetting}
							className="flex items-center space-x-1.5 rounded border border-cyber-rose/50 px-2.5 py-1 text-[10px] font-mono font-bold text-cyber-rose hover:border-cyber-rose disabled:opacity-50"
						>
							<RotateCcw className="w-3.5 h-3.5" />
							<span>{dbResetting ? "Menghapus..." : "Hapus semua translasi ID"}</span>
						</button>
					</div>
				</div>

				<p className="py-2 text-[10px] font-mono text-slate-500">
					Impor tidak menyimpan file .db. Semua Content dari MultiText langsung
					menimpa terjemahan quest, pilihan percabangan, dan kategori di data WebUI.
				</p>
				{message && (
					<p className="pb-2 text-[10px] font-mono text-cyber-cyan">{message}</p>
				)}
				{dbJob && (dbImporting || dbResetting) && (
					<p className="pb-2 text-[10px] font-mono text-cyber-gold">
						Job {dbJob.status}: {dbJob.progress.detail || dbJob.progress.stage}
						{dbJob.progress.current}/{dbJob.progress.total}
					</p>
				)}
				{error && (
					<p className="pb-2 text-[10px] font-mono text-cyber-rose">
						Gagal memuat daftar file.
					</p>
				)}

				<div className="flex-1 min-h-0 overflow-y-auto space-y-3">
					<div className="rounded-lg border border-cyber-gold/30 bg-cyber-gold/5 p-3">
						<div className="flex items-center justify-between gap-2 mb-2">
							<span className="text-xs font-bold text-cyber-gold">
								Ekspor database ID
							</span>
							<span className="text-[10px] font-mono text-slate-500">
								{data?.exportFiles.length ?? 0} template tersedia
							</span>
						</div>
						<div className="flex flex-wrap gap-2">
							{data?.exportFiles.map((name) => (
								<button
									key={name}
									type="button"
									onClick={() => void handleDownloadDb(name, downloadExportDb)}
									disabled={dbExporting !== null || dbResetting}
									className="flex items-center space-x-1.5 rounded border border-cyber-gold/50 px-2.5 py-1.5 text-[10px] font-mono font-bold text-cyber-gold hover:border-cyber-gold disabled:opacity-50"
								>
									<Download className="w-3.5 h-3.5" />
									<span>{dbExporting === name ? "Mengunduh..." : name}</span>
								</button>
							))}
						</div>
					</div>

					<div className="rounded-lg border border-cyber-cyan/30 bg-cyber-cyan/5 p-3">
						<div className="flex items-center space-x-2">
							<Database className="w-4 h-4 text-cyber-cyan" />
							<span className="text-xs font-bold text-cyber-cyan">
								Import langsung ke data WebUI
							</span>
						</div>
						<p className="mt-1 text-[10px] font-mono text-slate-400">
							File upload hanya diproses sementara lalu dihapus. Content yang sama
							dengan English dikosongkan agar tetap dihitung belum diterjemahkan.
						</p>
					</div>
				</div>
			</section>
		</div>
	);
};
