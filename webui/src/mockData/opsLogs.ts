import { LogEntry, HeartbeatPoint } from '../types';

export const MOCK_HEARTBEAT_DATA: HeartbeatPoint[] = [
  { timestamp: '12:00', activePlayers: 1840, heartbeatsPerMin: 320 },
  { timestamp: '12:30', activePlayers: 2150, heartbeatsPerMin: 410 },
  { timestamp: '13:00', activePlayers: 2890, heartbeatsPerMin: 580 },
  { timestamp: '13:30', activePlayers: 3420, heartbeatsPerMin: 690 },
  { timestamp: '14:00', activePlayers: 3100, heartbeatsPerMin: 610 },
];

export const MOCK_LOG_ENTRIES: LogEntry[] = [
  {
    id: 'log_901',
    level: 'error',
    client: 'WuwaLauncher',
    clientVersion: 'v1.4.2',
    deviceId: 'DEV-WIN-893A',
    timestamp: new Date(Date.now() - 1000 * 30).toISOString(), // 30s ago
    category: 'GamePatcher',
    message: 'Checksum verification mismatch for file pak_chunk_004.pak',
    details: {
      errorCode: 'ERR_HASH_MISMATCH',
      expectedHash: 'd41d8cd98f00b204e9800998ecf8427e',
      actualHash: 'e2fc714c4727ee9395f324cd2e7f331f',
      downloadUrl: 'https://cdn.wuwaid.org/patches/pak_chunk_004.pak',
      retryCount: 3,
    },
  },
  {
    id: 'log_902',
    level: 'warn',
    client: 'WuwaMobile',
    clientVersion: 'v1.4.0-Android',
    deviceId: 'DEV-ANDR-772B',
    timestamp: new Date(Date.now() - 1000 * 120).toISOString(), // 2m ago
    category: 'AssetDownloader',
    message: 'High latency detected during asset pack sync (850ms response time)',
    details: {
      latencyMs: 850,
      serverNode: 'sg-node-02.wuwaid.org',
      bandwidthKbps: 4500,
    },
  },
  {
    id: 'log_903',
    level: 'info',
    client: 'WuwaLauncher',
    clientVersion: 'v1.4.2',
    deviceId: 'DEV-WIN-104C',
    timestamp: new Date(Date.now() - 1000 * 300).toISOString(), // 5m ago
    category: 'AuthSession',
    message: 'Heartbeat ping received from active session. Player ID: W-88320',
    details: {
      playerId: 'W-88320',
      region: 'Jinzhou-Asia',
      gameVersion: '1.4.0',
    },
  },
  {
    id: 'log_904',
    level: 'info',
    client: 'WuwaWeb',
    clientVersion: 'v1.0.0-webui',
    deviceId: 'WEB-CLIENT-551',
    timestamp: new Date(Date.now() - 1000 * 600).toISOString(), // 10m ago
    category: 'QuestReader',
    message: 'Multilingual quest stream view loaded for Chapter I quest_ch1_01',
    details: {
      questId: 'quest_ch1_01',
      primaryLang: 'id',
      secondaryLang: 'zh-Hans',
    },
  },
  {
    id: 'log_905',
    level: 'error',
    client: 'WuwaMobile',
    clientVersion: 'v1.4.0-iOS',
    deviceId: 'DEV-IOS-991A',
    timestamp: new Date(Date.now() - 1000 * 900).toISOString(), // 15m ago
    category: 'AudioEngine',
    message: 'Audio buffer allocation failed for voiceline voice_ch1_line_104.wav',
    details: {
      errorCode: 'OOM_AUDIO_BUFFER',
      memoryUsageMB: 1840,
      availableRAM: 120,
    },
  },
];
