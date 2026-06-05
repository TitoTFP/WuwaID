export type ReviewMarks = Record<string, true>;

function keyFor(storageKey: string): string {
  return `wuwaid-quest-review:${storageKey}`;
}

export function loadReviewMarks(storageKey: string): ReviewMarks {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(keyFor(storageKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ReviewMarks = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveReviewMarks(storageKey: string, marks: ReviewMarks): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(keyFor(storageKey), JSON.stringify(marks));
  } catch {
    // ignore (private mode / quota)
  }
}
