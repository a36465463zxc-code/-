import React, { useEffect, useRef } from 'react';

interface HistogramProps {
  data: { r: number[], g: number[], b: number[] } | null;
}

export function Histogram({ data }: HistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!data) return;

    // Find max value to scale the histogram
    let max = 0;
    for (let i = 0; i < 256; i++) {
      max = Math.max(max, data.r[i], data.g[i], data.b[i]);
    }

    if (max === 0) return;

    // Use screen blend mode so overlapping colors mix (e.g., R+G=Y)
    ctx.globalCompositeOperation = 'screen';

    const drawChannel = (channelData: number[], color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * width;
        const y = height - (channelData[i] / max) * height;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
    };

    drawChannel(data.r, 'rgba(255, 64, 64, 0.7)');
    drawChannel(data.g, 'rgba(64, 255, 64, 0.7)');
    drawChannel(data.b, 'rgba(64, 64, 255, 0.7)');

    ctx.globalCompositeOperation = 'source-over';
  }, [data]);

  return (
    <div className="w-full h-24 bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800">
      <canvas
        ref={canvasRef}
        width={256}
        height={100}
        className="w-full h-full"
      />
    </div>
  );
}
