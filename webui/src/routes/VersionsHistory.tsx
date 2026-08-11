import React, { useState } from 'react';
import { MOCK_APPLIED_VERSIONS } from '../mockData/draftsAndVersions';
import { Sparkles, GitCommit, Calendar, User, FileDiff, ChevronDown, ChevronUp } from 'lucide-react';

export const VersionsHistory: React.FC = () => {
  const [expandedTag, setExpandedTag] = useState<string | null>(MOCK_APPLIED_VERSIONS[0].versionTag);

  return (
    <div className="h-full flex flex-col space-y-3 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="shrink-0 border-b border-obsidian-800 pb-2.5">
        <h1 className="text-base sm:text-lg font-bold text-slate-100 flex items-center space-x-2 font-sans">
          <Sparkles className="w-5 h-5 text-cyber-cyan" />
          <span>Riwayat Versi Terapan (Applied Versions Log)</span>
        </h1>
        <p className="text-xs text-slate-400 font-mono">
          Jejak riwayat rilis dan pembaharuan terjemahan resmi database WuwaID.
        </p>
      </div>

      {/* Internal Scrollable Stream (Above the Fold) */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {MOCK_APPLIED_VERSIONS.map((ver) => {
          const isExpanded = ver.versionTag === expandedTag;

          return (
            <div
              key={ver.versionTag}
              className="cyber-card p-4 border-obsidian-800 space-y-2.5 hover:border-cyber-cyan/30 transition-all bg-obsidian-900/90"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-obsidian-800/80">
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-mono font-bold text-cyber-cyan bg-cyber-cyan/15 px-2.5 py-0.5 rounded border border-cyber-cyan/30">
                    {ver.versionTag}
                  </span>
                  <span className="text-xs font-mono text-slate-400 flex items-center space-x-1">
                    <GitCommit className="w-3.5 h-3.5 text-cyber-gold" />
                    <span>commit: <code className="text-slate-200">{ver.commitHash}</code></span>
                  </span>
                </div>

                <div className="flex items-center space-x-3 text-xs font-mono text-slate-400">
                  <span className="flex items-center space-x-1">
                    <User className="w-3.5 h-3.5" />
                    <span>{ver.author}</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{new Date(ver.appliedAt).toLocaleDateString('id-ID')}</span>
                  </span>
                </div>
              </div>

              <div>
                <p className="text-xs sm:text-sm font-sans text-slate-200 font-semibold">
                  {ver.description}
                </p>
                <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                  Total {ver.totalLinesModified.toLocaleString()} baris dialog diperbarui.
                </div>
              </div>

              <div className="pt-1">
                <button
                  onClick={() => setExpandedTag(isExpanded ? null : ver.versionTag)}
                  className="flex items-center space-x-1.5 text-xs font-mono text-cyber-cyan hover:underline"
                >
                  <FileDiff className="w-3.5 h-3.5" />
                  <span>{isExpanded ? 'Sembunyikan Rincian' : 'Lihat Rincian Quest Rilis'}</span>
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {isExpanded && (
                  <div className="mt-2 p-2.5 rounded bg-obsidian-950 border border-obsidian-800 space-y-1.5 animate-fade-in">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ver.diffSummary.map((diff, idx) => (
                        <div key={idx} className="p-2 rounded bg-obsidian-900 border border-obsidian-800 flex items-center justify-between text-xs font-mono">
                          <span className="text-slate-300">{diff.questTitle}</span>
                          <span className="text-cyber-emerald font-bold">+{diff.linesChanged} baris</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
