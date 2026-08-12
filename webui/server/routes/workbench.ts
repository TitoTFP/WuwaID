import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { TranslationDraft } from '../../src/types/index.js';

export const workbenchRouter = Router();

// GET /api/workbench/drafts or /api/drafts - List translation drafts
workbenchRouter.get(['/drafts', '/workbench/drafts'], (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  let drafts = db.drafts;

  if (status && status !== 'all') {
    drafts = drafts.filter((d: TranslationDraft) => d.status === status);
  }

  res.json({ drafts });
});

// GET /api/workbench/drafts/:id or /api/drafts/:id - Single draft detail
workbenchRouter.get(['/drafts/:id', '/workbench/drafts/:id'], (req: Request, res: Response) => {
  const id = req.params.id;
  const draft = db.drafts.find((d: TranslationDraft) => d.id === id);

  if (!draft) {
    res.status(404).json({ error: `Draft '${id}' not found` });
    return;
  }

  res.json(draft);
});

// POST /api/workbench/drafts or /api/editor/drafts - Submit new draft
workbenchRouter.post(['/drafts', '/workbench/drafts', '/editor/drafts'], (req: Request, res: Response) => {
  const { questId, lineId, lineNo, speakerName, sourceText, previousText, proposedText } = req.body;

  if (!proposedText) {
    res.status(400).json({ error: "Field 'proposedText' is required" });
    return;
  }

  const newDraft = db.createDraft({
    questId: questId || 'quest_ch1_01',
    questTitle: 'Jinzhou Rising',
    lineId: lineId || 'line_103',
    lineNo: lineNo || 103,
    speakerName: speakerName || 'Rover',
    sourceText: sourceText || 'Where am I...?',
    previousText: previousText || 'Di mana aku berada...?',
    proposedText,
    author: {
      name: 'Active Editor',
      role: 'Editor',
    },
  });

  res.status(201).json({ status: 'created', draft: newDraft });
});

// POST /api/workbench/drafts/:id/approve or /api/drafts/:id/approve - Approve draft
workbenchRouter.post(['/drafts/:id/approve', '/workbench/drafts/:id/approve'], (req: Request, res: Response) => {
  const id = req.params.id;
  const draft = db.updateDraftStatus(id, 'approved', 'Reviewer Admin');

  if (!draft) {
    res.status(404).json({ error: `Draft '${id}' not found` });
    return;
  }

  res.json({ status: 'approved', draft });
});

// POST /api/workbench/drafts/:id/reject or /api/drafts/:id/reject - Reject draft
workbenchRouter.post(['/drafts/:id/reject', '/workbench/drafts/:id/reject'], (req: Request, res: Response) => {
  const id = req.params.id;
  const { reason } = req.body;
  const draft = db.updateDraftStatus(id, 'rejected', 'Reviewer Admin', reason);

  if (!draft) {
    res.status(404).json({ error: `Draft '${id}' not found` });
    return;
  }

  res.json({ status: 'rejected', draft });
});

// POST /api/workbench/drafts/batch-approve or /api/drafts/batch-approve
workbenchRouter.post(['/drafts/batch-approve', '/workbench/drafts/batch-approve'], (_req: Request, res: Response) => {
  let count = 0;
  for (const draft of db.drafts) {
    if (draft.status === 'pending') {
      draft.status = 'approved';
      count++;
    }
  }
  db.saveDrafts();
  res.json({ status: 'success', approvedCount: count });
});

// POST /api/workbench/drafts/apply or /api/drafts/apply
workbenchRouter.post(['/drafts/apply', '/workbench/drafts/apply'], (_req: Request, res: Response) => {
  const result = db.applyApprovedDrafts();
  res.json(result);
});

// POST /api/workbench/glossary/matches or /api/editor/glossary/matches
workbenchRouter.post(['/glossary/matches', '/workbench/glossary/matches', '/editor/glossary/matches'], (req: Request, res: Response) => {
  const text = (req.body.text || '').toLowerCase();
  const matches: Array<{ term: string; translation: string }> = [];

  for (const item of Object.values(db.glossary)) {
    if (text.includes(item.term.toLowerCase())) {
      matches.push({ term: item.term, translation: item.translation });
    }
  }

  res.json({ matches });
});

// GET /api/workbench/versions or /api/editor/versions - Applied versions
workbenchRouter.get(['/versions', '/workbench/versions', '/editor/versions'], (_req: Request, res: Response) => {
  res.json({ versions: db.appliedVersions });
});

// GET /api/workbench/versions/diff or /api/editor/versions/diff - Version diff
workbenchRouter.get(['/versions/diff', '/workbench/versions/diff', '/editor/versions/diff'], (req: Request, res: Response) => {
  const versionTag = (req.query.version as string) || 'v1.0.8';
  res.json({
    versionTag,
    totalChanges: 4,
    diffs: [
      {
        questId: 'quest_ch1_01',
        questTitle: 'Jinzhou Rising',
        lineId: 'line_103',
        lineNo: 103,
        speaker: 'Rover',
        previousText: 'Di mana aku...?',
        newText: 'Di mana aku sekarang...?',
      },
      {
        questId: 'quest_ch1_01',
        questTitle: 'Jinzhou Rising',
        lineId: 'line_104',
        lineNo: 104,
        speaker: 'Yangyang',
        previousText: 'Ini adalah Ngarai Roh.',
        newText: 'Ini adalah Ngarai Roh, tidak jauh dari Kota Jinzhou.',
      },
    ],
  });
});

// POST /api/workbench/export or /api/editor/export - Export dataset
workbenchRouter.post(['/export', '/workbench/export', '/editor/export'], (_req: Request, res: Response) => {
  res.json({
    status: 'success',
    exportUrl: '/api/editor/export/download/wuwa_id_dataset_latest.zip',
    timestamp: new Date().toISOString(),
  });
});
