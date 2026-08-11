import React from 'react';
import { ArrowRight, Plus, Minus, Check, X, ShieldAlert } from 'lucide-react';
import { TranslationDraft } from '../../types';

interface DiffInspectorProps {
  draft: TranslationDraft;
  onApprove?: (id: string) => void;
  onReject?: (id: string, reason: string) => void;
}

export const DiffInspector: React.FC<DiffInspectorProps> = ({ draft, onApprove, onReject }) => {
  const [rejectReasonInput, setRejectReasonInput] = React.useState('');
  const [showRejectModal, setShowRejectModal] = React.useState(false);

  return (
    <div className="cyber-card p-5 space-y-4 border-obsidian-800 bg-obsidian-900/90 shadow-panel">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-obsidian-800">
        <div className="flex items-center space-x-3">
          <span className="font-mono text-xs font-bold text-cyber-cyan bg-cyber-cyan/10 px-2.5 py-1 rounded border border-cyber-cyan/30">
            {draft.questTitle}
          </span>
          <span className="font-mono text-xs text-slate-300">
            Baris #{draft.lineNo} ({draft.lineId}) • <strong className="text-cyber-gold">{draft.speakerName}</strong>
          </span>
        </div>

        <div className="flex items-center space-x-2 text-xs font-mono">
          <span className="text-slate-400">Pengaju:</span>
          <span className="text-slate-200 font-bold bg-obsidian-950 px-2 py-0.5 rounded border border-obsidian-800">
            {draft.author.name} ({draft.author.role})
          </span>
        </div>
      </div>

      {/* Source Text Context */}
      <div className="bg-obsidian-950 p-3 rounded-lg border border-obsidian-800 space-y-1">
        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
          Teks Sumber Bahasa Inggris (Source Text):
        </span>
        <p className="text-sm font-sans text-slate-200 font-semibold">{draft.sourceText}</p>
      </div>

      {/* Visual Diff Comparison Box (Before vs After) */}
      <div className="space-y-2">
        <span className="text-[11px] font-mono text-cyber-gold uppercase font-bold block">
          Visual Diff Perbandingan (Crowdin Benchmark Style):
        </span>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Previous / Before Text (Red Highlight) */}
          <div className="p-3.5 rounded-lg bg-cyber-rose/5 border border-cyber-rose/30 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-cyber-rose">
              <span className="flex items-center space-x-1 font-bold">
                <Minus className="w-3.5 h-3.5" />
                <span>Sebelumnya (Original Text)</span>
              </span>
              <span>- SEBELUM</span>
            </div>
            <p className="text-sm font-sans text-slate-300 line-through decoration-cyber-rose/60 leading-relaxed">
              {draft.previousText || '(Belum ada terjemahan sebelumnya)'}
            </p>
          </div>

          {/* Proposed / After Text (Green Highlight) */}
          <div className="p-3.5 rounded-lg bg-cyber-emerald/5 border border-cyber-emerald/30 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-cyber-emerald">
              <span className="flex items-center space-x-1 font-bold">
                <Plus className="w-3.5 h-3.5" />
                <span>Usulan Baru (Proposed Draft)</span>
              </span>
              <span>+ SESUDAH</span>
            </div>
            <p className="text-sm font-sans text-slate-100 font-bold leading-relaxed">
              {draft.proposedText}
            </p>
          </div>
        </div>
      </div>

      {/* Status & Review Action Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-obsidian-800">
        <div className="text-xs font-mono">
          {draft.status === 'pending' && (
            <span className="text-cyber-amber bg-cyber-amber/10 px-2.5 py-1 rounded border border-cyber-amber/30">
              ● Menunggu Peninjauan Editor
            </span>
          )}
          {draft.status === 'approved' && (
            <span className="text-cyber-emerald bg-cyber-emerald/10 px-2.5 py-1 rounded border border-cyber-emerald/30">
              ✓ Disetujui (Approved)
            </span>
          )}
          {draft.status === 'rejected' && (
            <span className="text-cyber-rose bg-cyber-rose/10 px-2.5 py-1 rounded border border-cyber-rose/30">
              ✕ Ditolak: {draft.rejectionReason}
            </span>
          )}
        </div>

        {draft.status === 'pending' && (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowRejectModal(true)}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-cyber-rose/10 border border-cyber-rose/40 text-cyber-rose hover:bg-cyber-rose/20 text-xs font-mono font-bold transition-all"
            >
              <X className="w-3.5 h-3.5" />
              <span>Tolak (Reject)</span>
            </button>

            <button
              onClick={() => onApprove && onApprove(draft.id)}
              className="flex items-center space-x-1 px-4 py-1.5 rounded-lg bg-cyber-emerald text-obsidian-950 hover:bg-cyber-emerald/90 text-xs font-mono font-bold transition-all shadow-cyber-glow"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Setujui Draf (Approve)</span>
            </button>
          </div>
        )}
      </div>

      {/* Rejection Reason Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-obsidian-950/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-obsidian-900 border border-obsidian-700 rounded-xl p-5 space-y-4 shadow-panel">
            <div className="flex items-center space-x-2 text-cyber-rose font-mono text-sm font-bold">
              <ShieldAlert className="w-5 h-5" />
              <span>Alasan Penolakan Draf</span>
            </div>
            <p className="text-xs text-slate-400 font-sans">
              Berikan catatan penolakan agar translator dapat memperbaiki draf:
            </p>
            <textarea
              value={rejectReasonInput}
              onChange={(e) => setRejectReasonInput(e.target.value)}
              rows={3}
              placeholder="Contoh: Format gaya bahasa tidak sesuai pedoman..."
              className="w-full bg-obsidian-950 border border-obsidian-700 rounded p-2.5 text-xs font-mono text-slate-100 focus:border-cyber-rose outline-none"
            />
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowRejectModal(false)}
                className="px-3 py-1.5 rounded bg-obsidian-800 text-slate-400 text-xs font-mono"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  if (onReject) onReject(draft.id, rejectReasonInput || 'Gaya bahasa tidak memenuhi syarat.');
                  setShowRejectModal(false);
                }}
                className="px-4 py-1.5 rounded bg-cyber-rose text-white font-mono text-xs font-bold"
              >
                Kirim Penolakan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
