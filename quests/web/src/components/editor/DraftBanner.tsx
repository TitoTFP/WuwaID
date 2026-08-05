import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { canEdit, useMe } from "../../lib/auth";
import { getAuthorLabel } from "../../lib/session";

export default function DraftBanner({ qid }: { qid: number }) {
  const meQ = useMe();
  const role = meQ.data?.role ?? "anon";
  const authorLabel = getAuthorLabel();
  const draftsQ = useQuery({
    queryKey: ["drafts", canEdit(role) ? "editor" : authorLabel, qid],
    queryFn: () => api.listDrafts(canEdit(role) ? null : authorLabel),
    enabled: !!meQ.data,
  });
  const count = (draftsQ.data ?? []).filter(
    (draft) => draft.qid === qid && draft.status === "pending",
  ).length;

  if (count === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-y border-accent-signal/25 bg-accent-signal/5 px-3 py-2 text-sm">
      <span className="text-slate-300">
        {count} pending {count === 1 ? "draft" : "drafts"} for this quest
      </span>
      <Link to="/drafts" className="link inline-flex min-h-11 items-center whitespace-nowrap text-xs">
        Review drafts
      </Link>
    </div>
  );
}
