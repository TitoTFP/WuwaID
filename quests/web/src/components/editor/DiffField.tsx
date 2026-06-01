export default function DiffField({
  label,
  value,
  original,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  original?: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const hasOriginal = original !== undefined && original !== "";
  const changed = value !== (original ?? "");
  const pill = changed ? "edited" : hasOriginal ? "unchanged" : null;

  return (
    <label className="block space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
        <span>{label}</span>
        {pill && (
          <span
            className={[
              "rounded px-1.5 py-0.5 text-[10px]",
              changed
                ? "bg-accent-gold/20 text-accent-gold"
                : "bg-white/5 text-slate-500",
            ].join(" ")}
          >
            {pill}
          </span>
        )}
      </div>
      {multiline ? (
        <textarea
          className="input min-h-28 resize-y"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hasOriginal && (
        <div className="text-[11px] text-slate-500">orig: {original}</div>
      )}
    </label>
  );
}
