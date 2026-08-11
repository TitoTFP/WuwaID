import React, { useState } from 'react';
import { DialogueLine, LanguageCode } from '../../types';
import { Copy, Check, Volume2, MessageSquare, CornerDownRight, User } from 'lucide-react';

interface DialogueLineCardProps {
  line: DialogueLine;
  primaryLang: LanguageCode;
  secondaryLang?: LanguageCode;
  onCopyAnchor?: (lineId: string) => void;
}

export const DialogueLineCard: React.FC<DialogueLineCardProps> = ({
  line,
  primaryLang = 'id',
  secondaryLang = 'en',
  onCopyAnchor,
}) => {
  const [copied, setCopied] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const handleCopy = () => {
    const url = `${window.location.origin}${window.location.pathname}#line-${line.id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    if (onCopyAnchor) onCopyAnchor(line.id);
    setTimeout(() => setCopied(false), 2000);
  };

  if (line.type === 'scene_separator') {
    return (
      <div id={`line-${line.id}`} className="my-6 flex items-center justify-center space-x-4">
        <div className="h-px bg-gradient-to-r from-transparent via-obsidian-700 to-transparent flex-1" />
        <div className="px-4 py-1 rounded-full bg-obsidian-900 border border-obsidian-800 text-xs font-mono text-cyber-cyan tracking-widest uppercase">
          {line.text[primaryLang] || line.text.en}
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-obsidian-700 to-transparent flex-1" />
      </div>
    );
  }

  const primaryText = line.text[primaryLang] || line.text.en || '';
  const secondaryText = secondaryLang && secondaryLang !== primaryLang ? (line.text[secondaryLang] || '') : null;
  const isPlayer = line.speaker.isPlayer;

  return (
    <div
      id={`line-${line.id}`}
      className={`group relative p-4 rounded-xl border transition-all duration-200 ${
        isPlayer
          ? 'bg-cyber-gold/5 border-cyber-gold/20 hover:border-cyber-gold/40'
          : 'bg-obsidian-900/80 border-obsidian-800/80 hover:border-obsidian-700'
      }`}
    >
      {/* Header: Speaker Info & Line Tools */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-obsidian-800/60">
        <div className="flex items-center space-x-2.5">
          {/* Speaker Badge */}
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs font-mono border ${
              isPlayer
                ? 'bg-cyber-gold/15 text-cyber-gold border-cyber-gold/30'
                : 'bg-cyber-cyan/15 text-cyber-cyan border-cyber-cyan/30'
            }`}
          >
            {isPlayer ? 'R' : <User className="w-3.5 h-3.5" />}
          </div>
          <div>
            <span className="font-bold text-sm font-sans text-slate-100">
              {line.speaker.name[primaryLang] || line.speaker.name.en}
            </span>
            <span className="ml-2 text-[10px] font-mono text-slate-500">#{line.lineNo}</span>
          </div>
        </div>

        {/* Action Buttons: Play Audio & Copy Anchor */}
        <div className="flex items-center space-x-1 opacity-60 group-hover:opacity-100 transition-opacity">
          {line.audioUrl && (
            <button
              onClick={() => setIsPlayingAudio(!isPlayingAudio)}
              className={`p-1.5 rounded-md text-xs font-mono transition-colors ${
                isPlayingAudio ? 'bg-cyber-cyan text-obsidian-950' : 'hover:bg-obsidian-800 text-slate-400 hover:text-cyber-cyan'
              }`}
              title="Putar Audio Suara"
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-mono hover:bg-obsidian-800 text-slate-400 hover:text-cyber-cyan transition-colors"
            title="Salin Link Anchor Baris Ini"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-cyber-emerald" />
                <span className="text-cyber-emerald">Tersalin</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>#{line.id}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Multilingual Text View: Side-by-side or stacked */}
      <div className="space-y-2">
        {/* Primary Language Text */}
        <p className="text-sm sm:text-base leading-relaxed text-slate-100 font-sans">
          {primaryText}
        </p>

        {/* Secondary Comparison Text (if selected) */}
        {secondaryText && (
          <p className="text-xs sm:text-sm leading-relaxed text-slate-400 font-sans pt-1 border-t border-obsidian-800/40 italic">
            <span className="text-[10px] font-mono uppercase text-cyber-cyan/70 mr-2">[{secondaryLang}]</span>
            {secondaryText}
          </p>
        )}
      </div>

      {/* Choice Branch Options (if choice line) */}
      {line.type === 'choice' && line.options && line.options.length > 0 && (
        <div className="mt-3 pt-3 border-t border-obsidian-800/80 space-y-2">
          <div className="text-[11px] font-mono text-cyber-gold flex items-center space-x-1">
            <CornerDownRight className="w-3.5 h-3.5" />
            <span>Pilihan Percabangan (Dialogue Choices):</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-4">
            {line.options.map((opt, idx) => (
              <div
                key={opt.id}
                className="p-2.5 rounded-lg bg-cyber-gold/10 border border-cyber-gold/30 text-xs font-sans text-slate-200 hover:bg-cyber-gold/20 transition-colors flex items-start space-x-2"
              >
                <span className="font-mono text-cyber-gold font-bold">[{idx + 1}]</span>
                <span>{opt.text[primaryLang] || opt.text.en}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
