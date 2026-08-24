import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	BookOpen,
	Check,
	CheckCircle2,
	ClipboardCheck,
	Copy,
	Download,
	Filter,
	GitCompare,
	MessageSquare,
	RefreshCw,
	RotateCcw,
	Search,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import {
	downloadTranslationQAReport,
	fetchTranslationQAItems,
	fetchTranslationQASummary,
	scanTranslationQA,
	updateTranslationQAReview,
} from "../lib/api";
import { useAuth } from "../lib/useAuth";
import type {
	TranslationQAItem,
	TranslationQASourceKind,
	TranslationQAStatus,
} from "../types";

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<TranslationQAStatus, string> = {
	pass: "Pass otomatis",
	review: "Perlu review",
	approved: "Disetujui",
};

const STATUS_STYLES: Record<TranslationQAStatus, string> = {
	pass: "border-cyber-emerald/40 bg-cyber-emerald/10 text-cyber-emerald",
	review: "border-cyber-amber/40 bg-cyber-amber/10 text-cyber-amber",
	approved: "border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan",
};

const ISSUE_STYLES: Record<string, string> = {
	error: "border-cyber-rose/40 bg-cyber-rose/10 text-cyber-rose",
	warning: "border-cyber-amber/40 bg-cyber-amber/10 text-cyber-amber",
	info: "border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan",
};

function formatDate(value: string): string {
	return value ? new Date(value).toLocaleString("id-ID") : "-";
}

function buildReviewPrompt(item: TranslationQAItem): string {
	const context = item.contexts[0];
	return [
		"Tolong review kualitas terjemahan Bahasa Indonesia berikut. Jangan mengubah placeholder, markup, tag, atau nama proper noun. Beri jawaban dalam format: verdict (approve/revise), masalah, dan usulan revisi.",
		"",
		`Sumber: ${item.sourceText}`,
		`Terjemahan: ${item.targetText}`,
		`Sebelum: ${context?.previousText || "-"}`,
		`Sesudah: ${context?.nextText || "-"}`,
		`Quest/kategori: ${item.sourceRef}`,
		`Speaker: ${item.speaker || "-"}`,
		`Temuan otomatis: ${item.issues.map((issue) => issue.message).join(" | ") || "Tidak ada"}`,
		`Glosarium: ${item.glossaryMatches.map((match) => `${match.term} => ${match.translation}`).join(" | ") || "Tidak ada"}`,
		`Kandidat attachment mismatch: ${item.attachmentEvidence.map((evidence) => evidence.candidates.map((candidate) => `${candidate.key}: ${candidate.sourceText}`).join(" | ")).join(" || ") || "Tidak ada"}`,
	].join("\n");
}

function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StatusBadge({ status }: { status: TranslationQAStatus }) {
	return (
		<span className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-mono font-bold ${STATUS_STYLES[status]}`}>
			{status === "approved" ? <ShieldCheck className="h-3 w-3" /> : status === "review" ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
			{STATUS_LABELS[status]}
		</span>
	);
}

function ContextBlock({ item }: { item: TranslationQAItem }) {
	const context = item.contexts[0];
	if (!context) return null;

	return (
		<div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,0.8fr)]">
			<div className="rounded border border-obsidian-800 bg-obsidian-950/60 p-3">
				<div className="mb-1 text-[9px] font-mono uppercase tracking-widest text-slate-600">Sebelum</div>
				<p className="text-xs leading-relaxed text-slate-500">{context.previousText || "-"}</p>
			</div>
			<div className="rounded border border-cyber-cyan/20 bg-cyber-cyan/5 p-3">
				<div className="mb-1 flex items-center justify-between text-[9px] font-mono uppercase tracking-widest text-cyber-cyan/80">
					<span>Baris aktif</span>
					<span>{context.lineNo ? `#${context.lineNo}` : context.lineId}</span>
				</div>
				<p className="text-xs leading-relaxed text-slate-300">{context.sourceText || "-"}</p>
				<div className="my-2 border-t border-cyber-cyan/10" />
				<p className="text-sm leading-relaxed text-slate-100">{context.targetText || "(kosong)"}</p>
			</div>
			<div className="rounded border border-obsidian-800 bg-obsidian-950/60 p-3">
				<div className="mb-1 text-[9px] font-mono uppercase tracking-widest text-slate-600">Sesudah</div>
				<p className="text-xs leading-relaxed text-slate-500">{context.nextText || "-"}</p>
			</div>
		</div>
	);
}

const ATTACHMENT_CONFIDENCE_STYLES: Record<string, string> = {
	high: "border-cyber-rose/40 bg-cyber-rose/10 text-cyber-rose",
	medium: "border-cyber-amber/40 bg-cyber-amber/10 text-cyber-amber",
	low: "border-obsidian-700 bg-obsidian-950 text-slate-500",
};

function AttachmentEvidenceBlock({ item }: { item: TranslationQAItem }) {
	if (item.attachmentEvidence.length === 0) return null;

	return (
		<div className="mt-3 rounded border border-cyber-amber/30 bg-cyber-amber/5 p-3">
			<div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-cyber-amber">
				<GitCompare className="h-3.5 w-3.5" />
				<span>Kandidat attachment mismatch</span>
			</div>
			<p className="mt-1 text-[10px] leading-relaxed text-slate-500">
				Sinyal ini menunjukkan target mungkin milik source line lain. Periksa kandidat sebelum menyetujui.
			</p>
			<div className="mt-3 space-y-2">
				{item.attachmentEvidence.map((evidence) => (
					<div key={evidence.occurrenceId} className="rounded border border-obsidian-800 bg-obsidian-950/60 p-2.5">
						<div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
							<span className={`rounded border px-2 py-1 font-bold ${ATTACHMENT_CONFIDENCE_STYLES[evidence.confidence] || ATTACHMENT_CONFIDENCE_STYLES.medium}`}>
								{evidence.confidence} confidence
							</span>
							<span className="text-slate-500">{evidence.key || evidence.lineId || "occurrence"}</span>
							<span className="text-slate-600">margin {evidence.margin.toFixed(2)}</span>
						</div>
						<div className="mt-2 space-y-2">
							{evidence.candidates.map((candidate, index) => (
								<div key={candidate.occurrenceId} className="rounded border border-obsidian-800 bg-obsidian-900/80 p-2">
									<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono text-cyber-cyan">
										<span>#{index + 1} {candidate.key || candidate.lineId || "candidate"}</span>
										<span className="text-slate-600">{candidate.sameQuest ? "quest sama" : "fallback corpus"}</span>
										<span className="text-slate-500">score {candidate.score.toFixed(2)}</span>
									</div>
									<p className="mt-1 text-xs leading-relaxed text-slate-300">{candidate.sourceText || "(kosong)"}</p>
									<p className="mt-1 text-[10px] leading-relaxed text-slate-600">{candidate.reasons.map((reason) => reason.message).join(" | ")}</p>
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

interface QAItemCardProps {
	item: TranslationQAItem;
	canReview: boolean;
	onUpdate: (id: string, status: "review" | "approved" | "reset", comment: string) => void;
	isUpdating: boolean;
}

function QAItemCard({ item, canReview, onUpdate, isUpdating }: QAItemCardProps) {
	const [comment, setComment] = useState(item.review?.comment || "");
	const [copied, setCopied] = useState(false);

	useEffect(() => setComment(item.review?.comment || ""), [item.review?.comment]);

	const copyPrompt = async () => {
		await navigator.clipboard.writeText(buildReviewPrompt(item));
		setCopied(true);
		setTimeout(() => setCopied(false), 1800);
	};

	return (
		<article className="cyber-card overflow-hidden rounded-none border-obsidian-800 bg-obsidian-900/90">
			<div className="flex flex-wrap items-start justify-between gap-3 border-b border-obsidian-800 px-4 py-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<StatusBadge status={item.status} />
						<span className="rounded border border-obsidian-700 bg-obsidian-950 px-2 py-1 text-[10px] font-mono text-cyber-cyan">
							{item.sourceKind === "quest" ? "QUEST" : "CATEGORY"}
						</span>
						<span className="text-[10px] font-mono text-slate-500">{item.occurrences} salinan</span>
					</div>
					<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
						<code className="break-all text-xs font-bold text-slate-100">{item.key || "(tanpa text key)"}</code>
						<span className="text-[10px] font-mono text-slate-500">{item.sourceRef}</span>
						{item.lineNo && <span className="text-[10px] font-mono text-slate-500">baris #{item.lineNo}</span>}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] font-mono text-slate-600">
						<span>{item.questTitle || item.sourcePath}</span>
						{item.speaker && <span>• {item.speaker}</span>}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<button type="button" onClick={() => void copyPrompt()} className="inline-flex items-center gap-1 rounded border border-obsidian-700 px-2 py-1.5 text-[10px] font-mono text-slate-400 hover:border-cyber-cyan/50 hover:text-cyber-cyan" title="Salin prompt untuk review AI">
						{copied ? <Check className="h-3 w-3 text-cyber-emerald" /> : <Copy className="h-3 w-3" />}
						{copied ? "Tersalin" : "Prompt AI"}
					</button>
				</div>
			</div>

			<div className="px-4 py-3">
				<div className="grid gap-2 md:grid-cols-2">
					<div className="rounded border border-cyber-rose/20 bg-cyber-rose/5 p-3">
						<div className="mb-1 text-[9px] font-mono uppercase tracking-widest text-cyber-rose/70">English source</div>
						<p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{item.sourceText || "(kosong)"}</p>
					</div>
					<div className="rounded border border-cyber-cyan/20 bg-cyber-cyan/5 p-3">
						<div className="mb-1 text-[9px] font-mono uppercase tracking-widest text-cyber-cyan/70">Indonesia target</div>
						<p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{item.targetText || "(kosong)"}</p>
					</div>
				</div>

				{item.issues.length > 0 && (
					<div className="mt-3 space-y-1.5">
						{item.issues.map((issue) => (
							<div key={`${issue.code}-${issue.message}`} className={`flex items-start gap-2 rounded border px-2.5 py-2 text-xs ${ISSUE_STYLES[issue.severity] || ISSUE_STYLES.warning}`}>
								<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span><strong className="font-mono text-[10px] uppercase">{issue.code}</strong> · {issue.message}</span>
							</div>
						))}
					</div>
						)}

				<AttachmentEvidenceBlock item={item} />
				<ContextBlock item={item} />

				{item.glossaryMatches.length > 0 && (
					<div className="mt-3 flex flex-wrap items-center gap-2 border-t border-obsidian-800 pt-3">
						<span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-cyber-gold"><BookOpen className="h-3 w-3" /> Glosarium</span>
						{item.glossaryMatches.slice(0, 8).map((match) => (
							<span key={match.term} className={`rounded border px-2 py-1 text-[10px] font-mono ${match.present ? "border-cyber-emerald/30 bg-cyber-emerald/5 text-cyber-emerald" : "border-cyber-amber/30 bg-cyber-amber/5 text-cyber-amber"}`}>
								{match.term} → {match.translation}
							</span>
						))}
					</div>
				)}

				<div className="mt-3 grid gap-2 border-t border-obsidian-800 pt-3 lg:grid-cols-[minmax(0,1fr)_auto]">
					<label className="flex items-start gap-2 rounded border border-obsidian-800 bg-obsidian-950/70 px-3 py-2">
						<MessageSquare className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
						<textarea value={comment} onChange={(event) => setComment(event.target.value)} disabled={!canReview} rows={2} placeholder={canReview ? "Catatan reviewer: konteks, gaya bahasa, atau alasan keputusan..." : "Login editor untuk menambahkan catatan."} className="min-h-10 w-full resize-y bg-transparent text-xs leading-relaxed text-slate-200 outline-none placeholder:text-slate-600 disabled:cursor-not-allowed" />
					</label>
					<div className="flex flex-wrap items-start justify-end gap-2">
						{item.review && <span className="w-full text-right text-[10px] font-mono text-slate-600">{item.review.reviewer} · {formatDate(item.review.updatedAt)}</span>}
						<button type="button" disabled={!canReview || isUpdating} onClick={() => onUpdate(item.id, "reset", "")} className="inline-flex items-center gap-1 rounded border border-obsidian-700 px-2.5 py-1.5 text-[10px] font-mono text-slate-400 hover:border-slate-500 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="h-3 w-3" /> Reset</button>
						<button type="button" disabled={!canReview || isUpdating} onClick={() => onUpdate(item.id, "review", comment)} className="inline-flex items-center gap-1 rounded border border-cyber-amber/40 bg-cyber-amber/10 px-2.5 py-1.5 text-[10px] font-mono font-bold text-cyber-amber hover:bg-cyber-amber/20 disabled:cursor-not-allowed disabled:opacity-40"><AlertTriangle className="h-3 w-3" /> Review</button>
						<button type="button" disabled={!canReview || isUpdating} onClick={() => onUpdate(item.id, "approved", comment)} className="inline-flex items-center gap-1 rounded bg-cyber-emerald px-2.5 py-1.5 text-[10px] font-mono font-bold text-obsidian-950 hover:bg-cyber-emerald/90 disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 className="h-3 w-3" /> Approve</button>
					</div>
				</div>
			</div>
		</article>
	);
}

export function TranslationQAView() {
	const queryClient = useQueryClient();
	const { role } = useAuth();
	const canReview = role === "editor" || role === "admin";
	const [status, setStatus] = useState<TranslationQAStatus | "all">("review");
	const [kind, setKind] = useState<TranslationQASourceKind | "all">("all");
	const [issue, setIssue] = useState("");
	const [query, setQuery] = useState("");
	const [sampleMode, setSampleMode] = useState(false);
	const [page, setPage] = useState(1);
	const [actionMessage, setActionMessage] = useState<string | null>(null);
	const [exporting, setExporting] = useState<string | null>(null);

	const summaryQuery = useQuery({
		queryKey: ["translationQaSummary"],
		queryFn: fetchTranslationQASummary,
	});
	const itemsQuery = useQuery({
		queryKey: ["translationQaItems", status, kind, issue, query, sampleMode, page],
		queryFn: () => fetchTranslationQAItems({ status, kind, issue: issue || undefined, q: query || undefined, sample: sampleMode, page, pageSize: PAGE_SIZE }),
	});

	const summary = itemsQuery.data?.summary || summaryQuery.data;
	const issueOptions = useMemo(() => Object.entries(summary?.issueCounts || {}).sort((a, b) => b[1] - a[1]), [summary?.issueCounts]);
	const totalPages = sampleMode ? 1 : Math.max(1, Math.ceil((itemsQuery.data?.total || 0) / PAGE_SIZE));

	useEffect(() => setPage(1), [status, kind, issue, query, sampleMode]);

	const scanMutation = useMutation({
		mutationFn: scanTranslationQA,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["translationQaSummary"] });
			await queryClient.invalidateQueries({ queryKey: ["translationQaItems"] });
			setActionMessage("Scan korpus selesai dan hasil QA diperbarui.");
		},
	});

	const reviewMutation = useMutation({
		mutationFn: ({ id, reviewStatus, comment }: { id: string; reviewStatus: "review" | "approved" | "reset"; comment: string }) => updateTranslationQAReview(id, { status: reviewStatus, comment }),
		onSuccess: async (_result, variables) => {
			await queryClient.invalidateQueries({ queryKey: ["translationQaSummary"] });
			await queryClient.invalidateQueries({ queryKey: ["translationQaItems"] });
			setActionMessage(variables.reviewStatus === "approved" ? "Item ditandai disetujui." : variables.reviewStatus === "review" ? "Item dikembalikan ke review." : "Status manual di-reset.");
		},
	});

	const exportReport = async (format: "json" | "csv") => {
		setExporting(format);
		try {
			const result = await downloadTranslationQAReport({ format, status, kind, issue: issue || undefined, q: query || undefined });
			saveBlob(result.blob, result.filename);
		} catch (error) {
			setActionMessage(error instanceof Error ? error.message : "Ekspor QA gagal.");
		} finally {
			setExporting(null);
		}
	};

	const items = itemsQuery.data?.items || [];
	const activeError = scanMutation.error || reviewMutation.error || itemsQuery.error || summaryQuery.error;

	return (
		<div className="h-full overflow-y-auto pb-10 animate-fade-in" aria-labelledby="qa-heading">
			<header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-obsidian-800 pb-3">
				<div>
					<div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-cyber-cyan"><ClipboardCheck className="h-3.5 w-3.5" /> Translation QA / Corpus Review</div>
					<h1 id="qa-heading" className="mt-1 text-xl font-bold text-slate-100 sm:text-2xl">Translation Quality Control</h1>
					<p className="mt-1 max-w-3xl text-xs font-mono leading-relaxed text-slate-400">Pemeriksaan teknis, konteks dialog, glosarium, dan review manusia untuk quest, pilihan dialog, dan kategori UI. Temuan otomatis adalah sinyal review, bukan vonis kualitas makna.</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button type="button" onClick={() => scanMutation.mutate()} disabled={!canReview || scanMutation.isPending} title={canReview ? "Jalankan scan korpus (cooldown 60 detik)" : "Login editor/admin untuk scan ulang"} className="inline-flex items-center gap-1.5 rounded border border-cyber-cyan/40 bg-cyber-cyan/10 px-3 py-2 text-xs font-mono font-bold text-cyber-cyan hover:bg-cyber-cyan/20 disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${scanMutation.isPending ? "animate-spin" : ""}`} /> {scanMutation.isPending ? "Scanning..." : "Scan ulang"}</button>
					<button type="button" onClick={() => void exportReport("csv")} disabled={!canReview || Boolean(exporting)} title={canReview ? "Ekspor maksimal 10.000 item" : "Login editor/admin untuk ekspor"} className="inline-flex items-center gap-1.5 rounded border border-obsidian-700 px-3 py-2 text-xs font-mono text-slate-300 hover:border-cyber-gold/50 hover:text-cyber-gold disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {exporting === "csv" ? "Export..." : "CSV"}</button>
					<button type="button" onClick={() => void exportReport("json")} disabled={!canReview || Boolean(exporting)} title={canReview ? "Ekspor maksimal 10.000 item" : "Login editor/admin untuk ekspor"} className="inline-flex items-center gap-1.5 rounded border border-obsidian-700 px-3 py-2 text-xs font-mono text-slate-300 hover:border-cyber-gold/50 hover:text-cyber-gold disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-3.5 w-3.5" /> {exporting === "json" ? "Export..." : "JSON"}</button>
				</div>
			</header>

			{actionMessage && <div className="mb-3 flex items-center gap-2 rounded border border-cyber-emerald/30 bg-cyber-emerald/10 px-3 py-2 text-xs font-mono text-cyber-emerald"><Check className="h-3.5 w-3.5" /> <span>{actionMessage}</span><button type="button" className="ml-auto text-cyber-emerald/60 hover:text-cyber-emerald" onClick={() => setActionMessage(null)}>×</button></div>}
			{activeError && <div role="alert" className="mb-3 rounded border border-cyber-rose/30 bg-cyber-rose/10 px-3 py-2 text-xs font-mono text-cyber-rose">{activeError instanceof Error ? activeError.message : "QA tidak dapat dimuat."}</div>}

			<section className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
				<div className="cyber-card rounded-none p-3"><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Unit QA</div><div className="mt-1 text-xl font-bold font-mono text-slate-100">{summary?.totalItems?.toLocaleString() || "-"}</div><div className="text-[10px] font-mono text-slate-600">{summary?.totalOccurrences?.toLocaleString() || "-"} occurrence</div></div>
				<button type="button" onClick={() => { setSampleMode(false); setStatus("review"); }} className={`cyber-card rounded-none p-3 text-left transition-colors hover:border-cyber-amber/50 ${status === "review" && !sampleMode ? "border-cyber-amber/50" : ""}`}><div className="text-[10px] font-mono uppercase tracking-widest text-cyber-amber">Perlu review</div><div className="mt-1 text-xl font-bold font-mono text-cyber-amber">{summary?.statusCounts.review?.toLocaleString() || "-"}</div><div className="text-[10px] font-mono text-slate-600">otomatis + manual</div></button>
				<button type="button" onClick={() => { setSampleMode(false); setStatus("pass"); }} className={`cyber-card rounded-none p-3 text-left transition-colors hover:border-cyber-emerald/50 ${status === "pass" && !sampleMode ? "border-cyber-emerald/50" : ""}`}><div className="text-[10px] font-mono uppercase tracking-widest text-cyber-emerald">Pass otomatis</div><div className="mt-1 text-xl font-bold font-mono text-cyber-emerald">{summary?.statusCounts.pass?.toLocaleString() || "-"}</div><div className="text-[10px] font-mono text-slate-600">belum tentu approved</div></button>
				<button type="button" onClick={() => { setSampleMode(false); setStatus("approved"); }} className={`cyber-card rounded-none p-3 text-left transition-colors hover:border-cyber-cyan/50 ${status === "approved" && !sampleMode ? "border-cyber-cyan/50" : ""}`}><div className="text-[10px] font-mono uppercase tracking-widest text-cyber-cyan">Approved manusia</div><div className="mt-1 text-xl font-bold font-mono text-cyber-cyan">{summary?.statusCounts.approved?.toLocaleString() || "-"}</div><div className="text-[10px] font-mono text-slate-600">dengan reviewer</div></button>
				<div className="cyber-card rounded-none p-3"><div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Scope</div><div className="mt-1 text-xl font-bold font-mono text-slate-100">{summary ? `${summary.sourceKindCounts.quest.toLocaleString()} / ${summary.sourceKindCounts.category.toLocaleString()}` : "-"}</div><div className="text-[10px] font-mono text-slate-600">quest / kategori</div></div>
			</section>

			<section className="cyber-card mb-4 rounded-none p-3">
				<div className="grid gap-2 md:grid-cols-[auto_auto_minmax(12rem,1fr)_minmax(12rem,1fr)]">
					<label className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Status<select value={status} onChange={(event) => { setSampleMode(false); setStatus(event.target.value as TranslationQAStatus | "all"); }} className="mt-1 block w-full rounded border border-obsidian-700 bg-obsidian-950 px-2 py-2 text-xs font-mono normal-case tracking-normal text-slate-200 outline-none focus:border-cyber-cyan/60"><option value="review">Perlu review</option><option value="pass">Pass otomatis</option><option value="approved">Approved</option><option value="all">Semua status</option></select></label>
					<label className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Sumber<select value={kind} onChange={(event) => setKind(event.target.value as TranslationQASourceKind | "all")} className="mt-1 block w-full rounded border border-obsidian-700 bg-obsidian-950 px-2 py-2 text-xs font-mono normal-case tracking-normal text-slate-200 outline-none focus:border-cyber-cyan/60"><option value="all">Quest + kategori</option><option value="quest">Quest/dialog</option><option value="category">Kategori UI</option></select></label>
					<label className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Jenis temuan<select value={issue} onChange={(event) => setIssue(event.target.value)} className="mt-1 block w-full rounded border border-obsidian-700 bg-obsidian-950 px-2 py-2 text-xs font-mono normal-case tracking-normal text-slate-200 outline-none focus:border-cyber-cyan/60"><option value="">Semua temuan</option>{issueOptions.map(([code, count]) => <option key={code} value={code}>{code} ({count.toLocaleString()})</option>)}</select></label>
					<label className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Cari key, quest, atau teks<div className="relative mt-1"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Huanglong... / istilah..." className="block w-full rounded border border-obsidian-700 bg-obsidian-950 py-2 pl-8 pr-2 text-xs font-mono normal-case tracking-normal text-slate-200 outline-none focus:border-cyber-cyan/60" /></div></label>
				</div>
				<div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-600"><Filter className="h-3 w-3" /> Menampilkan {itemsQuery.data?.total?.toLocaleString() || 0} item cocok{sampleMode ? " (sample acak)" : ""} · Scan {summary ? formatDate(summary.generatedAt) : "-"} {summaryQuery.isFetching && <span className="text-cyber-cyan">memuat...</span>}<button type="button" onClick={() => { setStatus("pass"); setSampleMode(true); }} className="ml-auto inline-flex items-center gap-1 rounded border border-cyber-emerald/30 bg-cyber-emerald/5 px-2 py-1 text-cyber-emerald hover:bg-cyber-emerald/10"><Sparkles className="h-3 w-3" /> Ambil sample pass</button></div>
			</section>

			{!canReview && <div className="mb-3 flex items-center gap-2 rounded border border-cyber-gold/30 bg-cyber-gold/5 px-3 py-2 text-xs font-mono text-cyber-gold"><Sparkles className="h-3.5 w-3.5" /> Mode baca aktif. Login editor/admin untuk menyimpan status dan catatan review.</div>}

			<div className="space-y-3">
				{itemsQuery.isPending ? <div className="cyber-card p-10 text-center text-sm font-mono text-slate-400">Memuat hasil QA...</div> : items.length === 0 ? <div className="cyber-card p-10 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-cyber-emerald" /><p className="mt-3 text-sm font-bold text-slate-200">Tidak ada item pada filter ini.</p><p className="mt-1 text-xs font-mono text-slate-500">Coba status atau jenis temuan lain.</p></div> : items.map((item) => <QAItemCard key={item.id} item={item} canReview={canReview} isUpdating={reviewMutation.isPending} onUpdate={(id, reviewStatus, comment) => reviewMutation.mutate({ id, reviewStatus, comment })} />)}
			</div>

			{items.length > 0 && <div className="mt-4 flex items-center justify-between border-t border-obsidian-800 pt-3"><span className="text-[10px] font-mono text-slate-600">Halaman {page} / {totalPages}</span><div className="flex gap-2"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="rounded border border-obsidian-700 px-3 py-1.5 text-xs font-mono text-slate-400 hover:border-cyber-cyan/50 hover:text-cyber-cyan disabled:opacity-30">Sebelumnya</button><button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="rounded border border-obsidian-700 px-3 py-1.5 text-xs font-mono text-slate-400 hover:border-cyber-cyan/50 hover:text-cyber-cyan disabled:opacity-30">Berikutnya</button></div></div>}

			<footer className="mt-6 grid gap-3 border-t border-obsidian-800 pt-4 text-[10px] font-mono text-slate-600 md:grid-cols-3">
				<div className="flex gap-2"><ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-cyber-cyan" /><span><strong className="text-slate-400">Pass</strong> berarti lolos aturan teknis; belum diverifikasi makna oleh manusia.</span></div>
				<div className="flex gap-2"><ShieldCheck className="h-3.5 w-3.5 shrink-0 text-cyber-cyan" /><span><strong className="text-slate-400">Approved</strong> berarti reviewer menyatakan konteks dan gaya sudah layak.</span></div>
				<div className="flex gap-2"><BookOpen className="h-3.5 w-3.5 shrink-0 text-cyber-gold" /><span>Prompt AI hanya alat bantu; keputusan akhir tetap dicatat oleh reviewer.</span></div>
			</footer>
		</div>
	);
}
