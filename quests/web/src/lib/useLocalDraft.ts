import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "editor:draft:";
export const LOCAL_DRAFT_EVENT = "editor-local-draft-change";
export type LocalDraftStatus = "idle" | "saving" | "saved" | "error";

function keyFor(qid: number, lineId: number): string {
  return `${PREFIX}${qid}:${lineId}`;
}

function readLocal<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function clearLocal(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function announce(qid: number, lineId: number, hasDraft: boolean) {
  window.dispatchEvent(new CustomEvent(LOCAL_DRAFT_EVENT, { detail: { qid, lineId, hasDraft } }));
}

export function useLocalDraft<T>(qid: number, lineId: number, debounceMs: number = 250) {
  const storageKey = keyFor(qid, lineId);
  const [restoredState, setRestoredState] = useState<{ key: string; value: T | null }>(() => ({
    key: storageKey,
    value: readLocal<T>(storageKey),
  }));
  const [status, setStatus] = useState<LocalDraftStatus>("idle");
  const timerRef = useRef<number | null>(null);
  const lastValueRef = useRef<T | null>(null);
  const storageKeyRef = useRef(storageKey);

  const persist = useCallback((updateStatus: boolean) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (lastValueRef.current !== null) {
      const ok = writeLocal(storageKeyRef.current, lastValueRef.current);
      if (updateStatus) setStatus(ok ? "saved" : "error");
      if (ok) announce(qid, lineId, true);
    }
  }, [lineId, qid]);

  const flush = useCallback(() => persist(true), [persist]);

  useEffect(() => {
    storageKeyRef.current = storageKey;
    lastValueRef.current = null;
    setRestoredState({ key: storageKey, value: readLocal<T>(storageKey) });
    setStatus("idle");
  }, [persist, storageKey]);

  const save = useCallback(
    (value: T) => {
      lastValueRef.current = value;
      setStatus("saving");
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        const ok = writeLocal(storageKeyRef.current, value);
        setStatus(ok ? "saved" : "error");
        if (ok) announce(qid, lineId, true);
        timerRef.current = null;
      }, debounceMs);
    },
    [debounceMs, lineId, qid],
  );

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastValueRef.current = null;
    const ok = clearLocal(storageKeyRef.current);
    setRestoredState({ key: storageKeyRef.current, value: null });
    setStatus(ok ? "idle" : "error");
    if (ok) announce(qid, lineId, false);
  }, [lineId, qid]);

  useEffect(() => {
    return () => {
      persist(false);
    };
  }, [persist]);

  const restored = restoredState.key === storageKey ? restoredState.value : readLocal<T>(storageKey);
  return { restored, save, clear, flush, status };
}

export function listLocalDraftLineIds(qid: number): Set<number> {
  const ids = new Set<number>();
  if (typeof window === "undefined") return ids;
  const prefix = `${PREFIX}${qid}:`;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const id = Number(key.slice(prefix.length));
      if (Number.isInteger(id)) ids.add(id);
    }
  } catch {
    // Storage disabled.
  }
  return ids;
}

function categoryKeyFor(category: string, key: string): string {
  return `${PREFIX}cat:${category}:${key}`;
}

export function useCategoryLocalDraft<T>(category: string, keyName: string, debounceMs: number = 250) {
  const storageKey = categoryKeyFor(category, keyName);
  const [restored, setRestored] = useState<T | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastValueRef = useRef<T | null>(null);
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;

  useEffect(() => {
    setRestored(readLocal<T>(storageKey));
  }, [storageKey]);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (lastValueRef.current !== null) {
      writeLocal(storageKeyRef.current, lastValueRef.current);
    }
  }, []);

  const save = useCallback(
    (value: T) => {
      lastValueRef.current = value;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        writeLocal(storageKeyRef.current, value);
        timerRef.current = null;
      }, debounceMs);
    },
    [debounceMs],
  );

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastValueRef.current = null;
    clearLocal(storageKeyRef.current);
    setRestored(null);
  }, []);

  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  useEffect(() => {
    return () => {
      flush();
    };
  }, [storageKey, flush]);

  return { restored, save, clear, flush };
}
