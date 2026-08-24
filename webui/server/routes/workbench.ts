import { Router, Request, Response } from "express";
import { db } from "../db.js";
import { TranslationDraft } from "../../src/types/index.js";
import {
  VERSION_LANGUAGES,
  VERSION_WORKING,
  createTextVersion,
  exportStructuredTextDiff,
  exportTextVersionCsv,
  exportTextVersionSqlite,
  getTextVersionDiff,
  getTextVersionGroups,
  listTextVersions,
  type TextDiffStatus,
  type VersionLanguage,
} from "../textVersions.js";

export const workbenchRouter = Router();

function requireVersionEditor(req: Request, res: Response): boolean {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const session = token ? db.sessions.get(token) : undefined;
  if (session && (session.role === "editor" || session.role === "admin"))
    return true;

  res
    .status(401)
    .json({ error: "Editor login is required for text version history." });
  return false;
}

function textVersionError(res: Response, error: unknown): void {
  const message =
    error instanceof Error ? error.message : "Text version request failed.";
  const clientError =
    /required|unknown|unsupported|different|reserved|immutable|empty|conflicting|unsafe|at least one|overlap/i.test(
      message,
    );
  res.status(clientError ? 400 : 500).json({ error: message });
}

function versionLanguage(value: unknown): VersionLanguage {
  const language = String(value || "en");
  if (!VERSION_LANGUAGES.includes(language as VersionLanguage)) {
    throw new Error(`unsupported language: ${language}`);
  }
  return language as VersionLanguage;
}

function queryText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// GET /api/workbench/drafts or /api/drafts - List translation drafts
workbenchRouter.get(
  ["/drafts", "/workbench/drafts"],
  (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    let drafts = db.drafts;

    if (status && status !== "all") {
      drafts = drafts.filter((d: TranslationDraft) => d.status === status);
    }

    res.json({ drafts });
  },
);

// GET /api/workbench/drafts/:id or /api/drafts/:id - Single draft detail
workbenchRouter.get(
  ["/drafts/:id", "/workbench/drafts/:id"],
  (req: Request, res: Response) => {
    const id = req.params.id;
    const draft = db.drafts.find((d: TranslationDraft) => d.id === id);

    if (!draft) {
      res.status(404).json({ error: `Draft '${id}' not found` });
      return;
    }

    res.json(draft);
  },
);

// POST /api/workbench/drafts or /api/editor/drafts - Submit new draft
workbenchRouter.post(
  ["/drafts", "/workbench/drafts", "/editor/drafts"],
  (req: Request, res: Response) => {
    const {
      questId,
      lineId,
      lineNo,
      speakerName,
      sourceText,
      previousText,
      proposedText,
    } = req.body;

    if (!proposedText) {
      res.status(400).json({ error: "Field 'proposedText' is required" });
      return;
    }

    const newDraft = db.createDraft({
      questId: questId || "quest_ch1_01",
      questTitle: "Jinzhou Rising",
      lineId: lineId || "line_103",
      lineNo: lineNo || 103,
      speakerName: speakerName || "Rover",
      sourceText: sourceText || "Where am I...?",
      previousText: previousText || "Di mana aku berada...?",
      proposedText,
      author: {
        name: "Active Editor",
        role: "Editor",
      },
    });

    res.status(201).json({ status: "created", draft: newDraft });
  },
);

// POST /api/workbench/drafts/:id/approve or /api/drafts/:id/approve - Approve draft
workbenchRouter.post(
  ["/drafts/:id/approve", "/workbench/drafts/:id/approve"],
  (req: Request, res: Response) => {
    const id = req.params.id;
    const draft = db.updateDraftStatus(id, "approved", "Reviewer Admin");

    if (!draft) {
      res.status(404).json({ error: `Draft '${id}' not found` });
      return;
    }

    res.json({ status: "approved", draft });
  },
);

// POST /api/workbench/drafts/:id/reject or /api/drafts/:id/reject - Reject draft
workbenchRouter.post(
  ["/drafts/:id/reject", "/workbench/drafts/:id/reject"],
  (req: Request, res: Response) => {
    const id = req.params.id;
    const { reason } = req.body;
    const draft = db.updateDraftStatus(
      id,
      "rejected",
      "Reviewer Admin",
      reason,
    );

    if (!draft) {
      res.status(404).json({ error: `Draft '${id}' not found` });
      return;
    }

    res.json({ status: "rejected", draft });
  },
);

// POST /api/workbench/drafts/batch-approve or /api/drafts/batch-approve
workbenchRouter.post(
  ["/drafts/batch-approve", "/workbench/drafts/batch-approve"],
  (_req: Request, res: Response) => {
    let count = 0;
    for (const draft of db.drafts) {
      if (draft.status === "pending") {
        draft.status = "approved";
        count++;
      }
    }
    db.saveDrafts();
    res.json({ status: "success", approvedCount: count });
  },
);

// POST /api/workbench/drafts/apply or /api/drafts/apply
workbenchRouter.post(
  ["/drafts/apply", "/workbench/drafts/apply"],
  (_req: Request, res: Response) => {
    const result = db.applyApprovedDrafts();
    res.json(result);
  },
);

// POST /api/workbench/glossary/matches or /api/editor/glossary/matches
workbenchRouter.post(
  [
    "/glossary/matches",
    "/workbench/glossary/matches",
    "/editor/glossary/matches",
  ],
  (req: Request, res: Response) => {
    const text = (req.body.text || "").toLowerCase();
    const matches: Array<{ term: string; translation: string }> = [];

    for (const item of Object.values(db.glossary)) {
      if (text.includes(item.term.toLowerCase())) {
        matches.push({ term: item.term, translation: item.translation });
      }
    }

    res.json({ matches });
  },
);

// GET /api/workbench/versions or /api/editor/versions - Immutable official-text tags
workbenchRouter.get(
  ["/versions", "/workbench/versions", "/editor/versions"],
  (req: Request, res: Response) => {
    if (!requireVersionEditor(req, res)) return;
    try {
      res.json({ versions: listTextVersions() });
    } catch (error) {
      textVersionError(res, error);
    }
  },
);

// POST /api/workbench/versions or /api/editor/versions - Create immutable working-tree tag
workbenchRouter.post(
  ["/versions", "/workbench/versions", "/editor/versions"],
  (req: Request, res: Response) => {
    if (!requireVersionEditor(req, res)) return;
    try {
      const tag = queryText(req.body?.tag);
      const note =
        req.body?.note === undefined || req.body?.note === null
          ? null
          : queryText(req.body.note);
      res.status(201).json({ version: createTextVersion(tag, note) });
    } catch (error) {
      textVersionError(res, error);
    }
  },
);

// GET /api/workbench/versions/diff - Row-level official-text diff
workbenchRouter.get(
  ["/versions/diff", "/workbench/versions/diff", "/editor/versions/diff"],
  (req: Request, res: Response) => {
    if (!requireVersionEditor(req, res)) return;
    try {
      const base = queryText(req.query.base);
      const target = queryText(req.query.target);
      if (!base || !target) throw new Error("base and target are required");
      const status = queryText(req.query.status) as TextDiffStatus | "";
      res.json(
        getTextVersionDiff({
          base,
          target,
          language: versionLanguage(req.query.lang),
          status,
          query: queryText(req.query.q),
          page: Number(req.query.page || 1),
          pageSize: Number(req.query.page_size || 100),
        }),
      );
    } catch (error) {
      textVersionError(res, error);
    }
  },
);

// GET /api/workbench/versions/diff/groups - Group diff rows for structured exports
workbenchRouter.get(
  [
    "/versions/diff/groups",
    "/workbench/versions/diff/groups",
    "/editor/versions/diff/groups",
  ],
  (req: Request, res: Response) => {
    if (!requireVersionEditor(req, res)) return;
    try {
      const base = queryText(req.query.base);
      const target = queryText(req.query.target);
      if (!base || !target) throw new Error("base and target are required");
      res.json(
        getTextVersionGroups({
          base,
          target,
          language: versionLanguage(req.query.lang),
        }),
      );
    } catch (error) {
      textVersionError(res, error);
    }
  },
);

// GET /api/workbench/versions/diff/export - CSV or SQLite row-level diff
workbenchRouter.get(
  [
    "/versions/diff/export",
    "/workbench/versions/diff/export",
    "/editor/versions/diff/export",
  ],
  (req: Request, res: Response) => {
    if (!requireVersionEditor(req, res)) return;
    try {
      const base = queryText(req.query.base);
      const target = queryText(req.query.target);
      const format = queryText(req.query.format || "csv");
      if (!base || !target) throw new Error("base and target are required");
      const language = versionLanguage(req.query.lang);
      if (format === "sqlite") {
        res.setHeader("Content-Type", "application/vnd.sqlite3");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="wuwaid-text-diff.db"',
        );
        res.send(exportTextVersionSqlite(base, target, language));
        return;
      }
      if (format !== "csv")
        throw new Error(`unsupported export format: ${format}`);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="wuwaid-text-diff.csv"',
      );
      res.send(exportTextVersionCsv(base, target, language));
    } catch (error) {
      textVersionError(res, error);
    }
  },
);

// POST /api/workbench/versions/diff/export-structured - Grouped SQLite DB ZIP
workbenchRouter.post(
  [
    "/versions/diff/export-structured",
    "/workbench/versions/diff/export-structured",
    "/editor/versions/diff/export-structured",
  ],
  (req: Request, res: Response) => {
    if (!requireVersionEditor(req, res)) return;
    try {
      const base = queryText(req.body?.base);
      const target = queryText(req.body?.target);
      const groups = Array.isArray(req.body?.groups)
        ? req.body.groups.filter(
            (group: unknown): group is string => typeof group === "string",
          )
        : [];
      if (!base || !target) throw new Error("base and target are required");
      const result = exportStructuredTextDiff({
        base,
        target,
        language: versionLanguage(req.body?.lang),
        groupIds: groups,
      });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`,
      );
      res.send(result.buffer);
    } catch (error) {
      textVersionError(res, error);
    }
  },
);

// POST /api/workbench/export or /api/editor/export - Export dataset
workbenchRouter.post(
  ["/export", "/workbench/export", "/editor/export"],
  (_req: Request, res: Response) => {
    res.json({
      status: "success",
      exportUrl: "/api/editor/export/download/wuwa_id_dataset_latest.zip",
      timestamp: new Date().toISOString(),
    });
  },
);
