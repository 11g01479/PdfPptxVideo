
import React from 'react';

interface StepCardProps {
  number: number;
  title: string;
  children: React.ReactNode;
  active: boolean;
  completed: boolean;
}

const StepCard: React.FC<StepCardProps> = ({ number, title, children, active, completed }) => {
  return (
    <div className={`transition-all duration-500 rounded-3xl p-8 mb-6 border ${
      active 
        ? 'bg-slate-800/40 border-cyan-500 shadow-2xl shadow-cyan-500/10' 
        : completed 
          ? 'bg-slate-900/50 border-emerald-500/30 opacity-100'
          : 'bg-slate-900/20 border-slate-800 opacity-40 grayscale pointer-events-none'
    }`}>
      <div className="flex items-center gap-5 mb-8">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl transition-all ${
          completed ? 'bg-emerald-500 text-white rotate-12' : active ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/50' : 'bg-slate-700 text-slate-400'
        }`}>
          {completed ? '✓' : number}
        </div>
        <h3 className="text-2xl font-black tracking-tight">{title}</h3>
      </div>
      <div className={active ? 'animate-in fade-in slide-in-from-bottom-2 duration-700' : ''}>
        {children}
      </div>
    </div>
  );
};

export default StepCard;
