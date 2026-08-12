import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface CyberSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  placeholder?: string;
  accentColor?: 'cyan' | 'gold' | 'emerald';
}

export const CyberSelect: React.FC<CyberSelectProps> = ({
  options,
  value,
  onChange,
  icon,
  placeholder = 'Pilih...',
  accentColor = 'gold',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const borderAccentClass =
    accentColor === 'cyan'
      ? 'hover:border-cyber-cyan/50 focus:border-cyber-cyan'
      : accentColor === 'emerald'
      ? 'hover:border-cyber-emerald/50 focus:border-cyber-emerald'
      : 'hover:border-cyber-gold/50 focus:border-cyber-gold';

  const textAccentClass =
    accentColor === 'cyan'
      ? 'text-cyber-cyan'
      : accentColor === 'emerald'
      ? 'text-cyber-emerald'
      : 'text-cyber-gold';

  return (
    <div ref={containerRef} className="relative inline-block text-left select-none">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between space-x-2 px-3 py-1.5 rounded-lg bg-obsidian-950/90 border border-obsidian-800 text-xs font-mono text-slate-100 transition-all ${borderAccentClass} ${
          isOpen ? 'ring-1 ring-cyber-gold/40 border-cyber-gold/60' : ''
        }`}
      >
        <div className="flex items-center space-x-2">
          {icon && <span className={textAccentClass}>{icon}</span>}
          <span>{selectedOption ? selectedOption.label : placeholder}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-cyber-gold' : ''}`} />
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-obsidian-950 border border-obsidian-700/80 shadow-2xl z-50 overflow-hidden backdrop-blur-xl animate-fade-in">
          <div className="py-1 max-h-60 overflow-y-auto">
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2 text-xs font-mono transition-colors text-left ${
                    isSelected
                      ? 'bg-cyber-gold/15 text-cyber-gold font-bold border-l-2 border-cyber-gold'
                      : 'text-slate-200 hover:bg-obsidian-900 hover:text-slate-100'
                  }`}
                >
                  <span>{opt.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-cyber-gold shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
