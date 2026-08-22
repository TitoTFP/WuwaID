import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Calendar,
	ChevronLeft,
	ChevronRight,
	Download,
	FileDiff,
	GitCommit,
	Sparkles,
} from "lucide-react";
import {
	createTextVersion,
	downloadStructuredTextDiff,
	downloadTextVersionDiff,
	fetchMe,
	fetchTextVersionDiff,
	fetchTextVersionGroups,
	fetchVersions,
} from "../lib/api";
import type {
	TextDiffGroup,
	TextDiffStatus,
	TextVersion,
	TextVersionLanguage,
} from "../types";

const PAGE_SIZE = 100;
const VERSION_WORKING = "working";
const STATUS_STYLE: Record<TextDiffStatus, string> = {
	added: "border-cyber-emerald/40 bg-cyber-emerald/10 text-cyber-emerald",
	removed: "border-cyber-rose/40 bg-cyber-rose/10 text-cyber-rose",
	changed: "border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan",
};
const buttonClass =
	"rounded border border-obsidian-700 bg-obsidian-900 px-3 py-1.5 text-xs font-mono text-slate-300 transition-colors hover:border-cyber-cyan/50 hover:text-cyber-cyan disabled:cursor-not-allowed disabled:opacity-40";
const activeButtonClass =
	"rounded border border-cyber-cyan/40 bg-cyber-cyan/10 px-3 py-1.5 text-xs font-mono text-cyber-cyan transition-colors hover:bg-cyber-cyan/20 disabled:cursor-not-allowed disabled:opacity-40";
const inputClass =
	"w-full rounded border border-obsidian-700 bg-obsidian-950 px-3 py-2 text-xs font-mono text-slate-200 outline-none transition-colors focus:border-cyber-cyan/60";

function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

function formatDate(value: string): string {
	return new Date(value).toLocaleString("id-ID");
}

function VersionList({ versions }: { versions: TextVersion[] }) {
	return (
		<div className="max-h-64 overflow-y-auto" tabIndex={0} aria-label="Saved text versions">
			{versions.map((version) => (
				<div
					key={version.id}
					className="grid gap-2 border-b border-obsidian-800 px-4 py-3 text-xs md:grid-cols-[8rem_1fr_auto]"
				>
					<div className="font-mono font-bold text-cyber-cyan">{version.tag}</div>
					<div>
						<div className="text-slate-300">{version.note || "Tanpa catatan"}</div>
						<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-slate-500">
							<span className="inline-flex items-center gap-1">
								<GitCommit className="h-3 w-3 text-cyber-gold" />
								{version.dataset_hash.slice(0, 16)}
							</span>
							<span className="inline-flex items-center gap-1">
								<Calendar className="h-3 w-3" />
								{formatDate(version.created_at)}
							</span>
						</div>
					</div>
					<div className="text-right text-slate-400">
						<div>{version.row_count.toLocaleString()} rows</div>
						<div className="text-[10px]">
							{version.category_row_count.toLocaleString()} kategori · {version.quest_row_count.toLocaleString()} quest
						</div>
					</div>
				</div>
			))}
			{!versions.length && (
				<div className="p-5 text-sm font-mono text-slate-400">Belum ada snapshot immutable.</div>
			)}
		</div>
	);
}

export function VersionsHistory() {
	const queryClient = useQueryClient();
	const authQ = useQuery({
		queryKey: ["auth-me"],
		queryFn: fetchMe,
		refetchInterval: 1500,
	});
	const canEdit = authQ.data?.role === "editor" || authQ.data?.role === "admin";
	const versionsQ = useQuery({
		queryKey: ["text-versions"],
		queryFn: fetchVersions,
		enabled: canEdit,
	});
	const versions = versionsQ.data?.versions || [];
	const [base, setBase] = useState("");
	const [target, setTarget] = useState("");
	const [language, setLanguage] = useState<TextVersionLanguage>("en");
	const [status, setStatus] = useState<TextDiffStatus | "">("");
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const [tag, setTag] = useState("");
	const [note, setNote] = useState("");
	const [groupTab, setGroupTab] = useState<"category" | "quest">("category");
	const [groupSearch, setGroupSearch] = useState("");
	const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
	const [downloadError, setDownloadError] = useState("");

	useEffect(() => {
		if (!target && versions[0]) setTarget(versions[0].tag);
		if (!base && versions[1]) setBase(versions[1].tag);
	}, [base, target, versions]);

	useEffect(() => setPage(1), [base, target, language, status, search]);

	const diffQ = useQuery({
		queryKey: ["text-version-diff", base, target, language, status, search, page],
		queryFn: () =>
			fetchTextVersionDiff({
				base,
				target,
				language,
				status: status || undefined,
				query: search || undefined,
				page,
				pageSize: PAGE_SIZE,
			}),
		enabled: Boolean(canEdit && base && target && base !== target),
	});

	const groupsQ = useQuery({
		queryKey: ["text-version-groups", base, target, language],
		queryFn: () => fetchTextVersionGroups({ base, target, language }),
		enabled: Boolean(canEdit && base && target && base !== target),
		staleTime: Number.POSITIVE_INFINITY,
	});

	useEffect(() => {
		setSelectedGroups(new Set());
		setGroupSearch("");
	}, [base, target, language]);

	useEffect(() => {
		if (groupsQ.data) setSelectedGroups(new Set(groupsQ.data.groups.map((group) => group.group_id)));
	}, [groupsQ.data]);

	const createM = useMutation({
		mutationFn: () => createTextVersion(tag.trim(), note.trim()),
		onSuccess: async () => {
			setTag("");
			setNote("");
			await queryClient.invalidateQueries({ queryKey: ["text-versions"] });
		},
	});

	async function downloadDiff(format: "csv" | "sqlite") {
		if (!base || !target || base === target) return;
		setDownloadError("");
		try {
			const result = await downloadTextVersionDiff({ base, target, language, format });
			saveBlob(result.blob, result.filename);
		} catch (error) {
			setDownloadError(error instanceof Error ? error.message : "Download gagal.");
		}
	}

	async function downloadStructured() {
		if (!base || !target || !selectedGroups.size) return;
		setDownloadError("");
		try {
			const result = await downloadStructuredTextDiff({
				base,
				target,
				language,
				groups: [...selectedGroups],
			});
			saveBlob(result.blob, result.filename);
		} catch (error) {
			setDownloadError(error instanceof Error ? error.message : "Download ZIP gagal.");
		}
	}

	if (authQ.isLoading) {
		return <div className="cyber-card p-6 text-sm font-mono text-slate-400">Memeriksa akses editor...</div>;
	}
	if (!canEdit) {
		return (
			<div className="cyber-card mx-auto w-full max-w-3xl p-8 text-center">
				<Sparkles className="mx-auto h-8 w-8 text-cyber-cyan" />
				<h1 className="mt-3 text-xl font-bold text-slate-100">Text Versions</h1>
				<p className="mt-2 text-sm font-mono text-slate-400">
					Login editor diperlukan untuk membuka riwayat resmi EN, ZH-Hans, dan JA.
				</p>
				<p className="mt-4 text-xs font-mono text-slate-500">Gunakan tombol Login di masthead.</p>
			</div>
		);
	}

	const totalPages = Math.max(1, Math.ceil((diffQ.data?.total || 0) / PAGE_SIZE));
	const choices = [...versions.map((version) => version.tag), VERSION_WORKING];
	const groupNeedle = groupSearch.trim().toLocaleLowerCase();
	const visibleGroups = (groupsQ.data?.groups || []).filter(
		(group) =>
			group.source_kind === groupTab &&
			(!groupNeedle ||
				group.source_ref.toLocaleLowerCase().includes(groupNeedle) ||
				group.db_path.toLocaleLowerCase().includes(groupNeedle)),
	);
	const selectedRows = (groupsQ.data?.groups || [])
		.filter((group) => selectedGroups.has(group.group_id))
		.reduce((total, group) => total + group.total, 0);

	return (
		<div className="h-full overflow-y-auto pb-10" aria-labelledby="versions-heading">
			<header className="mb-4 border-b border-obsidian-800 pb-3">
				<div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-cyber-cyan">
					<Sparkles className="h-3.5 w-3.5" /> Official MultiText history
				</div>
				<h1 id="versions-heading" className="mt-1 text-xl font-bold text-slate-100 sm:text-2xl">
					Text Versions
				</h1>
				<p className="mt-1 text-xs font-mono text-slate-400">
					Snapshot immutable EN, ZH-Hans, dan JA. Overlay Indonesia tidak ikut dibandingkan.
				</p>
			</header>

			<section className="mb-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
				<div className="cyber-card overflow-hidden rounded-none">
					<div className="border-b border-obsidian-800 px-4 py-3 text-[10px] uppercase tracking-widest text-slate-500">
						Saved tags
					</div>
					{versionsQ.isPending && <div className="p-5 text-sm font-mono text-slate-400">Memuat snapshot...</div>}
					{versionsQ.isError && <div className="p-5 text-sm font-mono text-cyber-rose">Snapshot tidak dapat dimuat.</div>}
					{!versionsQ.isError && <VersionList versions={versions} />}
				</div>

				<form
					className="cyber-card rounded-none p-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (tag.trim()) createM.mutate();
					}}
				>
					<h2 className="text-base font-bold text-slate-100">Tag working tree</h2>
					<label htmlFor="version-tag" className="mt-3 block text-[11px] font-mono text-slate-400">Tag</label>
					<input id="version-tag" className={`${inputClass} mt-1`} value={tag} onChange={(event) => setTag(event.target.value)} placeholder="v3.6" />
					<label htmlFor="version-note" className="mt-3 block text-[11px] font-mono text-slate-400">Note</label>
					<textarea id="version-note" className={`${inputClass} mt-1 min-h-20 resize-y`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Official game update" />
					<button type="submit" className={`${activeButtonClass} mt-3`} disabled={!tag.trim() || createM.isPending}>
						{createM.isPending ? "Creating snapshot..." : "Create immutable tag"}
					</button>
					{createM.error && <div role="alert" className="mt-2 text-xs font-mono text-cyber-rose">{createM.error instanceof Error ? createM.error.message : "Snapshot gagal dibuat."}</div>}
				</form>
			</section>

			<section className="cyber-card mb-4 rounded-none p-4">
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_10rem_1fr_auto]">
					<label htmlFor="version-base" className="text-[11px] font-mono text-slate-400">
						Base
						<select id="version-base" className={`${inputClass} mt-1`} value={base} onChange={(event) => setBase(event.target.value)}>
							<option value="">Pilih versi</option>
							{choices.map((value) => <option key={`base-${value}`} value={value}>{value}</option>)}
						</select>
					</label>
					<label htmlFor="version-target" className="text-[11px] font-mono text-slate-400">
						Target
						<select id="version-target" className={`${inputClass} mt-1`} value={target} onChange={(event) => setTarget(event.target.value)}>
							<option value="">Pilih versi</option>
							{choices.map((value) => <option key={`target-${value}`} value={value}>{value}</option>)}
						</select>
					</label>
					<label htmlFor="version-language" className="text-[11px] font-mono text-slate-400">
						Language
						<select id="version-language" className={`${inputClass} mt-1`} value={language} onChange={(event) => setLanguage(event.target.value as TextVersionLanguage)}>
							<option value="en">English</option>
							<option value="zh-Hans">ZH-Hans</option>
							<option value="ja">Japanese</option>
						</select>
					</label>
					<label htmlFor="version-search" className="text-[11px] font-mono text-slate-400">
						Search ID atau content
						<input id="version-search" className={`${inputClass} mt-1`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Quest_..." />
					</label>
					<div className="flex items-end gap-2">
						<button type="button" className={buttonClass} disabled={!base || !target || base === target} onClick={() => void downloadDiff("sqlite")} title="Download SQLite diff">
							<Download className="mr-1 inline h-3 w-3" /> SQLite
						</button>
						<button type="button" className={buttonClass} disabled={!base || !target || base === target} onClick={() => void downloadDiff("csv")} title="Download CSV diff">
							<Download className="mr-1 inline h-3 w-3" /> CSV
						</button>
					</div>
				</div>
				{base === target && base && <div className="mt-2 text-xs font-mono text-cyber-rose">Base dan target harus berbeda.</div>}
			</section>

			{diffQ.data && (
				<div className="mb-4 grid grid-cols-3 divide-x divide-obsidian-800">
					{(["added", "removed", "changed"] as TextDiffStatus[]).map((value) => (
						<button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(status === value ? "" : value)} className={`min-w-0 border px-3 py-3 text-left ${STATUS_STYLE[value]} ${status && status !== value ? "opacity-40" : ""}`}>
							<div className="text-[10px] uppercase tracking-widest">{value}</div>
							<div className="mt-1 truncate font-mono text-xl font-bold">{diffQ.data.summary[value].toLocaleString()}</div>
						</button>
					))}
				</div>
			)}

			{base && target && base !== target && (
				<section className="cyber-card mb-4 overflow-hidden rounded-none">
					<div className="flex flex-wrap items-center justify-between gap-3 border-b border-obsidian-800 px-4 py-3">
						<div>
							<div className="text-[10px] uppercase tracking-widest text-slate-400">Groups &amp; Quests</div>
							<div className="mt-1 text-[11px] font-mono text-slate-500">{selectedGroups.size.toLocaleString()} groups · {selectedRows.toLocaleString()} rows selected</div>
						</div>
						<div className="flex flex-wrap gap-2">
							<button type="button" className={buttonClass} onClick={() => setSelectedGroups(new Set((groupsQ.data?.groups || []).map((group) => group.group_id)))}>Select All</button>
							<button type="button" className={buttonClass} onClick={() => setSelectedGroups(new Set())}>Clear</button>
							<button type="button" className={activeButtonClass} disabled={!selectedGroups.size} onClick={() => void downloadStructured()}><Download className="mr-1 inline h-3 w-3" /> Structured DB ZIP</button>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2 border-b border-obsidian-800 p-3" role="tablist" aria-label="Version diff groups">
						{(["category", "quest"] as const).map((kind) => {
							const count = (groupsQ.data?.groups || []).filter((group) => group.source_kind === kind).length;
							return <button key={kind} type="button" role="tab" aria-selected={groupTab === kind} onClick={() => setGroupTab(kind)} className={groupTab === kind ? activeButtonClass : buttonClass}>{kind === "category" ? "Categories" : "Quests"} ({count})</button>;
						})}
						<label className="ml-auto block w-full max-w-sm">
							<span className="sr-only">Search groups</span>
							<input className={inputClass} value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Search group name or QID..." />
						</label>
					</div>
					{groupsQ.isFetching && <div className="p-5 text-sm font-mono text-slate-400">Grouping diff rows...</div>}
					{groupsQ.error && <div role="alert" className="p-5 text-sm font-mono text-cyber-rose">Diff groups tidak dapat dimuat.</div>}
					{downloadError && <div role="alert" className="border-b border-cyber-rose/20 bg-cyber-rose/5 p-3 text-xs font-mono text-cyber-rose">{downloadError}</div>}
					<div className="max-h-96 overflow-y-auto" tabIndex={0} aria-label="Diff groups">
						{visibleGroups.map((group: TextDiffGroup) => (
							<label key={group.group_id} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-obsidian-800 px-4 py-3 hover:bg-obsidian-850">
								<input type="checkbox" checked={selectedGroups.has(group.group_id)} onChange={(event) => setSelectedGroups((current) => { const next = new Set(current); if (event.target.checked) next.add(group.group_id); else next.delete(group.group_id); return next; })} className="h-4 w-4 accent-cyber-cyan" aria-label={`Select ${group.source_ref}`} />
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-slate-200">{group.source_ref}</span>{group.is_new_group && <span className="border border-cyber-emerald/30 bg-cyber-emerald/10 px-2 py-1 text-[10px] uppercase tracking-wider text-cyber-emerald">new group</span>}</div>
									<div className="mt-1 truncate font-mono text-[10px] text-slate-500" title={group.db_path}>{group.db_path}</div>
								</div>
								<div className="text-right text-[10px] text-slate-400"><div className="text-sm font-bold text-slate-200">{group.total.toLocaleString()}</div><div><span className="text-cyber-emerald">+{group.added.toLocaleString()}</span> · <span className="text-cyber-cyan">~{group.changed.toLocaleString()}</span></div></div>
							</label>
						))}
						{!groupsQ.isFetching && groupsQ.data && !visibleGroups.length && <div className="p-5 text-center text-sm font-mono text-slate-400">Tidak ada group yang cocok.</div>}
					</div>
				</section>
			)}

			<section className="cyber-card overflow-hidden rounded-none">
				<div className="flex items-center justify-between border-b border-obsidian-800 px-4 py-3 text-xs font-mono text-slate-500" aria-busy={diffQ.isFetching}>
					<span>{diffQ.isFetching ? "Comparing..." : `${(diffQ.data?.total || 0).toLocaleString()} matching rows`}</span>
					<span>Page {page} / {totalPages}</span>
				</div>
				{diffQ.error && <div role="alert" className="p-5 text-sm font-mono text-cyber-rose">Version diff tidak dapat dimuat.</div>}
				{diffQ.data?.items.map((item) => (
					<article key={item.text_id} className="border-b border-obsidian-800 p-4">
						<div className="mb-2 flex flex-wrap items-center gap-2"><span className={`border px-2 py-1 text-[10px] uppercase ${STATUS_STYLE[item.status]}`}>{item.status}</span><code className="break-all text-xs text-slate-200">{item.text_id}</code><span className="ml-auto text-[10px] font-mono text-slate-500">{item.source_kind}:{item.source_ref}</span></div>
						<div className="grid divide-y divide-obsidian-800 border-y border-obsidian-800 md:grid-cols-2 md:divide-x md:divide-y-0">
							<div className="bg-obsidian-950 p-3"><div className="mb-1 text-[10px] uppercase tracking-widest text-cyber-rose/70">{base}</div><pre className="whitespace-pre-wrap break-words font-sans text-xs text-slate-400">{item.old_content ?? "∅"}</pre></div>
							<div className="bg-obsidian-950 p-3"><div className="mb-1 text-[10px] uppercase tracking-widest text-cyber-cyan/70">{target}</div><pre className="whitespace-pre-wrap break-words font-sans text-xs text-slate-200">{item.new_content ?? "∅"}</pre></div>
						</div>
					</article>
				))}
				{!diffQ.isFetching && !diffQ.error && diffQ.data && !diffQ.data.items.length && <div className="p-6 text-center text-sm font-mono text-slate-400">Tidak ada perbedaan yang cocok.</div>}
				<div className="flex justify-end gap-2 border-t border-obsidian-800 p-3">
					<button type="button" className={buttonClass} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="mr-1 inline h-3 w-3" /> Previous</button>
					<button type="button" className={buttonClass} disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight className="ml-1 inline h-3 w-3" /></button>
				</div>
			</section>
		</div>
	);
}
