import React from 'react';

interface SliderControlProps {
  label: string;
  icon?: React.ReactNode;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

export function SliderControl({ label, icon, value, min, max, onChange }: SliderControlProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-zinc-400">
        <div className="flex items-center gap-2">
          {icon}
          <span>{label}</span>
        </div>
        <span className="font-mono text-xs">{value > 0 ? `+${value}` : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
      />
    </div>
  );
}
