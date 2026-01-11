
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
    <div className={`transition-all duration-500 rounded-2xl p-6 mb-6 border ${
      active 
        ? 'bg-slate-800/50 border-blue-500 shadow-lg shadow-blue-500/20' 
        : completed 
          ? 'bg-slate-900/50 border-green-500/30 opacity-80'
          : 'bg-slate-900/30 border-slate-700/50 opacity-50 grayscale pointer-events-none'
    }`}>
      <div className="flex items-center gap-4 mb-6">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${
          completed ? 'bg-green-500 text-white' : active ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-400'
        }`}>
          {completed ? '✓' : number}
        </div>
        <h3 className="text-xl font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
};

export default StepCard;
