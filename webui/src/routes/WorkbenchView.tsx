import React, { useState } from 'react';
import { PenTool, GitCommit, Split } from 'lucide-react';
import { MOCK_QUEST_DETAILS } from '../mockData/quests';
import { TranslatorWorkbench } from '../components/workbench/TranslatorWorkbench';
import { DialogueTreeEditor } from '../components/workbench/DialogueTreeEditor';

export const WorkbenchView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'translator' | 'tree'>('translator');
  const sampleQuest = MOCK_QUEST_DETAILS['quest_ch1_01'];

  return (
    <div className="h-full flex flex-col space-y-2 overflow-hidden animate-fade-in">
      {/* Compact Single Sub-Header Bar (Eliminating Wasted Header Banner Space) */}
      <div className="cyber-card px-3 py-1.5 shrink-0 flex flex-wrap items-center justify-between gap-2 bg-obsidian-900/90 border-obsidian-800">
        <div className="flex items-center space-x-3 text-xs font-mono">
          <span className="flex items-center space-x-1.5 text-cyber-gold font-bold bg-cyber-gold/10 px-2.5 py-1 rounded border border-cyber-gold/30">
            <PenTool className="w-3.5 h-3.5" />
            <span>Workbench</span>
          </span>
          <span className="text-slate-400">
            Quest: <strong className="text-slate-200">{sampleQuest.title.id || sampleQuest.title.en}</strong>
          </span>
        </div>

        {/* View Mode Tab Switcher */}
        <div className="flex items-center space-x-1 bg-obsidian-950 p-0.5 rounded-lg border border-obsidian-800">
          <button
            onClick={() => setActiveTab('translator')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all ${
              activeTab === 'translator'
                ? 'bg-cyber-gold text-obsidian-950 shadow-gold-glow font-bold'
                : 'text-slate-300 hover:text-slate-100 hover:bg-obsidian-800'
            }`}
          >
            <Split className="w-3.5 h-3.5" />
            <span>Split-Pane Penerjemah</span>
          </button>

          <button
            onClick={() => setActiveTab('tree')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-mono font-medium transition-all ${
              activeTab === 'tree'
                ? 'bg-cyber-cyan text-obsidian-950 shadow-cyber-glow font-bold'
                : 'text-slate-300 hover:text-slate-100 hover:bg-obsidian-800'
            }`}
          >
            <GitCommit className="w-3.5 h-3.5" />
            <span>Editor Pohon Dialog</span>
          </button>
        </div>
      </div>

      {/* Active Tab Content Container taking 100% remaining vertical space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'translator' ? (
          <TranslatorWorkbench quest={sampleQuest} />
        ) : (
          <DialogueTreeEditor quest={sampleQuest} />
        )}
      </div>
    </div>
  );
};
