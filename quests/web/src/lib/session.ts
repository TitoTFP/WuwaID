const KEY = "wuwaid.author_label";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "u-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getAuthorLabel(): string {
  if (typeof window === "undefined") return "anon";
  let v = localStorage.getItem(KEY);
  if (!v) {
    v = uuid();
    localStorage.setItem(KEY, v);
  }
  return v;
}
