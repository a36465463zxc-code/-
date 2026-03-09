import { LUT3D } from '../types';

export async function parseCubeLUT(file: File): Promise<LUT3D> {
  const text = await file.text();
  const lines = text.split('\n');
  let size = 0;
  const data: number[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1], 10);
    } else {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const r = parseFloat(parts[0]);
        const g = parseFloat(parts[1]);
        const b = parseFloat(parts[2]);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          data.push(r, g, b);
        }
      }
    }
  }

  if (size === 0 || data.length !== size * size * size * 3) {
    throw new Error(`Invalid or unsupported .cube file. Expected ${size * size * size * 3} values, got ${data.length}.`);
  }

  return {
    name: file.name,
    size,
    data: new Float32Array(data)
  };
}
