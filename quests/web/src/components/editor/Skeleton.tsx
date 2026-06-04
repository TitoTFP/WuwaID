export default function Skeleton({
  lines = 4,
  variant = "tree",
}: {
  lines?: number;
  variant?: "tree" | "form";
}) {
  if (variant === "form") {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton h-4 w-24" />
        <div className="skeleton h-9 w-full" />
        <div className="skeleton h-28 w-full" />
        <div className="skeleton h-9 w-full" />
        <div className="skeleton h-28 w-full" />
      </div>
    );
  }
  return (
    <div className="space-y-1.5" aria-busy="true" aria-live="polite">
      <div className="skeleton h-8 w-full" />
      {Array.from({ length: lines }).map((_, idx) => (
        <div
          key={idx}
          className="skeleton h-9 w-full"
          style={{ marginLeft: ((idx % 3) + 1) * 12 }}
        />
      ))}
    </div>
  );
}
