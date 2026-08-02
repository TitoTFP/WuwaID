import { useSearchParams } from "react-router-dom";
import type { Lang } from "../lib/types";

const OPTS: { code: Lang; label: string; name: string }[] = [
  { code: "zh-Hans", label: "中文", name: "Chinese (Simplified)" },
  { code: "en", label: "EN", name: "English" },
  { code: "ja", label: "JA", name: "Japanese" },
  { code: "id", label: "ID", name: "Indonesian" },
];

export default function LangSwitcher() {
  const [params, setParams] = useSearchParams();
  const cur = (params.get("lang") ?? "en") as Lang;
  return (
    <div className="lang-switcher" role="group" aria-label="Content language">
      {OPTS.map((o) => (
        <button
          type="button"
          key={o.code}
          aria-label={o.name}
          aria-pressed={cur === o.code}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set("lang", o.code);
            setParams(next);
          }}
          className={`lang-switcher__option ${cur === o.code ? "is-active" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
