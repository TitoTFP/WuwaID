import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useLogout, useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import type { Draft, DraftPatch, DraftStatus } from "../lib/types";
import { diffWords } from "../lib/diff";
import { useToast } from "../components/Toast";
import ConfirmDialog from "../components/editor/ConfirmDialog";
import Skeleton from "../components/editor/Skeleton";

const STATUSES: DraftStatus[] = ["pending", "applied", "rejected", "withdrawn"];

function parsePatch(draft: Draft): DraftPatch {
  if (draft.patch) return draft.patch;
  try {
    const patch = JSON.parse(draft.patch_json) as unknown;
    return patch && typeof patch === "object" && !Array.isArray(patch)
      ? patch as DraftPatch
      : {};
  } catch {
    return {};
  }
}

function PatchDiff({ field, before, after }: { field: string; before: unknown; after: unknown }) {
  const beforeStr = typeof before === "string" ? before : JSON.stringify(before ?? null);
  const afterStr = typeof after === "string" ? after : JSON.stringify(after ?? null);
  const spans = useMemo(() => diffWords(beforeStr, afterStr), [beforeStr, afterStr]);
  const isStruct = field === "options";
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="rounded border border-white/10 bg-bg-2 p-2">
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-slate-500">
          <span>original {field}</span>
          <span className="text-rose-300/60">−{beforeStr.length}</span>
        </div>
        <pre className={["whitespace-pre-wrap break-words font-sans text-slate-400", isStruct ? "text-[11px]" : ""].join(" ")}>
          {spans
            .filter((s) => s.op !== "added")
            .map((s, i) =>
              s.op === "removed" ? (
                <span key={i} className="diff-removed">{s.value}</span>
              ) : (
                <span key={i}>{s.value}</span>
              ),
            )}
        </pre>
      </div>
      <div className="rounded border border-accent-gold/20 bg-accent-gold/5 p-2">
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-accent-gold">
          <span>draft {field}</span>
          <span className="text-accent-teal/70">+{afterStr.length}</span>
        </div>
        <pre className={["whitespace-pre-wrap break-words font-sans text-slate-200", isStruct ? "text-[11px]" : ""].join(" ")}>
          {spans
            .filter((s) => s.op !== "removed")
            .map((s, i) =>
              s.op === "added" ? (
                <span key={i} className="diff-added">{s.value}</span>
              ) : (
                <span key={i}>{s.value}</span>
              ),
            )}
        </pre>
      </div>
    </div>
  );
}

function OriginalDiff({ draft }: { draft: Draft }) {
  const patch = parsePatch(draft);
  const original = draft.original_json;
  if (!original) return null;
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">Original vs draft</h2>
      <div className="space-y-3 text-xs">
        {Object.entries(patch).map(([key, value]) => (
          <PatchDiff
            key={key}
            field={key}
            before={original[key as keyof typeof original]}
            after={value}
          />
        ))}
      </div>
    </section>
  );
}

function PatchSummary({ draft }: { draft: Draft }) {
  const patch = parsePatch(draft);
  const entries = Object.entries(patch);
  if (entries.length === 0) return <div className="text-xs text-slate-500">No patch fields.</div>;
  return (
    <div className="space-y-2 text-xs">
      {entries.map(([key, value]) => {
        const isStruct = typeof value !== "string";
        return (
          <div key={key} className="rounded border border-white/10 bg-bg-2 p-2">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-accent-teal">
              {key}
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans text-slate-300">
              {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
            </pre>
            {isStruct && <div className="mt-1 text-[10px] text-slate-500">structured value</div>}
          </div>
        );
      })}
    </div>
  );
}

type Filters = {
  qid: string;
  author: string;
  status: DraftStatus | "";
  dateFrom: string;
  dateTo: string;
};

function applyFilters(drafts: Draft[], filters: Filters): Draft[] {
  return drafts.filter((draft) => {
    if (filters.qid && String(draft.qid) !== filters.qid) return false;
    if (filters.author && (draft.author_label ?? "") !== filters.author) return false;
    if (filters.status && draft.status !== filters.status) return false;
    if (filters.dateFrom && new Date(draft.created_at) < new Date(filters.dateFrom)) return false;
    if (filters.dateTo && new Date(draft.created_at) > new Date(filters.dateTo + "T23:59:59")) return false;
    return true;
  });
}

function FilterBar({ filters, onChange, qids, authors }: {
  filters: Filters;
  onChange: (next: Filters) => void;
  qids: number[];
  authors: string[];
}) {
  return (
    <div className="card flex flex-wrap items-end gap-2 p-2 text-xs">
      <label className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">Quest</div>
        <select
          value={filters.qid}
          onChange={(e) => onChange({ ...filters, qid: e.target.value })}
          className="input h-7 min-w-[6rem] text-xs"
        >
          <option value="">all</option>
          {qids.map((qid) => (
            <option key={qid} value={qid}>
              #{qid}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">Author</div>
        <select
          value={filters.author}
          onChange={(e) => onChange({ ...filters, author: e.target.value })}
          className="input h-7 min-w-[8rem] text-xs"
        >
          <option value="">all</option>
          {authors.map((author) => (
            <option key={author} value={author}>
              {author}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">Status</div>
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value as DraftStatus | "" })}
          className="input h-7 min-w-[7rem] text-xs"
        >
          <option value="">all</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">From</div>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
          className="input h-7 text-xs"
        />
      </label>
      <label className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">To</div>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
          className="input h-7 text-xs"
        />
      </label>
      <button
        type="button"
        className="btn h-7 text-[11px]"
        onClick={() => onChange({ qid: "", author: "", status: "", dateFrom: "", dateTo: "" })}
      >
        reset
      </button>
    </div>
  );
}

function QueueView() {
  const meQ = useMe();
  const logout = useLogout();
  const role = meQ.data?.role ?? "anon";
  const authorLabel = getAuthorLabel();
  const draftsQ = useQuery({
    queryKey: ["drafts", role === "editor" ? "editor" : authorLabel],
    queryFn: () => api.listDrafts(role === "editor" ? null : authorLabel),
    enabled: !!meQ.data,
  });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>({ qid: "", author: "", status: "", dateFrom: "", dateTo: "" });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportMutation = useMutation({
    mutationFn: () => api.exportTranslations(),
    onMutate: () => setExporting(true),
    onSuccess: () => {
      setExporting(false);
      toast.success("Translations successfully exported to output_db/id!");
    },
    onError: (err: any) => {
      setExporting(false);
      toast.error(`Export failed: ${err.message || err}`);
    }
  });

  const all = draftsQ.data ?? [];
  const filtered = useMemo(() => applyFilters(all, filters), [all, filters]);
  const qids = useMemo(() => Array.from(new Set(all.map((d) => d.qid))).sort((a, b) => a - b), [all]);
  const authors = useMemo(() => Array.from(new Set(all.map((d) => d.author_label ?? "anon"))).sort(), [all]);
  const selectedDrafts = useMemo(() => filtered.filter((d) => selected.has(d.id) && d.status === "pending"), [filtered, selected]);

  const bulkApproveQ = useMutation({
    mutationFn: async (ids: number[]) => {
      let count = 0;
      for (const id of ids) {
        await api.approveDraft(id);
        count++;
      }
      return count;
    },
    onSuccess: async (count) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["editor"] }),
      ]);
      setSelected(new Set());
      toast.success(`Approved ${count} draft(s)`);
    },
    onError: () => toast.error("Bulk approve failed"),
  });
  const bulkRejectQ = useMutation({
    mutationFn: async (ids: number[]) => {
      let count = 0;
      for (const id of ids) {
        await api.rejectDraft(id);
        count++;
      }
      return count;
    },
    onSuccess: async (count) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["editor"] }),
      ]);
      setSelected(new Set());
      toast.success(`Rejected ${count} draft(s)`);
    },
    onError: () => toast.error("Bulk reject failed"),
  });

  function toggleSelect(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    const ids = filtered.filter((d) => d.status === "pending").map((d) => d.id);
    setSelected(new Set(ids));
  }

  return (
    <div className="container-narrow space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-slate-100">Drafts</h1>
          <div className="mt-1 text-xs text-slate-500">role: {role}</div>
        </div>
        <div className="flex gap-2">
          {role === "editor" && (
            <button
              type="button"
              className="btn btn-active"
              disabled={exporting}
              onClick={() => exportMutation.mutate()}
            >
              {exporting ? "Exporting..." : "Export to SQLite"}
            </button>
          )}
          {role === "editor" ? (
            <button type="button" className="btn" onClick={() => void logout()}>
              Log out
            </button>
          ) : (
            <Link to="/login?next=/drafts" className="btn">
              Log in
            </Link>
          )}
        </div>
      </div>

      <FilterBar filters={filters} onChange={setFilters} qids={qids} authors={authors} />

      {role === "editor" && selectedDrafts.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-accent-gold/30 bg-accent-gold/5 p-2 text-xs">
          <span className="text-slate-200">{selectedDrafts.length} pending selected</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-active text-xs"
              onClick={() => setConfirmAction("approve")}
              disabled={bulkApproveQ.isPending}
            >
              {bulkApproveQ.isPending ? "approving..." : "Approve selected"}
            </button>
            <button
              type="button"
              className="btn text-xs"
              onClick={() => setConfirmAction("reject")}
              disabled={bulkRejectQ.isPending}
            >
              {bulkRejectQ.isPending ? "rejecting..." : "Reject selected"}
            </button>
            <button type="button" className="btn text-xs" onClick={() => setSelected(new Set())}>
              clear
            </button>
          </div>
        </div>
      )}

      <section className="card divide-y divide-white/10">
        {draftsQ.isLoading && (
          <div className="p-4">
            <Skeleton lines={5} />
          </div>
        )}
        {draftsQ.error && (
          <div className="p-4 text-sm text-rose-400">Failed to load drafts.</div>
        )}
        {!draftsQ.isLoading && !draftsQ.error && filtered.length === 0 && (
          <div className="p-4 text-sm text-slate-500">No drafts match these filters.</div>
        )}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-1.5 text-[10px] uppercase tracking-widest text-slate-500">
            <span>{filtered.length} draft(s)</span>
            {role === "editor" && (
              <button type="button" className="btn px-2 py-0.5 text-[10px]" onClick={selectAllVisible}>
                select all pending
              </button>
            )}
          </div>
        )}
        {filtered.map((draft) => {
          const isSelected = selected.has(draft.id);
          const selectable = role === "editor" && draft.status === "pending";
          return (
            <div
              key={draft.id}
              className={[
                "flex items-start gap-3 p-4 transition hover:bg-white/[0.03]",
                isSelected ? "bg-accent-gold/5" : "",
              ].join(" ")}
            >
              {selectable && (
                <input
                  type="checkbox"
                  className="mt-1 accent-accent-gold"
                  checked={isSelected}
                  onChange={() => toggleSelect(draft.id)}
                  aria-label={`Select draft ${draft.id}`}
                />
              )}
              <Link to={`/drafts/${draft.id}`} className="block flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono text-slate-300">#{draft.id}</span>
                  <span>quest {draft.qid}</span>
                  <span>line {draft.line_id}</span>
                  <span>{draft.author_label ?? getAuthorLabel()}</span>
                  <span>{new Date(draft.created_at).toLocaleString()}</span>
                  <span
                    className={[
                      "rounded px-1.5 py-0.5 text-[10px]",
                      draft.status === "pending"
                        ? "bg-violet-500/20 text-violet-200"
                        : draft.status === "applied"
                          ? "bg-accent-teal/20 text-accent-teal"
                          : draft.status === "rejected"
                            ? "bg-rose-500/20 text-rose-200"
                            : "bg-white/5 text-slate-400",
                    ].join(" ")}
                  >
                    {draft.status}
                  </span>
                </div>
                <PatchSummary draft={draft} />
              </Link>
            </div>
          );
        })}
      </section>

      <ConfirmDialog
        open={confirmAction === "approve"}
        title="Approve selected drafts?"
        message={`This will apply ${selectedDrafts.length} draft(s) to the quest. This action cannot be undone from the webui.`}
        confirmLabel="Approve all"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          bulkApproveQ.mutate(Array.from(selectedDrafts.map((d) => d.id)));
          setConfirmAction(null);
        }}
      />
      <ConfirmDialog
        open={confirmAction === "reject"}
        title="Reject selected drafts?"
        message={`This will reject ${selectedDrafts.length} draft(s). Contributors can see rejections but cannot revive them from the webui.`}
        confirmLabel="Reject all"
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          bulkRejectQ.mutate(Array.from(selectedDrafts.map((d) => d.id)));
          setConfirmAction(null);
        }}
      />
    </div>
  );
}

function DetailView({ draftId }: { draftId: number }) {
  const meQ = useMe();
  const queryClient = useQueryClient();
  const role = meQ.data?.role ?? "anon";
  const draftQ = useQuery({
    queryKey: ["draft", draftId, role === "editor" ? "editor" : getAuthorLabel()],
    queryFn: () => api.getDraft(draftId, role === "editor" ? null : getAuthorLabel()),
    enabled: !!draftId && !!meQ.data,
  });
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const toast = useToast();
  const approveQ = useMutation({
    mutationFn: () => api.approveDraft(draftId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["draft", draftId] }),
        queryClient.invalidateQueries({ queryKey: ["editor"] }),
        draftQ.data ? queryClient.invalidateQueries({ queryKey: ["quest", draftQ.data.qid] }) : Promise.resolve(),
      ]);
      toast.success("Draft approved");
    },
    onError: () => toast.error("Failed to approve"),
  });
  const rejectQ = useMutation({
    mutationFn: () => api.rejectDraft(draftId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["draft", draftId] }),
        queryClient.invalidateQueries({ queryKey: ["editor"] }),
      ]);
      toast.success("Draft rejected");
    },
    onError: () => toast.error("Failed to reject"),
  });
  const draft = draftQ.data;
  const canReview = role === "editor" && draft?.status === "pending";
  const busy = approveQ.isPending || rejectQ.isPending;

  if (draftQ.isLoading) {
    return (
      <div className="container-narrow">
        <Skeleton variant="form" />
      </div>
    );
  }
  if (draftQ.error || !draft) {
    return <div className="container-narrow text-sm text-rose-400">Draft {draftId} not found.</div>;
  }

  return (
    <div className="container-narrow space-y-4">
      <div>
        <Link to="/drafts" className="link text-xs">← back to drafts</Link>
        <h1 className="mt-1 font-serif text-2xl text-slate-100">
          Draft #{draft.id} · quest {draft.qid} · line {draft.line_id || "new"}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{draft.author_label ?? getAuthorLabel()}</span>
          <span>{new Date(draft.created_at).toLocaleString()}</span>
          <span
            className={[
              "rounded px-1.5 py-0.5 text-[10px]",
              draft.status === "pending"
                ? "bg-violet-500/20 text-violet-200"
                : draft.status === "applied"
                  ? "bg-accent-teal/20 text-accent-teal"
                  : "bg-white/5 text-slate-400",
            ].join(" ")}
          >
            {draft.status}
          </span>
        </div>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">Note</h2>
        {savedNote !== null ? (
          <div className="text-sm text-slate-300">{savedNote}</div>
        ) : draft.note ? (
          <div className="text-sm text-slate-300">{draft.note}</div>
        ) : (
          <div className="text-sm text-slate-500">No note.</div>
        )}
        {role === "editor" && draft.status === "pending" && (
          <div className="mt-2 space-y-2">
            <textarea
              className="input min-h-20 resize-y text-xs"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add or replace reviewer note…"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn text-xs"
                onClick={() => {
                  setSavedNote(note);
                  toast.success("Note attached locally (backend persistence needs separate endpoint)");
                }}
              >
                Attach note
              </button>
              <button
                type="button"
                className="btn text-xs"
                onClick={() => setNote("")}
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">Patch</h2>
        <PatchSummary draft={draft} />
      </section>

      <OriginalDiff draft={draft} />

      {canReview && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-active"
            disabled={busy}
            onClick={() => approveQ.mutate()}
          >
            {approveQ.isPending ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => rejectQ.mutate()}
          >
            {rejectQ.isPending ? "Rejecting…" : "Reject"}
          </button>
        </div>
      )}
      {(approveQ.error || rejectQ.error) && (
        <div className="text-sm text-rose-400">Failed to update draft.</div>
      )}
    </div>
  );
}

export default function DraftsPage() {
  const { draftId } = useParams();
  const draftIdN = Number(draftId);

  if (draftId) return <DetailView draftId={draftIdN} />;
  return <QueueView />;
}
