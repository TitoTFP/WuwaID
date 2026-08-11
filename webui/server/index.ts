import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'WuwaID Fullstack WebUI Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Quests Summary API
app.get('/api/quests', (req, res) => {
  res.json({
    quests: [
      {
        id: 'quest_ch1_01',
        chapterId: 'ch1',
        title: { en: 'Utterance of Frost', id: 'Ucapan Es dan Halilintar', zh: '霜雷之言' },
        type: 'main',
        totalLines: 120,
        translatedLines: { id: 120, zh: 120, ja: 120 },
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'quest_ch1_02',
        chapterId: 'ch1',
        title: { en: 'Echoes in the Valley', id: 'Gema di Lembah Huanglong', zh: '山谷回响' },
        type: 'main',
        totalLines: 85,
        translatedLines: { id: 85, zh: 85, ja: 85 },
        updatedAt: new Date().toISOString(),
      },
    ],
  });
});

// System Telemetry Metrics API
app.get('/api/metrics', (req, res) => {
  res.json({
    totalQuests: 1248,
    totalDialogueLines: 42850,
    translationCoverageId: 98.4,
    activeTranslators: 12,
    activePlayers24h: 3420,
    serverStatus: 'online',
  });
});

app.listen(PORT, () => {
  console.log(`[WuwaID WebUI Server] Running on http://localhost:${PORT}`);
});
