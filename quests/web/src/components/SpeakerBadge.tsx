// Deterministic per-speaker hue from a string
function hue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export default function SpeakerBadge({ name, size = "sm" }: { name: string; size?: "sm" | "xs" }) {
  if (!name) {
    return (
      <span className={`inline-block rounded ${size === "xs" ? "h-2 w-12" : "h-3 w-20"} bg-white/5`} />
    );
  }
  const h = hue(name);
  const bg = `hsl(${h} 35% 22%)`;
  const fg = `hsl(${h} 65% 75%)`;
  return (
    <span
      className={`inline-block max-w-full truncate rounded px-2 py-0.5 font-medium ${
        size === "xs" ? "text-[10px]" : "text-xs"
      }`}
      style={{ backgroundColor: bg, color: fg }}
      title={name}
    >
      {name}
    </span>
  );
}
