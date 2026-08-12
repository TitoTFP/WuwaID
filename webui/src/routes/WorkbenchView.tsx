import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GitCommit, Split } from 'lucide-react';
import { MOCK_QUEST_DETAILS } from '../mockData/quests';
import { TranslatorWorkbench } from '../components/workbench/TranslatorWorkbench';
import { DialogueTreeEditor } from '../components/workbench/DialogueTreeEditor';
import { fetchQuestDetail } from '../lib/api';

export const WorkbenchView: React.FC = () => {
  const { questId: routeQuestId } = useParams<{ questId?: string }>();
  const [searchParams] = useSearchParams();

  const urlQuestId = routeQuestId || searchParams.get('questId');
  const [selectedQuestId, setSelectedQuestId] = useState<string>(urlQuestId || '102000000');
  const [activeTab, setActiveTab] = useState<'translator' | 'tree'>('translator');

  useEffect(() => {
    if (urlQuestId) {
      setSelectedQuestId(urlQuestId);
    }
  }, [urlQuestId]);

  // Fetch real active quest detail
  const { data: questDetailData, isLoading: isLoadingQuest } = useQuery({
    queryKey: ['questDetail', selectedQuestId],
    queryFn: () => fetchQuestDetail(selectedQuestId),
    enabled: !!selectedQuestId,
  });

  const activeQuest = questDetailData || MOCK_QUEST_DETAILS['quest_ch1_01'];

  return (
    <div className="h-full flex flex-col space-y-2 overflow-hidden animate-fade-in">
      {/* Ultra-Clean Sub-Header Bar */}
      <div className="cyber-card px-3.5 py-1.5 shrink-0 flex items-center justify-between gap-3 bg-obsidian-900/90 border-obsidian-800">
        {/* Quest Title Label */}
        <div className="flex items-center space-x-2 text-xs font-mono">
          <span className="text-slate-400 font-bold uppercase">Quest:</span>
          <span className="text-cyber-cyan font-bold font-sans text-sm">
            {activeQuest.title?.id || activeQuest.title?.en || `Quest ${selectedQuestId}`}
          </span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-400">ID: {selectedQuestId}</span>
        </div>

        {/* View Mode Sub-Tab Switcher */}
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

      {/* Active Sub-Tab Content Container */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoadingQuest ? (
          <div className="h-full flex items-center justify-center text-xs font-mono text-slate-400">
            Memuat data quest #{selectedQuestId}...
          </div>
        ) : activeTab === 'translator' ? (
          <TranslatorWorkbench quest={activeQuest} />
        ) : (
          <DialogueTreeEditor quest={activeQuest} />
        )}
      </div>
    </div>
  );
};
