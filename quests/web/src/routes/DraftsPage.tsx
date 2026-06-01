import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useLogout, useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import type { Draft, DraftPatch } from "../lib/types";

function parsePatch(draft: Draft): DraftPatch {
  try {
    const patch = JSON.parse(draft.patch_json) as unknown;
    return patch && typeof patch === "object" && !Array.isArray(patch)
      ? patch as DraftPatch
      : {};
  } catch {
    return {};
  }
}

function PatchPreview({ draft }: { draft: Draft }) {
  const patch = parsePatch(draft);
  const entries = Object.entries(patch);

  if (entries.length === 0) {
    return <div className="text-xs text-slate-500">No patch fields.</div>;
  }

  return (
    <div className="space-y-2 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded border border-white/10 bg-bg-2 p-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-accent-teal">
            {key}
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-slate-300">
            {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ))}
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
  const pending = (draftsQ.data ?? []).filter((draft) => draft.status === "pending");

  return (
    <div className="container-narrow space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-slate-100">Drafts</h1>
          <div className="mt-1 text-xs text-slate-500">role: {role}</div>
        </div>
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

      <section className="card divide-y divide-white/10">
        {draftsQ.isLoading && (
          <div className="p-4 text-sm text-slate-500">Loading drafts...</div>
        )}
        {draftsQ.error && (
          <div className="p-4 text-sm text-rose-400">Failed to load drafts.</div>
        )}
        {!draftsQ.isLoading && !draftsQ.error && pending.length === 0 && (
          <div className="p-4 text-sm text-slate-500">No pending drafts.</div>
        )}
        {pending.map((draft) => (
          <Link
            key={draft.id}
            to={`/drafts/${draft.id}`}
            className="block p-4 transition hover:bg-white/[0.03]"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono text-slate-300">#{draft.id}</span>
              <span>quest {draft.qid}</span>
              <span>line {draft.line_id}</span>
              <span>{draft.author_label ?? getAuthorLabel()}</span>
              <span>{new Date(draft.created_at).toLocaleString()}</span>
            </div>
            <PatchPreview draft={draft} />
          </Link>
        ))}
      </section>
    </div>
  );
}

function DetailView({ draftId }: { draftId: number }) {
  const meQ = useMe();
  const queryClient = useQueryClient();
  const role = meQ.data?.role ?? "anon";
  const authorLabel = getAuthorLabel();
  const draftQ = useQuery({
    queryKey: ["draft", draftId, role === "editor" ? "editor" : authorLabel],
    queryFn: () => api.getDraft(draftId, role === "editor" ? null : authorLabel),
    enabled: !!draftId && !!meQ.data,
  });
  const approveQ = useMutation({
    mutationFn: () => api.approveDraft(draftId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["draft", draftId] }),
        queryClient.invalidateQueries({ queryKey: ["editor"] }),
        draft ? queryClient.invalidateQueries({ queryKey: ["quest", draft.qid] }) : Promise.resolve(),
      ]);
    },
  });
  const rejectQ = useMutation({
    mutationFn: () => api.rejectDraft(draftId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["draft", draftId] }),
        queryClient.invalidateQueries({ queryKey: ["editor"] }),
      ]);
    },
  });
  const draft = draftQ.data;
  const canReview = role === "editor" && draft?.status === "pending";
  const busy = approveQ.isPending || rejectQ.isPending;

  if (draftQ.isLoading) {
    return <div className="container-narrow text-sm text-slate-500">Loading draft...</div>;
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
          <span className="text-accent-teal">{draft.status}</span>
        </div>
      </div>

      {draft.note && (
        <div className="card p-3 text-sm text-slate-300">{draft.note}</div>
      )}

      <section className="card p-4">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">Patch</h2>
        <PatchPreview draft={draft} />
      </section>

      {canReview && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => approveQ.mutate()}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => rejectQ.mutate()}
          >
            Reject
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
