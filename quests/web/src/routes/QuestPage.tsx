import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../components/Toast";
import ExportDialog, { type ExportMode } from "../components/editor/ExportDialog";
import ConfirmDialog from "../components/editor/ConfirmDialog";
import DialogueStream, { type QuestRow } from "../components/DialogueStream";
import { canEdit, useMe } from "../lib/auth";
import { api } from "../lib/api";
import type { DialogueLine as DialogueLineT, Lang } from "../lib/types";
export default function QuestPage() {
  const { qid = "0" } = useParams();
  const qidN = Number(qid);
  const location = useLocation();
  const [params] = useSearchParams();
  const primary = (params.get("lang") ?? "en") as Lang;
  const highlightQ = params.get("q");
  const anchorLineId = useMemo(() => {
    const match = location.hash.match(/^#L(\d+)$/);
    return match ? Number(match[1]) : null;
  }, [location.hash]);

  const toast = useToast();
  const [showExportModal, setShowExportModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const meQ = useMe();
  const role = meQ.data?.role ?? "anon";
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteQuestTranslation(qidN),
    onSuccess: () => {
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ["quest", qidN] });
    },
    onError: (err: any) => {
      toast.error(`Delete failed: ${err.message || err}`);
    }
  });

  const exportMutation = useMutation({
    mutationFn: (mode: ExportMode) =>
      api.exportTranslations({
        quest_ids: [qidN],
        export_mode: mode,
        only_untranslated: mode === "untranslated",
      }),
    onSuccess: (res) => {
      setShowExportModal(false);
      const file = res.files?.[0];
      if (file) {
        toast.success(`Quest successfully exported to output_db/id/${file}!`);
      } else {
        toast.success("Quest successfully exported to output_db/id!");
      }
    },
    onError: (err: any) => {
      toast.error(`Export failed: ${err.message || err}`);
    }
  });

  const { data: quest, isLoading, error } = useQuery({
    queryKey: ["quest", qidN],
    queryFn: () => api.quest(qidN),
    enabled: !!qidN,
  });

  const groups = useMemo(() => {
    if (!quest) return [];
    const plotModeByKey = quest.plot_mode_by_state;
    const lines = quest.all_lines;
    const g: { flow_name: string; state_id: number; plot_mode: string; lines: typeof lines }[] = [];
    let cur: { flow_name: string; state_id: number; plot_mode: string; lines: typeof lines } | null = null;
    for (const l of lines) {
      const m = (l.state_key ?? "").match(/^(.*)_(\d+)_(\d+)$/);
      if (!m) continue;
      const flow_name = m[1];
      const state_id = Number(m[2]);
      const pm = plotModeByKey[l.state_key ?? ""] ?? "Normal";
      if (!cur || cur.flow_name !== flow_name || cur.state_id !== state_id) {
        cur = { flow_name, state_id, plot_mode: pm, lines: [] };
        g.push(cur);
      }
      cur.lines.push(l);
    }
    return g;
  }, [quest]);

  const rows = useMemo<QuestRow[]>(() => {
    const out: QuestRow[] = [];
    for (const g of groups) {
      out.push({
        kind: "header",
        key: `h-${g.flow_name}-${g.state_id}`,
        flow_name: g.flow_name,
        state_id: g.state_id,
        plot_mode: g.plot_mode,
      });
      for (const l of g.lines) {
        out.push({ kind: "line", key: `l-${l.id}`, line: l, plot_mode: g.plot_mode });
      }
    }
    return out;
  }, [groups]);

  const lineIndex = useMemo(() => {
    const byKey = new Map<string, number>();
    const byId = new Map<number, DialogueLineT>();
    for (const l of quest?.all_lines ?? []) {
      byId.set(l.id, l);
      if (l.plot_line_key) byKey.set(l.plot_line_key, l.id);
      if (l.text_key) byKey.set(l.text_key, l.id);
    }
    return { byKey, byId };
  }, [quest]);


  if (isLoading) {
    return (
      <div className="reader-state container-narrow py-6" role="status" aria-live="polite" aria-busy="true">
        <span className="reader-state__label">Loading quest</span>
        <span>Preparing dialogue stream…</span>
      </div>
    );
  }
  if (error || !quest) {
    return (
      <div className="reader-state container-narrow py-6" role="alert">
        <span className="reader-state__label">Quest unavailable</span>
        <span>Quest {qid} could not be loaded.</span>
        <Link to="/" className="link inline-flex min-h-11 items-center">
          Return to archive
        </Link>
      </div>
    );
  }

  return (
    <div className="container-narrow flex flex-1 flex-col gap-4 overflow-hidden pb-2">
      <header className="shrink-0 border-b border-white/10 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <Link
              to={quest.side === 1 ? "/side-quests" : `/chapters/${quest.chapter_id ?? 0}`}
              className="link inline-flex min-h-11 items-center whitespace-nowrap text-xs"
            >
              ← {quest.side === 1 ? "Side quests" : "Chapter"}
            </Link>
            <h1 className="min-w-0 [overflow-wrap:anywhere] font-serif text-2xl leading-tight text-slate-100 sm:text-3xl">
              {quest.quest_name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-slate-500 tabular-nums sm:text-xs">
              <span>#{quest.quest_id}</span>
              {quest.chapter_name && quest.side === 0 && (
                <span className="text-accent-signal">{quest.chapter_name}</span>
              )}
              <span>{quest.total_lines} lines</span>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Quest actions">
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="btn btn-active whitespace-nowrap text-xs"
            >
              Export SQLite
            </button>
            <Link
              to={`/editor/${quest.quest_id}`}
              className="btn whitespace-nowrap text-xs hover:border-slate-400"
              title="Edit quest structure and settings"
            >
              Edit Flow
            </Link>
            {canEdit(role) && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="btn whitespace-nowrap border-rose-400/40 text-xs text-rose-300 hover:bg-rose-500/10"
                title="Delete Indonesian translation locally"
              >
                Delete ID
              </button>
            )}
            <Link
              to={`/translator/${quest.quest_id}`}
              className="btn whitespace-nowrap border-accent-signal/45 text-xs text-accent-signal hover:bg-accent-signal/5"
              title="Translate dialogue to Indonesian"
            >
              Translate
            </Link>
          </nav>
        </div>
      </header>

      <DialogueStream
        rows={rows}
        primary={primary}
        highlightQ={highlightQ}
        lineIndex={lineIndex}
        resetKey={qid}
        anchorLineId={anchorLineId}
      />
      <ExportDialog
        open={showExportModal}
        title="Export Quest to SQLite"
        isPending={exportMutation.isPending}
        onCancel={() => setShowExportModal(false)}
        onConfirm={(mode) => exportMutation.mutate(mode)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete Indonesian Translation?"
        message="This will permanently delete all Indonesian translation data (including edits, drafts, and cache) for this quest. This action cannot be undone."
        confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete"}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}
