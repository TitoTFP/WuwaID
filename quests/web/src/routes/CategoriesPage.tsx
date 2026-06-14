import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "../components/Toast";
import { CategoryTable, CategoryEntry } from "../components/CategoryTable";
import { api } from "../lib/api";
import type { CategorySummary } from "../lib/types";
import ExportDialog from "../components/editor/ExportDialog";

export function CategoriesPage() {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<CategoryEntry[]>([]);
  const [showIdColumn, setShowIdColumn] = useState(false);
  const [loading, setLoading] = useState(true);

  const toast = useToast();
  const [showExportModal, setShowExportModal] = useState(false);

  const exportMutation = useMutation({
    mutationKey: ["export-category", selected],
    mutationFn: (onlyUntranslated: boolean) => {
      if (!selected) return Promise.resolve({ ok: false, files: [] });
      return api.exportTranslations({ category_names: [selected], only_untranslated: onlyUntranslated });
    },
    onSuccess: (res) => {
      setShowExportModal(false);
      const file = res.files?.[0];
      if (file) {
        toast.success(`Category successfully exported to output_db/id/${file}!`);
      } else {
        toast.success("Category successfully exported to output_db/id!");
      }
    },
    onError: (err: any) => {
      toast.error(`Export failed: ${err.message || err}`);
    }
  });

  // Set page title and load categories list on mount
  useEffect(() => {
    document.title = "Grouped Texts - wuwaid-quests";
    api.categories()
      .then((data) => {
        setCategories(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Update title when selected category changes
  useEffect(() => {
    if (!selected) {
      document.title = "Grouped Texts - wuwaid-quests";
      setEntries([]);
      return;
    }
    
    document.title = `${selected} - Grouped Texts - wuwaid-quests`;

    api.categorySingle(selected)
      .then((data) => {
        const list: CategoryEntry[] = (data.entries || []).map(
          (e) => ({
            key: e.key,
            prefix: e.key.split("_", 1)[0],
            "zh-Hans": e["zh-Hans"] ?? "",
            en: e.en ?? "",
            ja: e.ja ?? "",
            id: e.id ?? null,
          }),
        );
        setEntries(list);
        setShowIdColumn(list.some((e) => e.id !== null));
      })
      .catch((err) => {
        console.error("Error loading category entries:", err);
      });
  }, [selected]);

  if (loading) {
    return (
      <div className="container-narrow py-10 text-center">
        <div className="text-sm text-slate-500">Loading categories…</div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="container-narrow space-y-6">
        <div>
          <h1 className="font-serif text-2xl text-accent-gold" id="categories-heading">
            Grouped Texts
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Browse static texts grouped by type and domain
          </p>
        </div>

        <div 
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-labelledby="categories-heading"
        >
          {categories.map((c) => {
            const pct =
              c.key_count > 0 ? (c.translated_count / c.key_count) * 100 : 0;
            const isFullyTranslated = pct >= 100;
            return (
              <button
                key={c.name}
                id={`category-btn-${c.name.toLowerCase()}`}
                onClick={() => setSelected(c.name)}
                className="card p-4 text-left transition duration-200 hover:bg-bg-2 hover:border-accent-gold/40 hover:scale-[1.01] focus:ring-1 focus:ring-accent-gold/40 group"
              >
                <div className="font-serif text-lg text-slate-100 group-hover:text-accent-gold transition-colors">
                  {c.name}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {c.translated_count} / {c.key_count} translated ({pct.toFixed(0)}%)
                </div>
                <div className="mt-3 h-1 w-full rounded bg-white/5 overflow-hidden">
                  <div
                    className={`h-1 rounded transition-all duration-500 ${
                      isFullyTranslated ? "bg-accent-teal" : "bg-accent-gold"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="container-narrow space-y-4">
      <div className="flex items-center justify-between">
        <button
          id="back-to-categories-btn"
          onClick={() => setSelected(null)}
          className="btn inline-flex items-center gap-1.5"
        >
          <span aria-hidden="true">&larr;</span> Back to categories
        </button>
        <button
          type="button"
          onClick={() => setShowExportModal(true)}
          className="btn text-xs btn-active"
        >
          Export Category to SQLite
        </button>
      </div>
      
      <CategoryTable
        category={selected}
        entries={entries}
        showIdColumn={showIdColumn}
      />
      <ExportDialog
        open={showExportModal}
        title="Export Category to SQLite"
        isPending={exportMutation.isPending}
        onCancel={() => setShowExportModal(false)}
        onConfirm={(onlyUntranslated) => exportMutation.mutate(onlyUntranslated)}
      />
    </div>
  );
}

export default CategoriesPage;
