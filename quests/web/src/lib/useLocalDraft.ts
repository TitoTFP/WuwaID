import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "editor:draft:";

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

function writeLocal(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota or disabled — ignore
  }
}

function clearLocal(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function useLocalDraft<T>(qid: number, lineId: number, debounceMs: number = 250) {
  const storageKey = keyFor(qid, lineId);
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

export function hasLocalDraft(qid: number, lineId: number): boolean {
  return readLocal(keyFor(qid, lineId)) !== null;
}
