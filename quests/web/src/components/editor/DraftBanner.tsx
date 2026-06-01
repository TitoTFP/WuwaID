import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useMe } from "../../lib/auth";
import { getAuthorLabel } from "../../lib/session";

export default function DraftBanner({ qid }: { qid: number }) {
  useMe();
  getAuthorLabel();
  const draftsQ = useQuery({
    queryKey: ["drafts"],
    queryFn: () => api.listDrafts(),
  });
  const count = (draftsQ.data ?? []).filter(
    (draft) => draft.qid === qid && draft.status === "pending",
  ).length;

  if (count === 0) return null;

  return (
    <div className="card mt-3 flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
      <span className="text-slate-300">
        {count} pending {count === 1 ? "draft" : "drafts"} for this quest
      </span>
      <Link to="/drafts" className="link text-xs">
        Review drafts
      </Link>
    </div>
  );
}
