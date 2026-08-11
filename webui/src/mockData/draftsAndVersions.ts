import { TranslationDraft, AppliedVersion } from '../types';

export const MOCK_DRAFTS: TranslationDraft[] = [
  {
    id: 'draft_101',
    questId: 'quest_ch1_01',
    questTitle: 'Utterance of Frost & Thunder',
    lineId: 'line_103',
    lineNo: 3,
    speakerName: 'Rover',
    author: {
      name: 'ResonatorTranslator_ID',
      role: 'Translator',
    },
    sourceText: 'Where am I...?',
    previousText: 'Di mana aku...?',
    proposedText: 'Di mana aku sekarang...? Ingatanku terasa sangat kabur.',
    status: 'pending',
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 mins ago
  },
  {
    id: 'draft_102',
    questId: 'quest_ch1_01',
    questTitle: 'Utterance of Frost & Thunder',
    lineId: 'line_104',
    lineNo: 4,
    speakerName: 'Yangyang',
    author: {
      name: 'MidnightEditor_S',
      role: 'Editor',
    },
    sourceText: 'This is the Gorges of Spirits, near Jinzhou City.',
    previousText: 'Ini Ngarai Roh, dekat Kota Jinzhou.',
    proposedText: 'Ini adalah Ngarai Roh, wilayah terpencil dekat Kota Jinzhou.',
    status: 'pending',
    createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(), // 90 mins ago
  },
  {
    id: 'draft_103',
    questId: 'quest_ch1_01',
    questTitle: 'Utterance of Frost & Thunder',
    lineId: 'line_107',
    lineNo: 7,
    speakerName: 'Jiyan',
    author: {
      name: 'HuanglongLinguist',
      role: 'Senior Translator',
    },
    sourceText: 'Welcome to Jinzhou, Resonator. Your awakening heralds a shift in the tide.',
    previousText: 'Selamat datang di Jinzhou, Resonator. Kebangkitanmu menandai perubahan pasang surut.',
    proposedText: 'Selamat datang di Jinzhou, Resonator. Kebangkitanmu menandai perubahan arah angin gelombang.',
    status: 'approved',
    createdAt: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
  },
  {
    id: 'draft_104',
    questId: 'quest_ch1_01',
    questTitle: 'Utterance of Frost & Thunder',
    lineId: 'line_105',
    lineNo: 5,
    speakerName: 'Chixia',
    author: {
      name: 'DraftUser99',
      role: 'Contributor',
    },
    sourceText: 'Yangyang! Hey! Is our new friend awake now?',
    previousText: 'Yangyang! Hei! Apakah teman baru kita sudah bangun?',
    proposedText: 'Woy Yangyang! Teman baru bangun gak tuh?',
    status: 'rejected',
    rejectionReason: 'Gaya bahasa terlalu informal/gaul, tidak sesuai pedoman tata bahasa resmi game.',
    createdAt: new Date(Date.now() - 1000 * 60 * 480).toISOString(),
  },
];

export const MOCK_APPLIED_VERSIONS: AppliedVersion[] = [
  {
    versionTag: 'v1.2.0-ID',
    appliedAt: '2026-08-05T14:30:00Z',
    author: 'ChiefEditor_Jinzhou',
    commitHash: 'a8f93bc',
    totalLinesModified: 142,
    description: 'Penyelarasan Glosarium Bab I & II: Pembaharuan istilah Midnight Rangers & Sentinel Jue.',
    diffSummary: [
      { questTitle: 'Utterance of Frost & Thunder', linesChanged: 42 },
      { questTitle: 'Beneath the Crescent Moon', linesChanged: 100 },
    ],
  },
  {
    versionTag: 'v1.1.5-ID',
    appliedAt: '2026-08-01T09:15:00Z',
    author: 'HuanglongLinguist',
    commitHash: 'c7d210e',
    totalLinesModified: 88,
    description: 'Perbaikan QA otomatis: Penyesuaian variabel {PlayerName} dan tanda baca pada dialogue choices.',
    diffSummary: [
      { questTitle: 'Echoes of the Huanglong Tide', linesChanged: 88 },
    ],
  },
  {
    versionTag: 'v1.0.0-ID',
    appliedAt: '2026-07-20T18:00:00Z',
    author: 'SystemInit',
    commitHash: 'e100f2a',
    totalLinesModified: 42850,
    description: 'Rilis awal arsip terjemahan bahasa Indonesia WuwaID Quests.',
    diffSummary: [
      { questTitle: 'Seluruh Quest Bab I - IV', linesChanged: 42850 },
    ],
  },
];
