export type DiffOp = "equal" | "added" | "removed";

export interface DiffSpan {
  op: DiffOp;
  value: string;
}

function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

export function diffWords(before: string, after: string): DiffSpan[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const m = a.length;
  const n = b.length;

  if (m === 0 && n === 0) return [];
  if (m === 0) return [{ op: "added", value: after }];
  if (n === 0) return [{ op: "removed", value: before }];

  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const spans: DiffSpan[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      pushSpan(spans, "equal", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      pushSpan(spans, "removed", a[i]);
      i++;
    } else {
      pushSpan(spans, "added", b[j]);
      j++;
    }
  }
  while (i < m) {
    pushSpan(spans, "removed", a[i]);
    i++;
  }
  while (j < n) {
    pushSpan(spans, "added", b[j]);
    j++;
  }
  return spans;
}

function pushSpan(spans: DiffSpan[], op: DiffOp, value: string) {
  const last = spans[spans.length - 1];
  if (last && last.op === op) last.value += value;
  else spans.push({ op, value });
}
