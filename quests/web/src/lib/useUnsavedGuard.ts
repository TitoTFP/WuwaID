import { useEffect, useRef } from "react";

export function useUnsavedGuard(dirty: boolean, message: string = "You have unsaved changes. Leave anyway?") {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = message;
      return message;
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [message]);
}

export function confirmIfDirty(dirty: boolean, message: string = "You have unsaved changes. Leave anyway?"): boolean {
  if (!dirty) return true;
  return window.confirm(message);
}
