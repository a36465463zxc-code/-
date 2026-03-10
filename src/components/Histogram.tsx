import React, { useEffect, useRef, useState } from 'react';
import { BarChart2, Maximize2, Minimize2 } from 'lucide-react';

interface HistogramProps {
  data: { r: number[], g: number[], b: number[], l: number[] } | null;
}

export function Histogram({ data }: HistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [useLogScale, setUseLogScale] = useState(false);
  const [showLuminance, setShowLuminance] = useState(true);
  const [showChannels, setShowChannels] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear with background
    ctx.fillStyle = '#09090b'; // zinc-950
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = '#27272a'; // zinc-800
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Vertical lines
    for (let i = 1; i < 4; i++) {
      const x = (i / 4) * width;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    // Horizontal lines
    for (let i = 1; i < 3; i++) {
      const y = (i / 3) * height;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    if (!data) return;

    // Find max value to scale the histogram
    let max = 0;
    const channels = [];
    if (showChannels) channels.push(data.r, data.g, data.b);
    if (showLuminance) channels.push(data.l);

    if (channels.length === 0) return;

    for (const channel of channels) {
      for (let i = 0; i < 256; i++) {
        const val = useLogScale ? Math.log1p(channel[i]) : channel[i];
        max = Math.max(max, val);
      }
    }

    if (max === 0) return;

    const drawChannel = (channelData: number[], color: string, fill: string) => {
      ctx.beginPath();
      ctx.moveTo(0, height);
      
      // Use a small step to reduce points if needed, but 256 is fine for 512px width
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * width;
        const val = useLogScale ? Math.log1p(channelData[i]) : channelData[i];
        const y = height - (val / max) * height;
        
        if (i === 0) {
          ctx.lineTo(x, y);
        } else {
          // Simple smoothing could be done here, but lineTo is accurate
          ctx.lineTo(x, y);
        }
      }
      
      ctx.lineTo(width, height);
      ctx.closePath();
      
      ctx.fillStyle = fill;
      ctx.fill();
      
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    // Use screen blend mode so overlapping colors mix
    ctx.globalCompositeOperation = 'screen';

    if (showChannels) {
      drawChannel(data.r, 'rgba(239, 68, 68, 1)', 'rgba(239, 68, 68, 0.3)'); // red-500
      drawChannel(data.g, 'rgba(34, 197, 94, 1)', 'rgba(34, 197, 94, 0.3)'); // green-500
      drawChannel(data.b, 'rgba(59, 130, 246, 1)', 'rgba(59, 130, 246, 0.3)'); // blue-500
    }

    if (showLuminance) {
      ctx.globalCompositeOperation = 'source-over';
      drawChannel(data.l, 'rgba(255, 255, 255, 0.8)', 'rgba(255, 255, 255, 0.1)');
    }

    ctx.globalCompositeOperation = 'source-over';

    // Draw clipping indicators
    if (data) {
      const shadowClip = data.l[0] > (data.l.reduce((a, b) => a + b, 0) * 0.01);
      const highlightClip = data.l[255] > (data.l.reduce((a, b) => a + b, 0) * 0.01);

      if (shadowClip) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(4, height - 4, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (highlightClip) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(width - 4, height - 4, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [data, useLogScale, showLuminance, showChannels]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <BarChart2 className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Histogram</span>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowChannels(!showChannels)}
            className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${showChannels ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'}`}
          >
            RGB
          </button>
          <button 
            onClick={() => setShowLuminance(!showLuminance)}
            className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${showLuminance ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'}`}
          >
            LUM
          </button>
          <button 
            onClick={() => setUseLogScale(!useLogScale)}
            className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${useLogScale ? 'bg-indigo-900/50 text-indigo-300' : 'text-zinc-600 hover:text-zinc-400'}`}
            title={useLogScale ? "Switch to Linear Scale" : "Switch to Logarithmic Scale"}
          >
            LOG
          </button>
        </div>
      </div>
      <div className="w-full h-28 bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800 relative group">
        <canvas
          ref={canvasRef}
          width={512}
          height={200}
          className="w-full h-full"
        />
        <div className="absolute bottom-1 left-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
        </div>
      </div>
    </div>
  );
}
