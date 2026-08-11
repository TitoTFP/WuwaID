import React, { useState, useMemo } from 'react';
import { QuestDetail, LanguageCode } from '../../types';
import { DialogueLineCard } from './DialogueLineCard';
import { Search, Globe, Filter, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface QuestStreamViewerProps {
  quest: QuestDetail;
}

export const QuestStreamViewer: React.FC<QuestStreamViewerProps> = ({ quest }) => {
  const navigate = useNavigate();
  const [primaryLang, setPrimaryLang] = useState<LanguageCode>('id');
  const [secondaryLang, setSecondaryLang] = useState<LanguageCode>('en');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Extract unique list of speakers in this quest
  const uniqueSpeakers = useMemo(() => {
    const map = new Map<string, string>();
    quest.lines.forEach((l) => {
      if (l.speaker && l.speaker.id !== 'narrator') {
        map.set(l.speaker.id, l.speaker.name[primaryLang] || l.speaker.name.en);
      }
    });
    return Array.from(map.entries());
  }, [quest, primaryLang]);

  // Filter dialogue lines based on speaker and search query
  const filteredLines = useMemo(() => {
    return quest.lines.filter((line) => {
      if (selectedSpeaker !== 'all' && line.speaker.id !== selectedSpeaker) {
        return false;
      }
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const textP = (line.text[primaryLang] || line.text.en || '').toLowerCase();
        const textS = secondaryLang ? (line.text[secondaryLang] || '').toLowerCase() : '';
        const speakerName = (line.speaker.name[primaryLang] || line.speaker.name.en || '').toLowerCase();
        return textP.includes(q) || textS.includes(q) || speakerName.includes(q);
      }
      return true;
    });
  }, [quest, selectedSpeaker, searchQuery, primaryLang, secondaryLang]);

  return (
    <div className="h-full flex flex-col space-y-3 overflow-hidden animate-fade-in">
      {/* Compact Quest Header */}
      <div className="cyber-card p-3.5 shrink-0 border-obsidian-800 flex items-center justify-between gap-3 bg-obsidian-900/90">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 rounded-lg bg-obsidian-950 border border-obsidian-800 text-slate-400 hover:text-cyber-cyan transition-colors"
            title="Kembali ke Daftar Chapter"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center space-x-2 text-xs font-mono">
              <span className="text-cyber-cyan font-bold">{quest.chapterTitle}</span>
              <span className="text-slate-500">•</span>
              <span className="text-slate-400">{quest.totalLines} Baris Dialog</span>
            </div>
            <h1 className="text-base sm:text-lg font-bold text-slate-100 font-sans">
              {quest.title[primaryLang] || quest.title.en}
            </h1>
          </div>
        </div>

        {/* Reader Control Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Language Selectors */}
          <div className="flex items-center space-x-1.5 text-xs font-mono bg-obsidian-950 p-1 rounded border border-obsidian-800">
            <Globe className="w-3.5 h-3.5 text-cyber-cyan shrink-0 ml-1" />
            <select
              value={primaryLang}
              onChange={(e) => setPrimaryLang(e.target.value as LanguageCode)}
              className="bg-transparent text-cyber-cyan text-xs font-mono focus:outline-none"
            >
              <option value="id">Indonesia (ID)</option>
              <option value="en">English (EN)</option>
              <option value="zh-Hans">简体中文 (ZH)</option>
              <option value="ja">日本語 (JA)</option>
            </select>
            <span className="text-slate-500">+</span>
            <select
              value={secondaryLang || ''}
              onChange={(e) => setSecondaryLang(e.target.value as LanguageCode)}
              className="bg-transparent text-slate-300 text-xs font-mono focus:outline-none"
            >
              <option value="en">Pembanding: EN</option>
              <option value="zh-Hans">Pembanding: ZH</option>
              <option value="ja">Pembanding: JA</option>
              <option value="id">Pembanding: ID</option>
            </select>
          </div>

          {/* Speaker Filter */}
          <div className="flex items-center space-x-1 text-xs font-mono bg-obsidian-950 p-1 rounded border border-obsidian-800">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
            <select
              value={selectedSpeaker}
              onChange={(e) => setSelectedSpeaker(e.target.value)}
              className="bg-transparent text-slate-300 text-xs font-mono focus:outline-none"
            >
              <option value="all">Semua Speaker</option>
              {uniqueSpeakers.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="relative w-36 sm:w-44">
            <Search className="w-3 h-3 text-slate-400 absolute left-2 top-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari..."
              className="w-full bg-obsidian-950 border border-obsidian-800 rounded pl-7 pr-2 py-1 text-xs font-mono text-slate-200 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Internal Scrollable Dialogue Stream Container (Above the Fold) */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
        {filteredLines.map((line) => (
          <DialogueLineCard
            key={line.id}
            line={line}
            primaryLang={primaryLang}
            secondaryLang={secondaryLang}
          />
        ))}
      </div>
    </div>
  );
};
