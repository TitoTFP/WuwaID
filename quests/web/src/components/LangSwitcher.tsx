import { useSearchParams } from "react-router-dom";
import type { Lang } from "../lib/types";

const OPTS: { code: Lang; label: string }[] = [
  { code: "zh-Hans", label: "中文" },
  { code: "en", label: "EN" },
  { code: "ja", label: "JA" },
  { code: "id", label: "ID" },
];

export default function LangSwitcher() {
  const [params, setParams] = useSearchParams();
  const cur = (params.get("lang") ?? "en") as Lang;
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-white/10 bg-bg-1 p-0.5">
      {OPTS.map((o) => (
        <button
          key={o.code}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set("lang", o.code);
            setParams(next);
          }}
          className={`px-2 py-1 text-xs rounded transition ${
            cur === o.code
              ? "bg-accent-gold/20 text-accent-gold"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
