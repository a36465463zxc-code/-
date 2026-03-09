import React from 'react';
import { ImageItem } from '../types';
import { Trash2 } from 'lucide-react';

interface ImageItemCardProps {
  item: ImageItem;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  key?: string | number;
}

export function ImageItemCard({ item, isSelected, onSelect, onRemove }: ImageItemCardProps) {
  return (
    <div 
      className={`relative flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-indigo-600/20 border border-indigo-500/50' : 'hover:bg-zinc-800 border border-transparent'}`}
      onClick={onSelect}
    >
      <div className="w-12 h-12 rounded bg-zinc-800 overflow-hidden flex-shrink-0">
        <img src={item.src} alt={item.name} className="w-full h-full object-cover" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-200 truncate">{item.name}</p>
      </div>
      <button 
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
