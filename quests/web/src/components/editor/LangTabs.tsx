import type { Lang } from "../../lib/types";

type Tab = Lang | "META";

const TABS: { value: Tab; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "zh-Hans", label: "ZH-HANS" },
  { value: "ja", label: "JA" },
  { value: "id", label: "ID" },
  { value: "META", label: "META" },
];

export default function LangTabs({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <div className="flex gap-3 border-b border-white/10 text-xs font-semibold tracking-wide text-slate-400">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={[
            "border-b-2 px-1 pb-2 transition-colors",
            active === tab.value
              ? "border-accent-gold text-accent-gold"
              : "border-transparent hover:text-slate-200",
          ].join(" ")}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
