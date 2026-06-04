import { useEffect, useRef } from "react";

export type HotkeyOptions = {
  mod?: boolean;
  shift?: boolean;
  allowInInputs?: boolean;
  enabled?: boolean;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function matchesKey(event: KeyboardEvent, key: string, options: HotkeyOptions): boolean {
  if (event.key.toLowerCase() !== key.toLowerCase()) return false;
  if (!!options.mod !== (event.metaKey || event.ctrlKey)) return false;
  if (!!options.shift !== event.shiftKey) return false;
  return true;
}

export function useHotkey(
  key: string,
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {},
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (options.enabled === false) return;
    function onKeyDown(event: KeyboardEvent) {
      const opts = optsRef.current;
      if (!matchesKey(event, key, opts)) return;
      if (!opts.allowInInputs && isEditableTarget(event.target)) return;
      event.preventDefault();
      handlerRef.current(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, options.enabled]);
}

export function useGlobalHotkeys(
  bindings: Array<{
    key: string;
    handler: (event: KeyboardEvent) => void;
    options?: HotkeyOptions;
  }>,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      for (const binding of bindings) {
        const opts = binding.options ?? {};
        if (!matchesKey(event, binding.key, opts)) continue;
        if (!opts.allowInInputs && isEditableTarget(event.target)) continue;
        event.preventDefault();
        binding.handler(event);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bindings, enabled]);
}
