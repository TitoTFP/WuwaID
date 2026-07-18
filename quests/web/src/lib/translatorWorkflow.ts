import type { CategoryEditorEntry, DialogueLine, Draft, DraftPatch, GlossaryMatch, TranslationFinding } from "./types";

export function parseDraftPatch(draft: Draft | null | undefined): DraftPatch {
  if (!draft) return {};
  if (draft.patch) return draft.patch;
  try {
    const parsed = JSON.parse(draft.patch_json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as DraftPatch : {};
  } catch {
    return {};
  }
}

export function applyDraftPatch(line: DialogueLine, patch: DraftPatch): DialogueLine {
  return {
    ...line,
    ...(patch.speaker_id !== undefined ? { speaker_id: patch.speaker_id } : {}),
    ...(patch.text_id !== undefined ? { text_id: patch.text_id } : {}),
    ...(patch.options !== undefined ? { options: patch.options } : {}),
  };
}

export function localDraftForLine<T extends { draft: DialogueLine }>(value: T | null, lineId: number): T | null {
  return value?.draft.id === lineId ? value : null;
}

export function filterCategoryEntries(entries: CategoryEditorEntry[], query: string, untranslatedOnly: boolean): CategoryEditorEntry[] {
  const search = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (untranslatedOnly && entry.id?.trim()) return false;
    if (!search) return true;
    return [entry.key, entry.en, entry["zh-Hans"], entry.ja, entry.id]
      .some((value) => String(value ?? "").toLowerCase().includes(search));
  });
}

export function lineNeedsTranslation(line: DialogueLine): boolean {
  return Boolean(line.text_en?.trim()) || Boolean(line.options?.some((option) => option.text_en?.trim()));
}

export function isTranslationComplete(line: DialogueLine): boolean {
  if (!lineNeedsTranslation(line)) return true;
  if (line.text_en?.trim() && !line.text_id?.trim()) return false;
  return (line.options ?? []).every((option) => !option.text_en?.trim() || Boolean(option.text_id?.trim()));
}

export function translationStats(lines: DialogueLine[]) {
  const actionable = lines.filter(lineNeedsTranslation);
  const count = actionable.filter(isTranslationComplete).length;
  const total = actionable.length;
  return { count, total, percentage: total === 0 ? 100 : Math.round((count / total) * 100) };
}

export function nextActionableLineId(
  orderedIds: number[],
  currentId: number,
  linesById: ReadonlyMap<number, DialogueLine>,
  pendingIds: ReadonlySet<number>,
): number | null {
  if (orderedIds.length === 0) return null;
  const currentIndex = orderedIds.indexOf(currentId);
  const start = currentIndex < 0 ? 0 : currentIndex + 1;
  for (let offset = 0; offset < orderedIds.length; offset += 1) {
    const id = orderedIds[(start + offset) % orderedIds.length];
    if (id === currentId || pendingIds.has(id)) continue;
    const line = linesById.get(id);
    if (line && lineNeedsTranslation(line) && !isTranslationComplete(line)) return id;
  }
  return null;
}

export function dialogueContext(
  orderedIds: number[],
  selectedId: number,
  linesById: ReadonlyMap<number, DialogueLine>,
): { previous: DialogueLine | null; next: DialogueLine | null } {
  const index = orderedIds.indexOf(selectedId);
  const current = linesById.get(selectedId);
  if (index < 0 || !current) return { previous: null, next: null };
  const previous = linesById.get(orderedIds[index - 1]) ?? null;
  const next = linesById.get(orderedIds[index + 1]) ?? null;
  return {
    previous: previous?.state_key === current.state_key ? previous : null,
    next: next?.state_key === current.state_key ? next : null,
  };
}

function multiset(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function sameMultiset(left: string[], right: string[]): boolean {
  const a = multiset(left);
  const b = multiset(right);
  return a.size === b.size && Array.from(a).every(([key, count]) => b.get(key) === count);
}

function markupFindings(source: string, target: string, field: string): TranslationFinding[] {
  const findings: TranslationFinding[] = [];
  const sourceTokens = source.match(/\{[^{}]+\}/g) ?? [];
  const targetTokens = target.match(/\{[^{}]+\}/g) ?? [];
  if (!sameMultiset(sourceTokens, targetTokens)) {
    findings.push({ code: "token-mismatch", field, message: "Source tokens must be preserved exactly." });
  }
  const sourceTags = source.match(/<\/?[A-Za-z][^>]*>/g) ?? [];
  const targetTags = target.match(/<\/?[A-Za-z][^>]*>/g) ?? [];
  if (!sameMultiset(sourceTags, targetTags)) {
    findings.push({ code: "tag-mismatch", field, message: "Source markup tags must be preserved exactly." });
  }
  return findings;
}

function textFindings(source: string, target: string, field: string): TranslationFinding[] {
  if (!source.trim()) return [];
  const findings = markupFindings(source, target, field);
  if (!target.trim()) {
    findings.push({ code: "missing-translation", field, message: "English source has no Indonesian translation." });
    return findings;
  }
  if (target !== target.trim()) {
    findings.push({ code: "outer-whitespace", field, message: "Translation has leading or trailing whitespace." });
  }
  if (target.trim() === source.trim()) {
    findings.push({ code: "same-as-source", field, message: "Translation is identical to English source." });
  }
  return findings;
}

export function translationFindings(
  source: DialogueLine,
  target: DialogueLine,
  glossary: GlossaryMatch[],
): TranslationFinding[] {
  const findings = textFindings(source.text_en ?? "", target.text_id ?? "", "text_id");
  const targetParts = [target.text_id ?? ""];
  for (let index = 0; index < (source.options ?? []).length; index += 1) {
    const sourceOption = source.options?.[index];
    const targetOption = target.options?.[index];
    const field = `options.${index}.text_id`;
    findings.push(...textFindings(sourceOption?.text_en ?? "", targetOption?.text_id ?? "", field));
    targetParts.push(targetOption?.text_id ?? "");
  }
  const targetText = targetParts.join(" ").toLocaleLowerCase();
  for (const match of glossary) {
    const expected = match.indonesian_translation.trim();
    if (expected && !targetText.includes(expected.toLocaleLowerCase())) {
      findings.push({
        code: "glossary-mismatch",
        field: "translation",
        message: `Use glossary term “${expected}” for “${match.term}”.`,
      });
    }
  }
  return findings;
}
