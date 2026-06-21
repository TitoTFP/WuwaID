import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { getAuthorLabel } from "../lib/session";
import type { CategoryEditorEntry } from "../lib/types";
import CategoryTranslatorForm from "../components/editor/CategoryTranslatorForm";
import Skeleton from "../components/editor/Skeleton";
import { useGlobalHotkeys } from "../lib/keyboard";
import { useToast } from "../components/Toast";
import { useUnsavedGuard } from "../lib/useUnsavedGuard";

export default function CategoryTranslatorPage() {
  const { categoryName = "" } = useParams();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [expandedPrefixes, setExpandedPrefixes] = useState<Set<string>>(new Set());
  const [previewEntries, setPreviewEntries] = useState<CategoryEditorEntry[]>([]);

  const queryClient = useQueryClient();
  const meQ = useMe();
  const role = meQ.data?.role ?? "anon";
  const authorLabel = getAuthorLabel();
  const toast = useToast();

  const entriesQ = useQuery({
    queryKey: ["editor", "category", categoryName, "entries"],
    queryFn: () => api.editorCategoryEntries(categoryName),
    enabled: !!categoryName,
  });

  const draftsQ = useQuery({
    queryKey: ["drafts", role === "editor" ? "editor" : authorLabel],
    queryFn: () => api.listDrafts(role === "editor" ? null : authorLabel),
    enabled: !!meQ.data,
  });

  const submitQ = useMutation({
    mutationFn: (params: { patch: { text_id: string }; note: string }) =>
      api.createCategoryDraft(
        { category: categoryName, key: selectedKey!, patch: params.patch, note: params.note || undefined },
        authorLabel,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drafts"] });
      queryClient.invalidateQueries({ queryKey: ["editor", "category", categoryName, "entries"] });
      toast.success("Draft saved");
    },
    onError: () => toast.error("Failed to save draft"),
  });

  useEffect(() => {
    if (entriesQ.data) {
      setPreviewEntries(entriesQ.data);
      // Auto-expand all prefixes by default on first load
      const prefixes = new Set(entriesQ.data.map(e => e.prefix || "NoPrefix"));
      setExpandedPrefixes(prefixes);
    }
  }, [entriesQ.data]);

  useEffect(() => {
    setSelectedKey(null);
    setSearchQ("");
  }, [categoryName]);

  const entries = entriesQ.data ?? [];
  const previewEntryMap = useMemo(() => {
    const m = new Map<string, CategoryEditorEntry>();
    for (const e of previewEntries) m.set(e.key, e);
    return m;
  }, [previewEntries]);

  const selectedEntry = selectedKey !== null ? (previewEntryMap.get(selectedKey) ?? null) : null;
  const originalSelectedEntry = selectedKey !== null ? (entries.find(e => e.key === selectedKey) ?? null) : null;

  const pendingCountsByKey = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const draft of draftsQ.data ?? []) {
      if (draft.category !== categoryName || draft.status !== "pending" || !draft.key) continue;
      acc[draft.key] = (acc[draft.key] ?? 0) + 1;
    }
    return acc;
  }, [draftsQ.data, categoryName]);

  const flatFilteredKeys = useMemo(() => {
    const search = searchQ.trim().toLowerCase();
    return entries
      .filter(e => {
        if (!search) return true;
        return [
          e.key,
          e.en,
          e["zh-Hans"],
          e.ja,
          e.id,
        ].some(val => String(val ?? "").toLowerCase().includes(search));
      })
      .map(e => e.key);
  }, [entries, searchQ]);

  const groupedEntries = useMemo(() => {
    const groups: Record<string, CategoryEditorEntry[]> = {};
    const search = searchQ.trim().toLowerCase();
    
    const filtered = entries.filter(e => {
      if (!search) return true;
      return [
        e.key,
        e.en,
        e["zh-Hans"],
        e.ja,
        e.id,
      ].some(val => String(val ?? "").toLowerCase().includes(search));
    });

    for (const e of filtered) {
      const p = e.prefix || "NoPrefix";
      if (!groups[p]) groups[p] = [];
      groups[p].push(e);
    }
    return groups;
  }, [entries, searchQ]);

  // Indonesian Translation Stats
  const stats = useMemo(() => {
    const total = entries.length;
    if (total === 0) return { count: 0, percentage: 100, total: 0 };
    const count = entries.filter(e => e.id && e.id.trim() !== "").length;
    const percentage = Math.round((count / total) * 100);
    return { count, percentage, total };
  }, [entries]);

  const selectRelative = useCallback(
    (direction: 1 | -1) => {
      if (flatFilteredKeys.length === 0) return;
      if (selectedKey === null) {
        setSelectedKey(flatFilteredKeys[0]);
        return;
      }
      const idx = flatFilteredKeys.indexOf(selectedKey);
      if (idx === -1) return;
      const next = flatFilteredKeys[idx + direction];
      if (next !== undefined) {
        setSelectedKey(next);
        
        // Auto-expand prefix of next selected item
        const nextEntry = previewEntryMap.get(next);
        if (nextEntry) {
          const p = nextEntry.prefix || "NoPrefix";
          setExpandedPrefixes(current => {
            if (current.has(p)) return current;
            const nextSet = new Set(current);
            nextSet.add(p);
            return nextSet;
          });
        }
      }
    },
    [selectedKey, flatFilteredKeys, previewEntryMap],
  );

  const previewEntryEdit = (edited: CategoryEditorEntry) => {
    setPreviewEntries((current) => current.map((item) => (item.key === edited.key ? edited : item)));
  };

  const togglePrefix = (prefix: string) => {
    setExpandedPrefixes((current) => {
      const next = new Set(current);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  };

  const expandAll = () => {
    const prefixes = new Set(entries.map(e => e.prefix || "NoPrefix"));
    setExpandedPrefixes(prefixes);
  };

  const collapseAll = () => {
    setExpandedPrefixes(new Set());
  };

  const dirty = submitQ.isPending;
  useUnsavedGuard(dirty);

  useGlobalHotkeys([
    { key: "j", handler: () => selectRelative(1) },
    { key: "k", handler: () => selectRelative(-1) },
    { key: "Escape", handler: () => { if (searchQ) setSearchQ(""); } },
  ]);

  return (
    <div className="container-wide flex-1 flex flex-col overflow-hidden">
      <div className="mb-3 space-y-2">
        <div className="flex items-center justify-between">
          <Link
            to={`/categories/${categoryName}`}
            className="link text-xs"
          >
            ← back to category table
          </Link>
          <div className="flex gap-2">
            <div className="btn text-xs btn-active border-accent-gold/45 text-accent-gold">
              Category Translation Mode
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-serif text-2xl text-slate-100">
            Category Translator Workspace · {categoryName}
          </h1>
        </div>

        {/* Translation Progress bar */}
        {!entriesQ.isLoading && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-bg-2/30 border border-white/5 rounded-md px-3 py-2 text-xs">
            <div className="font-semibold text-slate-300 shrink-0">Indonesian Translation Progress:</div>
            <div className="relative flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-gold to-yellow-500 transition-all duration-500 rounded-full"
                style={{ width: `${stats.percentage}%` }}
              />
            </div>
            <div className="font-mono text-slate-400 shrink-0 select-none">
              <span className="text-accent-gold font-bold">{stats.percentage}%</span> ({stats.count} / {stats.total} entries translated)
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0 gap-4">
        {/* Category key list sidebar */}
        <div className="flex w-[22rem] max-w-full shrink-0 relative">
          <aside className="card flex-1 flex flex-col overflow-hidden p-2 bg-bg-2/20">
            {entriesQ.isLoading && (
              <div className="p-2">
                <Skeleton lines={6} />
              </div>
            )}
            
            {!entriesQ.isLoading && (
              <div className="flex h-full flex-col gap-2">
                {/* Search */}
                <div className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500">
                    ⌕
                  </span>
                  <input
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    className="input h-9 pl-7 pr-10 text-xs"
                    placeholder="Filter keys or text..."
                    type="search"
                  />
                  {searchQ && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100"
                      onClick={() => setSearchQ("")}
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Toolbar */}
                <div className="flex items-center justify-between text-[11px] text-slate-500 border-b border-white/5 pb-2 px-1">
                  <div>
                    {flatFilteredKeys.length} match{flatFilteredKeys.length !== 1 ? "es" : ""}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="hover:text-slate-300" onClick={expandAll}>
                      expand all
                    </button>
                    <span className="text-slate-700">|</span>
                    <button type="button" className="hover:text-slate-300" onClick={collapseAll}>
                      collapse all
                    </button>
                  </div>
                </div>

                {/* Accordion Tree */}
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 select-none font-sans text-xs">
                  {Object.entries(groupedEntries).map(([prefix, group]) => {
                    const isOpen = expandedPrefixes.has(prefix);
                    return (
                      <div key={prefix} className="border border-white/5 rounded-md overflow-hidden bg-bg-2/30">
                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-3 py-2 bg-bg-2/60 hover:bg-bg-2 text-left font-semibold text-slate-300 transition"
                          onClick={() => togglePrefix(prefix)}
                        >
                          <span className="truncate">{prefix}</span>
                          <span className="text-[10px] text-slate-500 font-mono shrink-0 ml-2">
                            ({group.length}) {isOpen ? "▼" : "▶"}
                          </span>
                        </button>
                        
                        {isOpen && (
                          <div className="p-1 space-y-0.5 bg-bg-1/40 max-h-[300px] overflow-y-auto">
                            {group.map((item) => {
                              const isSelected = selectedKey === item.key;
                              const isTranslated = !!(item.id && item.id.trim() !== "");
                              const pendingDrafts = pendingCountsByKey[item.key] ?? 0;
                              return (
                                <button
                                  key={item.key}
                                  type="button"
                                  className={[
                                    "w-full flex items-center justify-between text-left p-2 rounded transition border text-xs font-mono",
                                    isSelected
                                      ? "bg-accent-gold/15 text-accent-gold border-accent-gold/30 font-semibold"
                                      : "bg-transparent text-slate-400 border-transparent hover:bg-white/5 hover:text-slate-200",
                                  ].join(" ")}
                                  onClick={() => setSelectedKey(item.key)}
                                >
                                  <span className="truncate flex-1 mr-2">{item.key}</span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {item.is_edited && (
                                      <span
                                        className="w-1.5 h-1.5 rounded-full bg-accent-teal"
                                        title="Approved editor edits"
                                      />
                                    )}
                                    {pendingDrafts > 0 && (
                                      <span
                                        className="w-1.5 h-1.5 rounded-full bg-accent-gold"
                                        title="Pending draft review"
                                      />
                                    )}
                                    {isTranslated && (
                                      <span className="text-[10px] text-emerald-400 font-bold" title="Translated">
                                        ✓
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {Object.keys(groupedEntries).length === 0 && (
                    <div className="text-center text-slate-500 py-6">
                      No matching keys found.
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* Translation Workbench panel */}
        <section className="card flex-1 flex flex-col p-4 min-h-0 overflow-y-auto">
          {selectedKey === null ? (
            <div className="flex h-full flex-col items-center justify-center text-sm text-slate-500">
              <p>Select a key on the left to start translating.</p>
              <p className="mt-1 text-[11px] text-slate-600">
                Press <kbd className="rounded border border-white/10 bg-bg-2 px-1 text-[10px] text-slate-300">j</kbd> / <kbd className="rounded border border-white/10 bg-bg-2 px-1 text-[10px] text-slate-300">k</kbd> to move up/down.
              </p>
            </div>
          ) : entriesQ.isLoading ? (
            <Skeleton variant="form" />
          ) : selectedEntry ? (
            <div className="flex h-full flex-col gap-3">
              <CategoryTranslatorForm
                entry={selectedEntry}
                originalEntry={originalSelectedEntry ?? selectedEntry}
                category={categoryName}
                busy={submitQ.isPending}
                onPreview={previewEntryEdit}
                onSubmit={(patch, note) => submitQ.mutate({ patch, note })}
                onSelectNext={selectRelative}
              />
            </div>
          ) : (
            <div className="text-sm text-slate-500">
              Key &quot;{selectedKey}&quot; was not found in this category.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
