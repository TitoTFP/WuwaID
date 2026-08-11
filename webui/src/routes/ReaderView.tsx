import React, { useState } from 'react';
import { BookOpen, Globe, Layers, Activity, Sparkles, ChevronRight, CheckCircle2 } from 'lucide-react';
import { fontMockData, MOCK_QUEST_DETAILS, MOCK_TEXT_CATEGORIES } from '../mockData/quests';
import { QuestStreamViewer } from '../components/reader/QuestStreamViewer';

export const ReaderView: React.FC = () => {
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(null);

  if (selectedQuestId && MOCK_QUEST_DETAILS[selectedQuestId]) {
    return (
      <QuestStreamViewer quest={MOCK_QUEST_DETAILS[selectedQuestId]} />
    );
  }

  return (
    <div className="h-full flex flex-col space-y-4 overflow-hidden animate-fade-in">
      {/* Compact Hero Banner */}
      <div className="relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-r from-obsidian-900 via-obsidian-850 to-obsidian-900 border border-obsidian-800 p-5 shadow-panel">
        <div className="absolute top-0 right-0 w-80 h-80 bg-cyber-cyan/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-cyber-cyan/10 border border-cyber-cyan/30 text-cyber-cyan text-xs font-mono">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Above the Fold • Prydwen & Game DB Style</span>
            </div>

            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-100 font-sans">
              Wuthering Waves Indonesia <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyber-cyan via-slate-200 to-cyber-gold">Quest & Dialogue Archive</span>
            </h1>

            <p className="text-slate-400 text-xs sm:text-sm leading-relaxed line-clamp-1">
              Eksplorasi cerita, percakapan dialog multibahasa (EN, ZH-Hans, JA, ID), dan database teks game secara instan.
            </p>
          </div>

          {/* Stat Cards */}
          <div className="flex items-center space-x-3">
            <div className="cyber-card px-3 py-2 flex items-center space-x-3">
              <BookOpen className="w-4 h-4 text-cyber-cyan" />
              <div>
                <div className="text-base font-bold font-mono text-slate-100">1,248</div>
                <div className="text-[10px] text-slate-500 font-mono">Quests</div>
              </div>
            </div>

            <div className="cyber-card px-3 py-2 flex items-center space-x-3">
              <Globe className="w-4 h-4 text-cyber-gold" />
              <div>
                <div className="text-base font-bold font-mono text-slate-100">42,850</div>
                <div className="text-[10px] text-slate-500 font-mono">Baris ID</div>
              </div>
            </div>

            <div className="cyber-card px-3 py-2 flex items-center space-x-3">
              <Activity className="w-4 h-4 text-cyber-emerald" />
              <div>
                <div className="text-base font-bold font-mono text-slate-100">98.4%</div>
                <div className="text-[10px] text-slate-500 font-mono">Cakupan</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid Container taking remaining vertical space */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Chapters Section (8 cols) */}
        <div className="lg:col-span-8 cyber-card p-4 flex flex-col overflow-hidden border-obsidian-800">
          <div className="flex items-center justify-between pb-2 border-b border-obsidian-800 shrink-0">
            <h2 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
              <Layers className="w-4 h-4 text-cyber-cyan" />
              <span>Chapter & Bab Cerita Utama</span>
            </h2>
            <span className="text-xs font-mono text-slate-500">4 Chapter Aktif</span>
          </div>

          <div className="flex-1 overflow-y-auto pt-3 pr-1 space-y-2.5">
            {fontMockData.map((ch) => (
              <div
                key={ch.id}
                onClick={() => setSelectedQuestId('quest_ch1_01')}
                className="cyber-card cyber-card-hover p-3.5 space-y-2 cursor-pointer group bg-obsidian-950/60"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-cyber-cyan bg-cyber-cyan/10 px-2 py-0.5 rounded border border-cyber-cyan/30 font-bold">
                    {ch.number}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">{ch.progressPercentage}% Selesai</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100 group-hover:text-cyber-cyan transition-colors flex items-center justify-between">
                    <span>{ch.title}</span>
                    <ChevronRight className="w-4 h-4 text-cyber-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                    {ch.questCount} Quests • {ch.totalLines.toLocaleString()} Baris Dialog • {ch.region}
                  </p>
                </div>
                <div className="w-full bg-obsidian-800 rounded-full h-1 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-cyber-cyan to-cyber-gold h-full rounded-full transition-all duration-300"
                    style={{ width: `${ch.progressPercentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Text Categories Section (4 cols) */}
        <div className="lg:col-span-4 cyber-card p-4 flex flex-col overflow-hidden border-obsidian-800">
          <div className="flex items-center justify-between pb-2 border-b border-obsidian-800 shrink-0">
            <h2 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
              <Globe className="w-4 h-4 text-cyber-gold" />
              <span>Kategori Teks UI</span>
            </h2>
            <span className="text-xs font-mono text-slate-500">4 Kategori</span>
          </div>

          <div className="flex-1 overflow-y-auto pt-3 pr-1 space-y-2.5">
            {MOCK_TEXT_CATEGORIES.map((cat) => (
              <div key={cat.id} className="cyber-card p-3 space-y-1.5 bg-obsidian-950/60 hover:border-cyber-gold/40 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-cyber-gold">{cat.name}</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-cyber-emerald shrink-0" />
                </div>
                <p className="text-[11px] text-slate-400 font-sans line-clamp-2">{cat.description}</p>
                <div className="text-[10px] font-mono text-slate-500 pt-0.5">
                  {cat.translatedItems} / {cat.totalItems} Teks Terjemah
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
