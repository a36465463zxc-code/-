import React, { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

interface SliderControlProps {
  label: string;
  icon?: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (v: number) => void;
}

export function SliderControl({ 
  label, 
  icon, 
  value, 
  min, 
  max, 
  step = 1, 
  defaultValue = 0,
  onChange 
}: SliderControlProps) {
  const isChanged = value !== defaultValue;
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(value.toString());

  useEffect(() => {
    if (!isEditing) {
      setInputValue(value > 0 ? `+${value}` : value.toString());
    }
  }, [value, isEditing]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    setIsEditing(false);
    let parsed = parseFloat(inputValue);
    if (isNaN(parsed)) {
      parsed = value;
    } else {
      parsed = Math.max(min, Math.min(max, parsed));
      if (step) {
        const inv = 1.0 / step;
        parsed = Math.round(parsed * inv) / inv;
      }
    }
    onChange(parsed);
    setInputValue(parsed > 0 ? `+${parsed}` : parsed.toString());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  return (
    <div className="group space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-zinc-800/50 text-zinc-400 group-hover:text-indigo-400 transition-colors">
            {icon}
          </div>
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {isChanged && (
            <button 
              onClick={() => onChange(defaultValue)}
              className="p-1 text-zinc-600 hover:text-indigo-400 transition-colors"
              title="Reset"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
          <input
            type="text"
            value={isEditing ? inputValue : (value > 0 ? `+${value}` : value)}
            onChange={handleInputChange}
            onFocus={() => {
              setIsEditing(true);
              setInputValue(value.toString());
            }}
            onBlur={handleInputBlur}
            onKeyDown={handleKeyDown}
            className="w-12 text-xs font-mono font-medium text-zinc-300 bg-transparent border-b border-transparent hover:border-zinc-600 focus:border-indigo-500 focus:outline-none text-right transition-colors"
          />
        </div>
      </div>
      
      <div className="relative flex items-center h-4">
        {/* Center line for bipolar sliders */}
        {min < 0 && max > 0 && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-2 bg-zinc-700 z-0" />
        )}
        
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onDoubleClick={() => onChange(defaultValue)}
          className="
            relative z-10 w-full h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer
            accent-indigo-500
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(99,102,241,0.4)]
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-indigo-500
            [&::-webkit-slider-thumb]:transition-all
            [&::-webkit-slider-thumb]:hover:scale-110
            [&::-webkit-slider-thumb]:active:scale-95
            [&::-moz-range-thumb]:w-3.5
            [&::-moz-range-thumb]:h-3.5
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-indigo-500
            [&::-moz-range-thumb]:shadow-[0_0_10px_rgba(99,102,241,0.4)]
            [&::-moz-range-thumb]:transition-all
            [&::-moz-range-thumb]:hover:scale-110
            [&::-moz-range-thumb]:active:scale-95
          "
        />
      </div>
    </div>
  );
}
