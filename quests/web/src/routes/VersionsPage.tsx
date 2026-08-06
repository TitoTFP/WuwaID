import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { canEdit, useMe } from "../lib/auth";
import type { TextDiffGroup, TextDiffStatus } from "../lib/types";

const PAGE_SIZE = 100;
const STATUS_STYLE: Record<TextDiffStatus, string> = {
  added: "border-accent-signal/30 bg-accent-signal/10 text-accent-signal",
  removed: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  changed: "border-accent-signal/30 bg-accent-signal/10 text-accent-signal",
};

export default function VersionsPage() {
  const meQ = useMe();
  const queryClient = useQueryClient();
  const versionsQ = useQuery({
    queryKey: ["text-versions"],
    queryFn: api.textVersions,
    enabled: canEdit(meQ.data?.role),
  });
  const versions = versionsQ.data ?? [];
  const [base, setBase] = useState("");
  const [target, setTarget] = useState("");
  const [lang, setLang] = useState<"en" | "zh-Hans" | "ja">("en");
  const [status, setStatus] = useState<TextDiffStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [groupTab, setGroupTab] = useState<"category" | "quest">("category");
  const [groupSearch, setGroupSearch] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    if (!target && versions[0]) setTarget(versions[0].tag);
    if (!base && versions[1]) setBase(versions[1].tag);
  }, [versions, base, target]);

  useEffect(() => setPage(1), [base, target, lang, status, search]);

  const diffQ = useQuery({
    queryKey: ["text-version-diff", base, target, lang, status, search, page],
    queryFn: () => api.textVersionDiff({
      base, target, lang, status: status || undefined, q: search || undefined,
      page, page_size: PAGE_SIZE,
    }),
    enabled: canEdit(meQ.data?.role) && !!base && !!target && base !== target,
  });

  const groupsQ = useQuery({
    queryKey: ["text-version-groups", base, target, lang],
    queryFn: () => api.textVersionGroups({ base, target, lang }),
    enabled: canEdit(meQ.data?.role) && !!base && !!target && base !== target,
    staleTime: Infinity,
  });

  useEffect(() => {
    setSelectedGroups(new Set());
    setGroupSearch("");
  }, [base, target, lang]);

  useEffect(() => {
    if (groupsQ.data) {
      setSelectedGroups(new Set(groupsQ.data.groups.map((group) => group.group_id)));
    }
  }, [groupsQ.data]);

  const createM = useMutation({
    mutationFn: () => api.createTextVersion(tag.trim(), note.trim()),
    onSuccess: async () => {
      setTag("");
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["text-versions"] });
    },
  });

  async function downloadStructured() {
    if (!base || !target || !selectedGroups.size) return;
    setIsDownloading(true);
    setDownloadError("");
    try {
      const { blob, filename } = await api.downloadStructuredTextDiff({
        base, target, lang, groups: Array.from(selectedGroups),
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(String(error));
    } finally {
      setIsDownloading(false);
    }
  }

  if (meQ.isLoading) return <div className="container-narrow" role="status" aria-live="polite"><div className="border-y border-white/10 p-6">Loading…</div></div>;
  if (meQ.isError) {
    return (
      <div className="container-narrow space-y-3" role="alert">
        <p className="text-sm text-rose-300">Unable to check editor access.</p>
        <button type="button" className="btn" onClick={() => void meQ.refetch()}>Retry</button>
      </div>
    );
  }
  if (!canEdit(meQ.data?.role)) {
    return (
      <div className="container-narrow">
        <div className="border-y border-white/10 p-6 text-center">
          <h1 className="min-w-0 [overflow-wrap:anywhere] font-serif text-2xl text-slate-100">Text Versions</h1>
          <p className="mt-2 text-base text-slate-400">Editor login is required to view official-text history.</p>
          <Link className="btn mt-4" to="/login">Login</Link>
        </div>
      </div>
    );
  }

  if (versionsQ.isError) {
    return (
      <div className="container-narrow space-y-3" role="alert">
        <p className="text-sm text-rose-300">Unable to load text versions.</p>
        <button type="button" className="btn" onClick={() => void versionsQ.refetch()}>Retry</button>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil((diffQ.data?.total ?? 0) / PAGE_SIZE));
  const choices = [...versions.map((version) => version.tag), "working"];
  const groupNeedle = groupSearch.trim().toLowerCase();
  const visibleGroups = (groupsQ.data?.groups ?? []).filter((group) =>
    group.source_kind === groupTab && (
      !groupNeedle
      || group.source_ref.toLowerCase().includes(groupNeedle)
      || group.db_path.toLowerCase().includes(groupNeedle)
    )
  );
  const selectedRows = (groupsQ.data?.groups ?? [])
    .filter((group) => selectedGroups.has(group.group_id))
    .reduce((total, group) => total + group.total, 0);
  return (
    <div className="versions-page container-wide overflow-y-auto pb-12" aria-labelledby="versions-heading">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="font-mono text-xs text-accent-signal">Official MultiText history</div>
          <h1 id="versions-heading" className="mt-1 min-w-0 [overflow-wrap:anywhere] font-serif text-3xl text-slate-100 sm:text-4xl">Text Versions</h1>
          <p className="mt-1 text-base text-slate-400">Immutable EN, ZH-Hans, and JA snapshots. Indonesian/editor overlays are excluded.</p>
        </div>
      </header>

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="overflow-hidden border-y border-white/15 bg-bg-1/40">
          <div className="border-b border-white/5 px-4 py-3 text-xs uppercase tracking-widest text-slate-500">Saved tags</div>
          <div className="max-h-64 overflow-y-auto" tabIndex={0} aria-label="Saved text versions">
            {versionsQ.isPending && <p className="p-5 text-sm text-slate-400" role="status" aria-live="polite">Loading versions…</p>}
            {versions.map((version) => (
              <div key={version.id} className="grid gap-2 border-b border-white/5 px-4 py-3 text-xs md:grid-cols-[8rem_1fr_auto]">
                <div className="font-mono text-accent-signal">{version.tag}</div>
                <div>
                  <div className="text-slate-300">{version.note || "No note"}</div>
                  <div className="mt-1 font-mono text-[10px] text-slate-500">{version.dataset_hash.slice(0, 16)} · {new Date(version.created_at).toLocaleString()}</div>
                </div>
                <div className="text-right text-slate-400">
                  <div>{version.row_count.toLocaleString()} rows</div>
                  <div className="text-[10px]">{version.category_row_count.toLocaleString()} category · {version.quest_row_count.toLocaleString()} quest</div>
                </div>
              </div>
            ))}
            {!versionsQ.isPending && !versions.length && <div className="p-5 text-sm text-slate-400" role="status" aria-live="polite">No saved versions yet.</div>}
          </div>
        </div>

        <form className="border-y border-white/15 bg-bg-2/30 p-4" onSubmit={(event) => { event.preventDefault(); if (tag.trim()) createM.mutate(); }}>
          <h2 className="font-serif text-xl text-slate-100">Tag working tree</h2>
          <label htmlFor="version-tag" className="mt-3 block text-xs text-slate-400">Tag</label>
          <input id="version-tag" className="input mt-1" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="v3.6" />
          <label htmlFor="version-note" className="mt-3 block text-xs text-slate-400">Note</label>
          <textarea id="version-note" className="input mt-1 min-h-20 resize-y" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Official game update" />
          <button type="submit" className="btn btn-active mt-3" disabled={!tag.trim() || createM.isPending}>
            {createM.isPending ? "Creating snapshot…" : "Create immutable tag"}
          </button>
          {createM.error && <div role="alert" className="mt-2 text-xs text-rose-300">Unable to create this snapshot. Check the tag and retry.</div>}
        </form>
      </section>

      <section className="mb-4 border-y border-white/15 bg-bg-2/30 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_10rem_1fr_auto]">
          <label htmlFor="version-base" className="text-xs text-slate-400">Base
            <select id="version-base" className="input mt-1" value={base} onChange={(event) => setBase(event.target.value)}>
              <option value="">Select version</option>{choices.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label htmlFor="version-target" className="text-xs text-slate-400">Target
            <select id="version-target" className="input mt-1" value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Select version</option>{choices.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label htmlFor="version-language" className="text-xs text-slate-400">Language
            <select id="version-language" className="input mt-1" value={lang} onChange={(event) => setLang(event.target.value as typeof lang)}>
              <option value="en">English</option><option value="zh-Hans">ZH-Hans</option><option value="ja">Japanese</option>
            </select>
          </label>
          <label htmlFor="version-search" className="text-xs text-slate-400">Search Id or Content
            <input id="version-search" className="input mt-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Quest_…" />
          </label>
          <div className="flex items-end gap-2">
            {base && target && base !== target && <>
              <a className="btn" href={api.textVersionExportUrl({ base, target, lang, format: "sqlite" })}>SQLite</a>
              <a className="btn" href={api.textVersionExportUrl({ base, target, lang, format: "csv" })}>CSV</a>
            </>}
          </div>
        </div>
        {base === target && base && <div className="mt-2 text-xs text-rose-300" role="alert">Base and target must be different.</div>}
      </section>

      {diffQ.data && (
        <div className="mb-4 grid grid-cols-3 divide-x divide-white/10 border-y border-white/15">
          {(["added", "removed", "changed"] as TextDiffStatus[]).map((value) => (
            <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(status === value ? "" : value)} className={`min-w-0 border-0 p-3 text-left ${STATUS_STYLE[value]} ${status && status !== value ? "opacity-40" : ""}`}>
              <div className="text-[10px] uppercase tracking-widest">{value}</div>
              <div className="mt-1 truncate font-mono text-xl font-semibold sm:text-2xl">{diffQ.data.summary[value].toLocaleString()}</div>
            </button>
          ))}
        </div>
      )}

      {base && target && base !== target && (
        <section className="mb-4 overflow-hidden border-y border-white/15 bg-bg-1/40">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-400">Groups &amp; Quests</div>
              <div className="mt-1 text-[11px] text-slate-500">
                {selectedGroups.size.toLocaleString()} groups · {selectedRows.toLocaleString()} rows selected
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" type="button" onClick={() => setSelectedGroups(new Set((groupsQ.data?.groups ?? []).map((group) => group.group_id)))}>
                Select All
              </button>
              <button className="btn" type="button" onClick={() => setSelectedGroups(new Set())}>Clear</button>
              <button className="btn btn-active" type="button" disabled={!selectedGroups.size || isDownloading} onClick={downloadStructured}>
                {isDownloading ? "Building ZIP…" : "Structured DB ZIP"}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-white/5 p-3" role="tablist" aria-label="Version diff groups">
            {(["category", "quest"] as const).map((kind) => {
              const count = (groupsQ.data?.groups ?? []).filter((group) => group.source_kind === kind).length;
              return (
                <button key={kind} type="button" role="tab" aria-selected={groupTab === kind} onClick={() => setGroupTab(kind)} className={`btn ${groupTab === kind ? "btn-active" : ""}`}>
                  {kind === "category" ? "Categories" : "Quests"} ({count})
                </button>
              );
            })}
            <label className="ml-auto block max-w-sm">
              <span className="sr-only">Search groups</span>
              <input className="input w-full" value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Search group name or QID…" />
            </label>
          </div>
          {groupsQ.isFetching && <div className="p-5 text-sm text-slate-400" role="status" aria-live="polite">Grouping diff rows…</div>}
          {groupsQ.error && <div className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-rose-300" role="alert"><span>Unable to load diff groups.</span><button type="button" className="btn text-xs" onClick={() => void groupsQ.refetch()}>Retry</button></div>}
          {downloadError && <div role="alert" className="border-b border-rose-400/20 bg-rose-500/5 p-3 text-xs text-rose-300">{downloadError}</div>}
          <div className="max-h-96 overflow-y-auto" tabIndex={0} aria-label="Diff groups">
            {visibleGroups.map((group: TextDiffGroup) => (
              <label key={group.group_id} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 px-4 py-3 hover:bg-white/[0.02]">
                <input
                  type="checkbox"
                  checked={selectedGroups.has(group.group_id)}
                  onChange={(event) => setSelectedGroups((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(group.group_id); else next.delete(group.group_id);
                    return next;
                  })}
                  className="h-4 w-4 accent-amber-400"
                  aria-label={`Select ${group.source_ref}`}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-200">{group.source_ref}</span>
                    {group.is_new_group && <span className="border border-accent-signal/30 bg-accent-signal/10 px-2 py-1 text-[10px] uppercase tracking-wider text-accent-signal">new group</span>}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-slate-500" title={group.db_path}>{group.db_path}</div>
                </div>
                <div className="text-right text-[10px] text-slate-400">
                  <div className="text-sm font-semibold text-slate-200">{group.total.toLocaleString()}</div>
                  <div><span className="text-accent-signal">+{group.added.toLocaleString()}</span> · <span className="text-accent-signal">~{group.changed.toLocaleString()}</span></div>
                </div>
              </label>
            ))}
            {!groupsQ.isFetching && !groupsQ.error && groupsQ.data && !visibleGroups.length && <div className="p-5 text-sm text-slate-400" role="status" aria-live="polite">No groups match this view.</div>}
          </div>
        </section>
      )}

      <section className="overflow-hidden border-y border-white/15 bg-bg-1/40">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3 text-xs text-slate-500" aria-busy={diffQ.isFetching}>
          <span>{diffQ.isFetching ? "Comparing…" : `${(diffQ.data?.total ?? 0).toLocaleString()} matching rows`}</span>
          <span>Page {page} / {totalPages}</span>
        </div>
        {diffQ.error && <div className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-rose-300" role="alert"><span>Unable to load this version diff.</span><button type="button" className="btn text-xs" onClick={() => void diffQ.refetch()}>Retry</button></div>}
        {diffQ.data?.items.map((item) => (
          <article key={item.text_id} className="border-b border-white/5 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`border px-2 py-1 text-[10px] uppercase ${STATUS_STYLE[item.status]}`}>{item.status}</span>
              <code className="break-all text-xs text-slate-200">{item.text_id}</code>
              <span className="ml-auto text-[10px] text-slate-500">{item.source_kind}:{item.source_ref}</span>
            </div>
            <div className="grid divide-y divide-white/10 border-y border-white/10 md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="bg-bg-2 p-3">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-rose-300/70">{base}</div>
                <pre className="whitespace-pre-wrap break-words font-sans text-xs text-slate-400">{item.old_content ?? "∅"}</pre>
              </div>
              <div className="bg-bg-2 p-3">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-accent-signal/70">{target}</div>
                <pre className="whitespace-pre-wrap break-words font-sans text-xs text-slate-200">{item.new_content ?? "∅"}</pre>
              </div>
            </div>
          </article>
        ))}
        {!diffQ.isFetching && !diffQ.error && diffQ.data && !diffQ.data.items.length && <div className="p-6 text-center text-sm text-slate-400" role="status" aria-live="polite">No differences match these filters.</div>}
        <div className="flex justify-end gap-2 p-3">
          <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <button type="button" className="btn" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      </section>
    </div>
  );
}
