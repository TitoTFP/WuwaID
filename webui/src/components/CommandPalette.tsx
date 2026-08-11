import React, { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Search, BookOpen, PenTool, Activity, FileText, Layers, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        isOpen ? onClose() : null;
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = (path: string) => {
    navigate(path);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-obsidian-950/80 backdrop-blur-md animate-fade-in">
      <div 
        className="fixed inset-0" 
        onClick={onClose} 
      />
      <div className="relative w-full max-w-2xl bg-obsidian-900 border border-obsidian-700/80 rounded-xl shadow-cyber-glow overflow-hidden z-10">
        <Command className="w-full">
          <div className="flex items-center px-4 border-b border-obsidian-800 bg-obsidian-950/50">
            <Search className="w-5 h-5 text-cyber-cyan mr-3 shrink-0" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Ketik perintah atau cari quest, chapter, baris dialog... (Ctrl+K)"
              className="w-full h-14 bg-transparent text-slate-100 placeholder-slate-400 font-sans focus:outline-none text-sm"
              autoFocus
            />
            <kbd className="px-2 py-0.5 text-xs font-mono bg-obsidian-800 text-slate-300 rounded border border-obsidian-700">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-96 overflow-y-auto p-2 space-y-1">
            <Command.Empty className="py-8 text-center text-sm text-slate-400 font-sans">
              Tidak ada hasil yang cocok dengan "{search}"
            </Command.Empty>

            <Command.Group heading="MODUS UTAMA (SURFACES)" className="text-[11px] font-mono font-bold text-slate-300 px-3 py-1.5 uppercase tracking-wider">
              <Command.Item
                onSelect={() => handleSelect('/')}
                className="flex items-center px-3 py-2.5 rounded-lg text-sm text-slate-200 hover:bg-cyber-cyan/10 hover:text-cyber-cyan cursor-pointer transition-colors"
              >
                <BookOpen className="w-4 h-4 mr-3 text-cyber-cyan" />
                <span>Reader Surface — Pembaca Quest & Dialog</span>
                <span className="ml-auto text-xs font-mono text-slate-400">Mode Reader</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleSelect('/workbench')}
                className="flex items-center px-3 py-2.5 rounded-lg text-sm text-slate-200 hover:bg-cyber-gold/10 hover:text-cyber-gold cursor-pointer transition-colors"
              >
                <PenTool className="w-4 h-4 mr-3 text-cyber-gold" />
                <span>Workbench Surface — Editor & Penerjemah</span>
                <span className="ml-auto text-xs font-mono text-slate-400">Mode Workbench</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleSelect('/operations')}
                className="flex items-center px-3 py-2.5 rounded-lg text-sm text-slate-200 hover:bg-cyber-emerald/10 hover:text-cyber-emerald cursor-pointer transition-colors"
              >
                <Activity className="w-4 h-4 mr-3 text-cyber-emerald" />
                <span>Operations Surface — Admin Logs & Telemetri</span>
                <span className="ml-auto text-xs font-mono text-slate-400">Mode Operations</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="AKSI CEPAT" className="text-[11px] font-mono font-bold text-slate-300 px-3 py-1.5 uppercase tracking-wider mt-2">
              <Command.Item
                onSelect={() => handleSelect('/drafts')}
                className="flex items-center px-3 py-2.5 rounded-lg text-sm text-slate-200 hover:bg-obsidian-800 cursor-pointer"
              >
                <FileText className="w-4 h-4 mr-3 text-slate-300" />
                <span>Lihat Draft Pending (Review Hub)</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleSelect('/categories')}
                className="flex items-center px-3 py-2.5 rounded-lg text-sm text-slate-200 hover:bg-obsidian-800 cursor-pointer"
              >
                <Layers className="w-4 h-4 mr-3 text-slate-300" />
                <span>Teks Kategori & UI non-Quest</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleSelect('/versions')}
                className="flex items-center px-3 py-2.5 rounded-lg text-sm text-slate-200 hover:bg-obsidian-800 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 mr-3 text-slate-300" />
                <span>Riwayat Versi Terapan (Version History)</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
};
