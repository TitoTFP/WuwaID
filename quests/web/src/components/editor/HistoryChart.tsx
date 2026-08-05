import { useMemo } from "react";
import type { AdminLogHistoryResponse } from "../lib/types";

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 36 };
const EVENT_COLORS = [
  "var(--sentinel-signal)",
  "var(--sentinel-ink-2)",
  "var(--sentinel-ink-3)",
  "var(--sentinel-success)",
  "var(--sentinel-warning)",
  "var(--sentinel-error)",
];

function buildPath(values: number[], width: number, height: number, max: number): string {
  const n = values.length;
  if (n === 0) return "";
  const step = n > 1 ? width / (n - 1) : 0;
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
    .join(" ");
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function HistoryChart({ data }: { data: AdminLogHistoryResponse }) {
  const { points } = data;
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const max = useMemo(() => Math.max(1, ...points.map((p) => p.total)), [points]);
  const totalPath = useMemo(() => buildPath(points.map((p) => p.total), innerW, innerH, max), [points, innerW, innerH, max]);
  const eventPaths = useMemo(
    () =>
      data.event_keys.map((key) => ({
        key,
        path: buildPath(points.map((p) => p.events[key] ?? 0), innerW, innerH, max),
      })),
    [data.event_keys, points, innerW, innerH, max],
  );

  if (points.length === 0) {
    return <p className="p-4 text-sm text-slate-500">No history data for this range.</p>;
  }

  const gridLines = [0.25, 0.5, 0.75, 1];

  return (
    <div>
      <svg
        role="img"
        aria-label={`Active players over time (max ${max})`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        style={{ maxHeight: 320 }}
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {gridLines.map((g) => (
            <g key={g}>
              <line x1={0} y1={innerH * (1 - g)} x2={innerW} y2={innerH * (1 - g)} stroke="var(--sentinel-rule)" strokeWidth={0.5} />
              <text x={-8} y={innerH * (1 - g) + 3} textAnchor="end" fontSize={9} fill="var(--sentinel-ink-3)" fontFamily="var(--font-mono)">
                {Math.round(max * g)}
              </text>
            </g>
          ))}
          {eventPaths.map(({ key, path }) => (
            <path key={key} d={path} fill="none" stroke="var(--sentinel-ink-3)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
          ))}
          <path d={totalPath} fill="none" stroke="var(--sentinel-signal)" strokeWidth={1.5} />
        </g>
      </svg>
      <div className="flex flex-wrap gap-3 pt-1 font-mono text-[10px] text-slate-400">
        <span><span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: "var(--sentinel-signal)" }} />Total</span>
        {eventPaths.map(({ key }) => (
          <span key={key}><span className="mr-1 inline-block h-0.5 w-3 align-middle border-t border-dashed" style={{ borderColor: "var(--sentinel-ink-3)" }} />{key}</span>
        ))}
      </div>
      <p className="pt-1 font-mono text-[10px] text-slate-500">
        {points.length} points · {fmtTime(points[0].timestamp)} – {fmtTime(points[points.length - 1].timestamp)} · max {max}
      </p>
    </div>
  );
}
