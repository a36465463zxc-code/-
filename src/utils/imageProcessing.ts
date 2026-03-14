import { Adjustments, LabStats } from '../types';

function applyBoxBlur(src: Float32Array, dst: Float32Array, temp: Float32Array, w: number, h: number, radius: number) {
  if (radius < 1) {
    dst.set(src);
    return;
  }
  
  // Horizontal
  for (let y = 0; y < h; y++) {
    let rSum = 0, gSum = 0, bSum = 0;
    const windowSize = radius * 2 + 1;
    
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = Math.max(0, Math.min(w - 1, dx));
      const idx = (y * w + nx) * 3;
      rSum += src[idx];
      gSum += src[idx + 1];
      bSum += src[idx + 2];
    }
    
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 3;
      temp[idx] = rSum / windowSize;
      temp[idx + 1] = gSum / windowSize;
      temp[idx + 2] = bSum / windowSize;
      
      const prevX = Math.max(0, x - radius);
      const nextX = Math.min(w - 1, x + radius + 1);
      const pIdx = (y * w + prevX) * 3;
      const nIdx = (y * w + nextX) * 3;
      
      rSum = rSum - src[pIdx] + src[nIdx];
      gSum = gSum - src[pIdx + 1] + src[nIdx + 1];
      bSum = bSum - src[pIdx + 2] + src[nIdx + 2];
    }
  }
  
  // Vertical
  for (let x = 0; x < w; x++) {
    let rSum = 0, gSum = 0, bSum = 0;
    const windowSize = radius * 2 + 1;
    
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = Math.max(0, Math.min(h - 1, dy));
      const idx = (ny * w + x) * 3;
      rSum += temp[idx];
      gSum += temp[idx + 1];
      bSum += temp[idx + 2];
    }
    
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 3;
      dst[idx] = rSum / windowSize;
      dst[idx + 1] = gSum / windowSize;
      dst[idx + 2] = bSum / windowSize;
      
      const prevY = Math.max(0, y - radius);
      const nextY = Math.min(h - 1, y + radius + 1);
      const pIdx = (prevY * w + x) * 3;
      const nIdx = (nextY * w + x) * 3;
      
      rSum = rSum - temp[pIdx] + temp[nIdx];
      gSum = gSum - temp[pIdx + 1] + temp[nIdx + 1];
      bSum = bSum - temp[pIdx + 2] + temp[nIdx + 2];
    }
  }
}

export function calculateBaseStats(srcData: Uint8ClampedArray, isNeg: boolean, autoMask: boolean, levels: any): import('../types').ColorStats {
  let rSum = 0, gSum = 0, bSum = 0;
  const count = srcData.length / 4;

  const getPixel = (i: number) => {
    let r = srcData[i];
    let g = srcData[i + 1];
    let b = srcData[i + 2];
    if (isNeg) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    if (autoMask && levels) {
      const deMask = (v: number, low: number, high: number) => {
        const range = high - low;
        if (range <= 0) return v;
        let norm = (v - low) / range;
        return Math.pow(Math.max(0, Math.min(1, norm)), 0.85) * 255;
      };
      r = deMask(r, levels.r.low, levels.r.high);
      g = deMask(g, levels.g.low, levels.g.high);
      b = deMask(b, levels.b.low, levels.b.high);
    }
    return [r, g, b];
  };

  for (let i = 0; i < srcData.length; i += 4) {
    const [r, g, b] = getPixel(i);
    rSum += r;
    gSum += g;
    bSum += b;
  }

  const rMean = rSum / count;
  const gMean = gSum / count;
  const bMean = bSum / count;

  let rVar = 0, gVar = 0, bVar = 0;
  for (let i = 0; i < srcData.length; i += 4) {
    const [r, g, b] = getPixel(i);
    rVar += (r - rMean) ** 2;
    gVar += (g - gMean) ** 2;
    bVar += (b - bMean) ** 2;
  }

  return {
    rMean, rStd: Math.sqrt(rVar / count),
    gMean, gStd: Math.sqrt(gVar / count),
    bMean, bStd: Math.sqrt(bVar / count)
  };
}

export function calculateLevels(srcData: Uint8ClampedArray, isNeg: boolean) {
  const histR = new Int32Array(256);
  const histG = new Int32Array(256);
  const histB = new Int32Array(256);

  for (let i = 0; i < srcData.length; i += 4) {
    let r = srcData[i];
    let g = srcData[i + 1];
    let b = srcData[i + 2];
    if (isNeg) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    histR[r]++;
    histG[g]++;
    histB[b]++;
  }

  const totalPixels = srcData.length / 4;
  
  const getPercentile = (hist: Int32Array, percentile: number) => {
    const target = totalPixels * percentile;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += hist[i];
      if (sum >= target) return i;
    }
    return 255;
  };

  const rLow = getPercentile(histR, 0.005);
  const gLow = getPercentile(histG, 0.005);
  const bLow = getPercentile(histB, 0.005);

  const rHigh = getPercentile(histR, 0.995);
  const gHigh = getPercentile(histG, 0.995);
  const bHigh = getPercentile(histB, 0.995);

  return {
    r: { low: rLow, high: rHigh },
    g: { low: gLow, high: gHigh },
    b: { low: bLow, high: bHigh }
  };
}

export function calculateAutoWhiteBalance(srcData: Uint8ClampedArray, isNeg: boolean, autoMask: boolean, levels: any) {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let totalWeight = 0;

  // For White Patch (Brightest near-neutral pixels)
  let maxLum = 0;
  let wpR = 0, wpG = 0, wpB = 0;

  for (let i = 0; i < srcData.length; i += 4) {
    let r = srcData[i];
    let g = srcData[i + 1];
    let b = srcData[i + 2];

    if (isNeg) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    if (autoMask && levels) {
      r = levels.r.high > levels.r.low ? ((r - levels.r.low) / (levels.r.high - levels.r.low)) * 255 : r;
      g = levels.g.high > levels.g.low ? ((g - levels.g.low) / (levels.g.high - levels.g.low)) * 255 : g;
      b = levels.b.high > levels.b.low ? ((b - levels.b.low) / (levels.b.high - levels.b.low)) * 255 : b;
    }

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // 1. Exclude extreme shadows and extreme highlights
    if (lum > 25 && lum < 245) {
      // Calculate saturation/color difference
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;

      // 2. Exclude highly saturated pixels (they skew the gray world assumption)
      if (saturation < 0.35) {
        // Weighted Gray World: pixels closer to neutral get more weight
        const diff = Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r);
        const weight = 1.0 / (1.0 + diff / 10.0); // Sharper falloff for non-neutral
        
        sumR += r * weight;
        sumG += g * weight;
        sumB += b * weight;
        totalWeight += weight;

        // 3. Track brightest near-neutral pixel for White Patch hybrid
        if (lum > maxLum && diff < 30) {
          maxLum = lum;
          wpR = r; wpG = g; wpB = b;
        }
      }
    }
  }

  if (totalWeight === 0) return { rOffset: 0, gOffset: 0, bOffset: 0 };

  const gwR = sumR / totalWeight;
  const gwG = sumG / totalWeight;
  const gwB = sumB / totalWeight;
  
  // Hybrid: Blend Gray World (80%) and White Patch (20%) if a valid white patch was found
  let avgR = gwR, avgG = gwG, avgB = gwB;
  if (maxLum > 150) { // Only use white patch if we actually found a bright enough neutral-ish pixel
    avgR = gwR * 0.8 + wpR * 0.2;
    avgG = gwG * 0.8 + wpG * 0.2;
    avgB = gwB * 0.8 + wpB * 0.2;
  }

  const avg = (avgR + avgG + avgB) / 3;

  let rOffset = avg - avgR;
  let gOffset = avg - avgG;
  let bOffset = avg - avgB;

  // 针对偏蓝和偏紫的颜色进行 30% 的增强矫正
  // 偏蓝：bOffset 为负数（需要减少蓝色）
  if (bOffset < 0) {
    bOffset *= 1.3;
  }
  
  // 偏紫：rOffset 和 bOffset 均为负数（需要同时减少红色和蓝色）
  if (rOffset < 0 && bOffset < 0) {
    rOffset *= 1.3;
  }

  // 重新平衡亮度：因为我们放大了负数偏移，会导致整体画面变暗
  // 我们将减少的数值补偿到需要增加的通道上，保证整体亮度（偏移总和）不变
  const newSum = rOffset + gOffset + bOffset;
  if (newSum < 0) {
    let posCount = 0;
    if (rOffset > 0) posCount++;
    if (gOffset > 0) posCount++;
    if (bOffset > 0) posCount++;
    
    if (posCount > 0) {
      const addition = -newSum / posCount;
      if (rOffset > 0) rOffset += addition;
      if (gOffset > 0) gOffset += addition;
      if (bOffset > 0) bOffset += addition;
    }
  }

  return {
    rOffset: Math.round(rOffset),
    gOffset: Math.round(gOffset),
    bOffset: Math.round(bOffset)
  };
}

export function calculateHistogram(imageData: ImageData) {
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const l = new Array(256).fill(0);
  
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const rv = data[i];
    const gv = data[i+1];
    const bv = data[i+2];
    r[rv]++;
    g[gv]++;
    b[bv]++;
    const lum = Math.round(0.299 * rv + 0.587 * gv + 0.114 * bv);
    l[lum]++;
  }
  
  return { r, g, b, l };
}

export function rgbToHsl(r: number, g: number, b: number) {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
      case gNorm: h = (bNorm - rNorm) / d + 2; break;
      case bNorm: h = (rNorm - gNorm) / d + 4; break;
    }
    h /= 6;
  }

  return { h, s, l };
}

export function getHslColorRange(h: number): import('../types').HSLColor {
  // h is between 0 and 1
  if (h < 15/360 || h >= 345/360) return 'reds';
  if (h < 45/360) return 'oranges';
  if (h < 90/360) return 'yellows';
  if (h < 150/360) return 'greens';
  if (h < 210/360) return 'aquas';
  if (h < 262.5/360) return 'blues'; // Midpoint between 240 and 285
  if (h < 300/360) return 'purples'; // Midpoint between 285 and 315
  return 'magentas';
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rL = r / 255; let gL = g / 255; let bL = b / 255;
  rL = rL > 0.04045 ? Math.pow((rL + 0.055) / 1.055, 2.4) : rL / 12.92;
  gL = gL > 0.04045 ? Math.pow((gL + 0.055) / 1.055, 2.4) : gL / 12.92;
  bL = bL > 0.04045 ? Math.pow((bL + 0.055) / 1.055, 2.4) : bL / 12.92;

  let x = (rL * 0.4124 + gL * 0.3576 + bL * 0.1805) / 0.95047;
  let y = (rL * 0.2126 + gL * 0.7152 + bL * 0.0722) / 1.00000;
  let z = (rL * 0.0193 + gL * 0.1192 + bL * 0.9505) / 1.08883;

  x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
  y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
  z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;

  return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
}

function labToRgb(l: number, a: number, b: number): [number, number, number] {
  let y = (l + 16) / 116;
  let x = a / 500 + y;
  let z = y - b / 200;

  let x3 = x * x * x; let y3 = y * y * y; let z3 = z * z * z;

  x = ((x3 > 0.008856) ? x3 : (x - 16/116) / 7.787) * 0.95047;
  y = ((y3 > 0.008856) ? y3 : (y - 16/116) / 7.787) * 1.00000;
  z = ((z3 > 0.008856) ? z3 : (z - 16/116) / 7.787) * 1.08883;

  let rOut = x *  3.2406 + y * -1.5372 + z * -0.4986;
  let gOut = x * -0.9689 + y *  1.8758 + z *  0.0415;
  let bOut = x *  0.0557 + y * -0.2040 + z *  1.0570;

  rOut = rOut > 0.0031308 ? 1.055 * Math.pow(rOut, 1/2.4) - 0.055 : 12.92 * rOut;
  gOut = gOut > 0.0031308 ? 1.055 * Math.pow(gOut, 1/2.4) - 0.055 : 12.92 * gOut;
  bOut = bOut > 0.0031308 ? 1.055 * Math.pow(bOut, 1/2.4) - 0.055 : 12.92 * bOut;

  return [
    Math.max(0, Math.min(255, rOut * 255)),
    Math.max(0, Math.min(255, gOut * 255)),
    Math.max(0, Math.min(255, bOut * 255))
  ];
}

export function calculateLabStats(imageData: Uint8ClampedArray, step: number = 4): LabStats {
  let lSum = 0, aSum = 0, bSum = 0;
  let satSum = 0;
  let numPixels = 0;
  
  let shadowASum = 0, shadowBSum = 0, shadowCount = 0;
  let midtoneASum = 0, midtoneBSum = 0, midtoneCount = 0;
  let highlightASum = 0, highlightBSum = 0, highlightCount = 0;
  
  let foliageASum = 0, foliageBSum = 0, foliageLSum = 0, foliageCount = 0;
  
  const lHist = new Int32Array(101);
  
  // First pass: Calculate means and zone stats
  for (let i = 0; i < imageData.length; i += step) {
    const r = imageData[i];
    const g = imageData[i+1];
    const b = imageData[i+2];
    const [l, a, labB] = rgbToLab(r, g, b);
    const { h, s, l: hslL } = rgbToHsl(r, g, b);
    
    lSum += l;
    aSum += a;
    bSum += labB;
    satSum += Math.sqrt(a * a + labB * labB);
    numPixels++;
    
    lHist[Math.max(0, Math.min(100, Math.round(l)))]++;
    
    if (l < 33) {
      shadowASum += a; shadowBSum += labB; shadowCount++;
    } else if (l > 66) {
      highlightASum += a; highlightBSum += labB; highlightCount++;
    } else {
      midtoneASum += a; midtoneBSum += labB; midtoneCount++;
    }
    
    const hueDeg = h * 360;
    if (hueDeg >= 40 && hueDeg <= 160 && s > 0.1) {
      foliageASum += a; foliageBSum += labB; foliageLSum += l; foliageCount++;
    }
  }
  
  const lMean = lSum / numPixels;
  const aMean = aSum / numPixels;
  const bMean = bSum / numPixels;
  const satMean = satSum / numPixels;
  
  let lMin = 0, lMax = 100;
  let count = 0;
  const targetMin = numPixels * 0.01;
  const targetMax = numPixels * 0.99;
  for (let i = 0; i <= 100; i++) {
    count += lHist[i];
    if (count >= targetMin && lMin === 0) lMin = i;
    if (count >= targetMax && lMax === 100) { lMax = i; break; }
  }
  if (lMin === 0 && lHist[0] < targetMin) lMin = 0; // fallback
  
  // Second pass: Calculate standard deviations
  let lSqDiff = 0, aSqDiff = 0, bSqDiff = 0;
  for (let i = 0; i < imageData.length; i += step) {
    const [l, a, labB] = rgbToLab(imageData[i], imageData[i+1], imageData[i+2]);
    lSqDiff += (l - lMean) * (l - lMean);
    aSqDiff += (a - aMean) * (a - aMean);
    bSqDiff += (labB - bMean) * (labB - bMean);
  }
  
  return {
    lMean,
    lStd: Math.sqrt(lSqDiff / numPixels),
    aMean,
    aStd: Math.sqrt(aSqDiff / numPixels),
    bMean,
    bStd: Math.sqrt(bSqDiff / numPixels),
    satMean,
    shadowA: shadowCount > 0 ? shadowASum / shadowCount : aMean,
    shadowB: shadowCount > 0 ? shadowBSum / shadowCount : bMean,
    midtoneA: midtoneCount > 0 ? midtoneASum / midtoneCount : aMean,
    midtoneB: midtoneCount > 0 ? midtoneBSum / midtoneCount : bMean,
    highlightA: highlightCount > 0 ? highlightASum / highlightCount : aMean,
    highlightB: highlightCount > 0 ? highlightBSum / highlightCount : bMean,
    lMin,
    lMax,
    foliageA: foliageCount > 0 ? foliageASum / foliageCount : aMean,
    foliageB: foliageCount > 0 ? foliageBSum / foliageCount : bMean,
    foliageL: foliageCount > 0 ? foliageLSum / foliageCount : lMean,
    foliageCount
  };
}

export function exportAsCubeLUT(
  size: number,
  adjustments: Adjustments,
  levels: any,
  refStats?: LabStats | null,
  srcStats?: LabStats | null
): string {
  const numPixels = size * size * size;
  const data = new Uint8ClampedArray(numPixels * 4);
  
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[i * 4] = Math.round((r / (size - 1)) * 255);
        data[i * 4 + 1] = Math.round((g / (size - 1)) * 255);
        data[i * 4 + 2] = Math.round((b / (size - 1)) * 255);
        data[i * 4 + 3] = 255;
        i++;
      }
    }
  }

  const lutAdjustments = { ...adjustments, vignette: 0 };
  
  const processedImageData = processImageData(data, numPixels, 1, lutAdjustments, levels, refStats, srcStats);
  const processedData = processedImageData.data.data;
  
  let cube = `TITLE "Exported Color Match LUT"\nLUT_3D_SIZE ${size}\n\n`;
  for (let j = 0; j < numPixels; j++) {
    const r = (processedData[j * 4] / 255).toFixed(6);
    const g = (processedData[j * 4 + 1] / 255).toFixed(6);
    const b = (processedData[j * 4 + 2] / 255).toFixed(6);
    cube += `${r} ${g} ${b}\n`;
  }
  
  return cube;
}

export function processImageData(
  srcData: Uint8ClampedArray,
  width: number,
  height: number,
  adjustments: Adjustments,
  levels: any,
  refStats?: LabStats | null,
  srcStats?: LabStats | null
): { data: ImageData, srcStats: LabStats | null } {
  const dstImageData = new ImageData(width, height);
  const dstData = dstImageData.data;
  const { filmType, autoMask, exposure, temperature, tint, contrast, saturation, rOffset, gOffset, bOffset, shadows, highlights, whites, blacks, gamma, vignette } = adjustments;

  const isNeg = filmType === 'color_neg' || filmType === 'bw_neg' || filmType === 'log';
  const isBW = filmType === 'bw_neg';

  const c = contrast;
  const contrastFactor = (259 * (c + 255)) / (255 * (259 - c));
  const satMult = 1 + (saturation / 100);
  const expMult = Math.pow(2, exposure / 50);

  const shadowFactor = shadows / 100;
  const highlightFactor = highlights / 100;
  const whiteFactor = whites / 100;
  const blackFactor = blacks / 100;
  const gammaValue = gamma / 100;

  const vigAmount = vignette / 100;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

  // HSL Precomputation
  const hsl = adjustments.hsl;
  const hasHsl = hsl && Object.values(hsl).some(c => c.h !== 0 || c.s !== 0 || c.l !== 0);
  let hslCenters: { h: number, adj: { h: number, s: number, l: number } }[] = [];
  if (hasHsl && hsl) {
    hslCenters = [
      { h: 0, adj: hsl.reds },
      { h: 30/360, adj: hsl.oranges },
      { h: 60/360, adj: hsl.yellows },
      { h: 120/360, adj: hsl.greens },
      { h: 180/360, adj: hsl.aquas },
      { h: 240/360, adj: hsl.blues },
      { h: 285/360, adj: hsl.purples },
      { h: 315/360, adj: hsl.magentas },
      { h: 1, adj: hsl.reds }
    ];
  }

  const applyLogCurve = (v: number) => {
    let x = v / 255;
    if (x > 0.010591) {
      x = 0.244161 * Math.log2(5.555556 * x + 0.052272) + 0.385537;
    } else {
      x = 5.367655 * x + 0.092809;
    }
    return Math.max(0, Math.min(1, x)) * 255;
  };

  const applyBasic = (val: number) => {
    let v = Math.max(0, Math.min(1, val / 255));
    
    // Gamma
    if (gammaValue !== 1 && v > 0) {
      v = Math.pow(v, 1 / gammaValue);
    }

    // Blacks & Whites (Linear stretch at ends)
    if (blackFactor !== 0) {
      v = v + blackFactor * (1 - v) * (1 - Math.pow(v, 0.5));
    }
    if (whiteFactor !== 0) {
      v = v + whiteFactor * v * (1 - Math.pow(1 - v, 0.5));
    }

    // Shadows & Highlights (Curve-like)
    if (shadowFactor !== 0) {
      v = v + shadowFactor * Math.pow(1 - v, 3) * v;
    }
    if (highlightFactor !== 0) {
      v = v + highlightFactor * Math.pow(v, 3) * (1 - v);
    }

    return v * 255;
  };

  const applyBaseAdjustments = (rIn: number, gIn: number, bIn: number): [number, number, number] => {
    let r = rIn, g = gIn, b = bIn;
    // 1. Invert
    if (isNeg) {
      r = 255 - r; g = 255 - g; b = 255 - b;
    }
    // 2. Auto Mask
    if (autoMask && levels) {
      const deMask = (v: number, low: number, high: number) => {
        const range = high - low;
        if (range <= 0) return v;
        let norm = (v - low) / range;
        norm = Math.max(0, Math.min(1, norm));
        return Math.pow(norm, 0.85) * 255;
      };
      r = deMask(r, levels.r.low, levels.r.high);
      g = deMask(g, levels.g.low, levels.g.high);
      b = deMask(b, levels.b.low, levels.b.high);
    }
    // 3. Exposure & RGB Offsets
    r = r * expMult + rOffset;
    g = g * expMult + gOffset;
    b = b * expMult + bOffset;
    // 4. White Balance
    r += temperature; b -= temperature;
    g += tint; r -= tint / 2; b -= tint / 2;
    // 5. Contrast
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;
    // 6. Basic Adjustments
    r = applyBasic(r); g = applyBasic(g); b = applyBasic(b);
    return [
      Math.max(0, Math.min(255, r)),
      Math.max(0, Math.min(255, g)),
      Math.max(0, Math.min(255, b))
    ];
  };

  let computedSrcStats: LabStats | null = srcStats || null;
  if (adjustments.colorMatchEnabled && refStats && !computedSrcStats) {
    const step = Math.max(4, Math.floor(srcData.length / 40000) * 4);
    
    // Create a temporary array to hold the base-adjusted image data
    const tempImageData = new Uint8ClampedArray(srcData.length);
    for (let i = 0; i < srcData.length; i += 4) {
      const [r, g, b] = applyBaseAdjustments(srcData[i], srcData[i+1], srcData[i+2]);
      tempImageData[i] = r;
      tempImageData[i+1] = g;
      tempImageData[i+2] = b;
      tempImageData[i+3] = srcData[i+3];
    }
    
    computedSrcStats = calculateLabStats(tempImageData, step);
  }

  for (let i = 0; i < srcData.length; i += 4) {
    let [r, g, b] = applyBaseAdjustments(srcData[i], srcData[i + 1], srcData[i + 2]);

    // Color Match (Color Grading Transfer)
    if (adjustments.colorMatchEnabled && refStats && computedSrcStats) {
      const intensity = adjustments.colorMatchIntensity / 100;
      const satIntensity = adjustments.colorMatchSaturation / 100;
      
      const [origL, origA, origB] = rgbToLab(r, g, b);
      const { h, s, l: hslL } = rgbToHsl(r, g, b);
      const hueDeg = h * 360;
      
      // 1. Tone Matching (Black Point, Exposure, and Contrast)
      let newL = origL;
      if (computedSrcStats.lMax > computedSrcStats.lMin) {
         let lNorm = (origL - computedSrcStats.lMin) / (computedSrcStats.lMax - computedSrcStats.lMin);
         lNorm = Math.max(0, Math.min(1, lNorm));
         
         // Apply a subtle S-curve to the normalized lightness to improve contrast
         // Blend between linear and S-curve based on standard deviation differences
         const contrastRatio = Math.max(0.5, Math.min(2.0, refStats.lStd / computedSrcStats.lStd));
         const curveWeight = Math.max(0, Math.min(1, (contrastRatio - 1) * 1.5)); // Use S-curve if ref has higher contrast
         
         if (curveWeight > 0) {
             const sCurve = lNorm < 0.5 ? 2 * lNorm * lNorm : 1 - Math.pow(-2 * lNorm + 2, 2) / 2;
             lNorm = lNorm * (1 - curveWeight) + sCurve * curveWeight;
         }
         
         newL = refStats.lMin + lNorm * (refStats.lMax - refStats.lMin);
      }
      
      // Global exposure boost / midtone lift
      const lShift = refStats.lMean - computedSrcStats.lMean;
      const lMidtoneWeight = Math.max(0, 1 - Math.abs(newL - 50) / 50); 
      newL = newL + lShift * lMidtoneWeight * 0.8;
      
      // 2. Color (a, b) Transfer by Luminance Zones with Highlight/Shadow Protection
      const wS = Math.max(0, 1 - origL / 40); 
      const wH = Math.max(0, (origL - 60) / 40); 
      const wM = Math.max(0, 1 - wS - wH);
      
      // Protect extreme highlights and shadows from color casts (Neutral Protection)
      const colorRollOff = Math.min(1, origL / 15) * Math.min(1, (100 - origL) / 15);
      
      const shiftA_S = (refStats.shadowA - computedSrcStats.shadowA) * colorRollOff;
      const shiftB_S = (refStats.shadowB - computedSrcStats.shadowB) * colorRollOff;
      const shiftA_M = (refStats.midtoneA - computedSrcStats.midtoneA) * colorRollOff;
      const shiftB_M = (refStats.midtoneB - computedSrcStats.midtoneB) * colorRollOff;
      const shiftA_H = (refStats.highlightA - computedSrcStats.highlightA) * colorRollOff;
      const shiftB_H = (refStats.highlightB - computedSrcStats.highlightB) * colorRollOff;
      
      let newA = origA + (wS * shiftA_S + wM * shiftA_M + wH * shiftA_H);
      let newB = origB + (wS * shiftB_S + wM * shiftB_M + wH * shiftB_H);
      
      // 3. Targeted HSL (Foliage/Environment)
      if (refStats.foliageCount > 0) {
         let hw = 0;
         if (hueDeg >= 30 && hueDeg <= 170) {
             hw = Math.sin(((Math.min(Math.max(hueDeg, 30), 170) - 30) / 140) * Math.PI);
         }
         let sw = Math.min(1, Math.max(0, (s - 0.02) / 0.08));
         const fWeight = hw * sw;
         
         if (fWeight > 0) {
             newA = newA * (1 - fWeight) + refStats.foliageA * fWeight;
             newB = newB * (1 - fWeight) + refStats.foliageB * fWeight;
             if (refStats.foliageL > computedSrcStats.foliageL) {
                 newL = newL * (1 - fWeight) + Math.max(newL, refStats.foliageL) * fWeight;
             }
         }
      }
      
      // 4. Vibrance / Smart Saturation Transfer
      if (computedSrcStats.satMean > 0) {
        const satRatio = Math.max(0.6, Math.min(1.5, refStats.satMean / computedSrcStats.satMean));
        // Vibrance: apply less saturation boost to already saturated pixels
        const currentSat = Math.sqrt(newA * newA + newB * newB);
        const satWeight = satRatio > 1 ? Math.max(0, 1 - currentSat / 100) : 1;
        const finalSatRatio = 1 + (satRatio - 1) * satWeight;
        
        newA *= finalSatRatio;
        newB *= finalSatRatio;
      }
      
      // 5. Semantic Skin Tone Protection
      let hueDist = Math.abs(hueDeg - 25);
      if (hueDist > 180) hueDist = 360 - hueDist;
      let skinWeight = 0;
      if (hueDist < 40) {
         const hw = Math.max(0, 1 - hueDist / 40);
         let sw = 0;
         if (s > 0.1 && s < 0.8) {
             sw = Math.sin(((s - 0.1) / 0.7) * Math.PI);
         }
         let lw = 0;
         if (hslL > 0.15 && hslL < 0.95) {
             lw = Math.sin(((hslL - 0.15) / 0.8) * Math.PI);
         }
         skinWeight = hw * sw * lw * 0.9; // Max 90% protection for color
      }
      
      if (skinWeight > 0) {
          // Protect color heavily, but allow lightness to be driven by the tone curve
          // This ensures the face gets properly exposed/contrasted while keeping its natural hue
          newA = newA * (1 - skinWeight) + origA * skinWeight;
          newB = newB * (1 - skinWeight) + origB * skinWeight;
          // Only 20% protection on lightness to allow exposure matching
          newL = newL * (1 - skinWeight * 0.2) + origL * (skinWeight * 0.2);
      }
      
      // Blend based on intensity sliders
      newL = origL * (1 - intensity) + newL * intensity;
      newA = origA * (1 - satIntensity) + newA * satIntensity;
      newB = origB * (1 - satIntensity) + newB * satIntensity;
      
      // Clamp LAB values
      newL = Math.max(0, Math.min(100, newL));
      newA = Math.max(-128, Math.min(127, newA));
      newB = Math.max(-128, Math.min(127, newB));
      
      const [mr, mg, mb] = labToRgb(newL, newA, newB);
      r = mr; g = mg; b = mb;
    }
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));

    // 6.5 HSL Adjustments
    if (hasHsl) {
      let rNorm = r / 255;
      let gNorm = g / 255;
      let bNorm = b / 255;
      let max = Math.max(rNorm, gNorm, bNorm);
      let min = Math.min(rNorm, gNorm, bNorm);
      let h = 0, s = 0, l = (max + min) / 2;

      if (max !== min) {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rNorm) {
          h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        } else if (max === gNorm) {
          h = (bNorm - rNorm) / d + 2;
        } else {
          h = (rNorm - gNorm) / d + 4;
        }
        h /= 6;
      }

      if (s > 0) {
        let shiftH = 0, shiftS = 0, shiftL = 0;
        for (let j = 0; j < 8; j++) {
          if (h >= hslCenters[j].h && h <= hslCenters[j+1].h) {
            const range = hslCenters[j+1].h - hslCenters[j].h;
            const t = (h - hslCenters[j].h) / range;
            const smoothT = t * t * (3 - 2 * t);
            const w1 = 1 - smoothT;
            const w2 = smoothT;
            
            const adj1 = hslCenters[j].adj;
            const adj2 = hslCenters[j+1].adj;
            
            shiftH = adj1.h * w1 + adj2.h * w2;
            shiftS = adj1.s * w1 + adj2.s * w2;
            shiftL = adj1.l * w1 + adj2.l * w2;
            break;
          }
        }

        h = (h + (shiftH / 100) * 0.08333 + 1) % 1;
        s = Math.max(0, Math.min(1, s * (1 + shiftS / 100)));
        if (shiftL > 0) {
          l = l + (1 - l) * (shiftL / 100);
        } else {
          l = l + l * (shiftL / 100);
        }

        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3) * 255;
        g = hue2rgb(p, q, h) * 255;
        b = hue2rgb(p, q, h - 1/3) * 255;
      }
    }

    // 7. Saturation & B&W
    if (isBW) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = lum;
    } else if (saturation !== 0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + satMult * (r - lum);
      g = lum + satMult * (g - lum);
      b = lum + satMult * (b - lum);
    }

    // Apply Log Curve
    if (filmType === 'log') {
      r = applyLogCurve(r);
      g = applyLogCurve(g);
      b = applyLogCurve(b);
    }

    // 8. LUT
    const lutIntensity = adjustments.lutIntensity ?? 100;
    if (adjustments.lut && lutIntensity > 0) {
      const { size, data } = adjustments.lut;
      const intensity = lutIntensity / 100;

      // Map 0-255 to 0-(size-1)
      let rIdx = (r / 255) * (size - 1);
      let gIdx = (g / 255) * (size - 1);
      let bIdx = (b / 255) * (size - 1);

      rIdx = Math.max(0, Math.min(size - 1, rIdx));
      gIdx = Math.max(0, Math.min(size - 1, gIdx));
      bIdx = Math.max(0, Math.min(size - 1, bIdx));

      const r0 = Math.floor(rIdx);
      const r1 = Math.min(size - 1, r0 + 1);
      const g0 = Math.floor(gIdx);
      const g1 = Math.min(size - 1, g0 + 1);
      const b0 = Math.floor(bIdx);
      const b1 = Math.min(size - 1, b0 + 1);

      const rd = rIdx - r0;
      const gd = gIdx - g0;
      const bd = bIdx - b0;

      const getVal = (ri: number, gi: number, bi: number, channel: number) => {
        const idx = (bi * size * size + gi * size + ri) * 3 + channel;
        return data[idx];
      };

      const interpolate = (channel: number) => {
        const c000 = getVal(r0, g0, b0, channel);
        const c100 = getVal(r1, g0, b0, channel);
        const c010 = getVal(r0, g1, b0, channel);
        const c110 = getVal(r1, g1, b0, channel);
        const c001 = getVal(r0, g0, b1, channel);
        const c101 = getVal(r1, g0, b1, channel);
        const c011 = getVal(r0, g1, b1, channel);
        const c111 = getVal(r1, g1, b1, channel);

        const c00 = c000 * (1 - rd) + c100 * rd;
        const c01 = c001 * (1 - rd) + c101 * rd;
        const c10 = c010 * (1 - rd) + c110 * rd;
        const c11 = c011 * (1 - rd) + c111 * rd;

        const c0 = c00 * (1 - gd) + c10 * gd;
        const c1 = c01 * (1 - gd) + c11 * gd;

        return c0 * (1 - bd) + c1 * bd;
      };

      const lr = interpolate(0) * 255;
      const lg = interpolate(1) * 255;
      const lb = interpolate(2) * 255;

      r = r * (1 - intensity) + lr * intensity;
      g = g * (1 - intensity) + lg * intensity;
      b = b * (1 - intensity) + lb * intensity;
    }

    // 9. Color Balance
    const cb = adjustments.colorBalance;
    if (cb) {
      const oldLum = 0.299 * r + 0.587 * g + 0.114 * b;
      const lum = Math.max(0, Math.min(1, oldLum / 255));
      
      // Smoother weights using power curves
      const shadowWeight = Math.pow(Math.max(0, 1 - lum * 1.5), 1.5);
      const highlightWeight = Math.pow(Math.max(0, (lum - 0.33) * 1.5), 1.5);
      const midtoneWeight = Math.max(0, 1 - shadowWeight - highlightWeight);
      
      r += cb.shadows.r * shadowWeight + cb.midtones.r * midtoneWeight + cb.highlights.r * highlightWeight;
      g += cb.shadows.g * shadowWeight + cb.midtones.g * midtoneWeight + cb.highlights.g * highlightWeight;
      b += cb.shadows.b * shadowWeight + cb.midtones.b * midtoneWeight + cb.highlights.b * highlightWeight;

      if (cb.preserveLuminosity) {
        const newLum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (newLum > 0 && oldLum > 0) {
          const scale = oldLum / newLum;
          r *= scale;
          g *= scale;
          b *= scale;
        }
      }
    }

    // 9.5 Vignette
    if (vigAmount !== 0) {
      const idx = i / 4;
      const px = idx % width;
      const py = Math.floor(idx / width);
      const dx = px - centerX;
      const dy = py - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      
      // Subtle vignette curve: 1 - dist^2 * amount
      // amount > 0: darken edges
      // amount < 0: lighten edges
      const v = 1 - (dist * dist * vigAmount);
      r *= v;
      g *= v;
      b *= v;
    }

    // Final clamp
    dstData[i] = Math.max(0, Math.min(255, r));
    dstData[i + 1] = Math.max(0, Math.min(255, g));
    dstData[i + 2] = Math.max(0, Math.min(255, b));
    dstData[i + 3] = srcData[i + 3];
  }

  // 10. Spatial Effects (Sharpen, Clarity, Noise Reduction, Halation)
  if (adjustments.sharpen > 0 || adjustments.clarity !== 0 || adjustments.colorNoiseReduction > 0 || adjustments.luminanceNoiseReduction > 0 || adjustments.halationIntensity > 0) {
    const tempData = new Uint8ClampedArray(dstData);
    const sharpenK = adjustments.sharpen / 100;
    const clarityK = adjustments.clarity / 100;
    const chromaNrK = (adjustments.colorNoiseReduction || 0) / 100;
    const lumNrK = (adjustments.luminanceNoiseReduction || 0) / 100;
    const halIntensity = adjustments.halationIntensity / 100;
    const halRadius = Math.max(1, Math.round(adjustments.halationRadius));
    const halThreshold = adjustments.halationThreshold;

    // Precompute Bilateral Filter Weights
    const radius = 2;
    const spatialWeights = new Float32Array(25);
    let sIdx = 0;
    for (let ky = -radius; ky <= radius; ky++) {
      for (let kx = -radius; kx <= radius; kx++) {
        spatialWeights[sIdx++] = Math.exp(-(kx * kx + ky * ky) / 8.0);
      }
    }

    const lumWeights = new Float32Array(256);
    const chromaWeights = new Float32Array(256);
    
    if (lumNrK > 0) {
      const lumSigma = 5 + (lumNrK * 25); // 5 to 30
      for (let i = 0; i < 256; i++) {
        lumWeights[i] = Math.exp(-(i * i) / (2 * lumSigma * lumSigma));
      }
    }
    
    if (chromaNrK > 0) {
      const chromaSigma = 10 + (chromaNrK * 40); // 10 to 50
      for (let i = 0; i < 256; i++) {
        chromaWeights[i] = Math.exp(-(i * i) / (2 * chromaSigma * chromaSigma));
      }
    }

    // Halation Pre-pass: Extract highlights with soft thresholding
    let coreMap: Float32Array | null = null;
    let midMap: Float32Array | null = null;
    let largeMap: Float32Array | null = null;

    if (halIntensity > 0) {
      const halMap = new Float32Array(width * height * 3);
      for (let i = 0; i < tempData.length; i += 4) {
        const r = tempData[i], g = tempData[i + 1], b = tempData[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        
        // Dynamic Highlight Extraction
        // Only extract very bright areas to prevent red washing over the whole image
        let weight = 0;
        const softThreshold = Math.max(0, halThreshold - 30); 
        if (lum > softThreshold) {
          const range = 255 - softThreshold;
          if (range > 0) {
            const normalized = Math.min(1, (lum - softThreshold) / range);
            // Steeper power curve so it only really kicks in at the very top
            weight = Math.pow(normalized, 2.0);
          } else {
            weight = 1.0;
          }
        }
        
        if (weight > 0) {
          const idx = (i / 4) * 3;
          // Extract color information for the glow
          halMap[idx] = r * weight;
          halMap[idx + 1] = g * weight;
          halMap[idx + 2] = b * weight;
        }
      }

      // Multilayer Bloom: Generate 3 layers of blur
      const scale = Math.max(width, height) / 1000;
      const baseRadius = Math.max(1, halRadius * scale);
      
      // 3 passes of box blur approximates a true Gaussian blur very well.
      const radii = [
        Math.max(1, Math.round(baseRadius * 0.5)), // Core Glow (small)
        Math.max(1, Math.round(baseRadius * 1.5)), // Red Halation Fringe (medium)
        Math.max(2, Math.round(baseRadius * 3.0))  // Diffused Bloom (large)
      ];

      let currentMap = new Float32Array(halMap);
      const tempMap = new Float32Array(width * height * 3);
      const nextMap = new Float32Array(width * height * 3);
      
      for (let p = 0; p < 3; p++) {
        const passRadius = radii[p];
        
        // 3 passes of box blur per layer for a high-quality Gaussian approximation
        applyBoxBlur(currentMap, nextMap, tempMap, width, height, passRadius);
        applyBoxBlur(nextMap, currentMap, tempMap, width, height, passRadius);
        applyBoxBlur(currentMap, nextMap, tempMap, width, height, passRadius);
        
        // After 3 passes, the result is in nextMap
        if (p === 0) coreMap = new Float32Array(nextMap);
        if (p === 1) midMap = new Float32Array(nextMap);
        if (p === 2) largeMap = new Float32Array(nextMap);
        
        // Compound the blur: next layer starts from the current blurred state
        currentMap.set(nextMap);
      }
    }

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        
        // Apply Halation (Multilayer, Chromatic, Mixed Blending)
        if (coreMap && midMap && largeMap) {
          const hIdx = (y * width + x) * 3;
          
          const rCore = coreMap[hIdx], gCore = coreMap[hIdx + 1], bCore = coreMap[hIdx + 2];
          const rMid = midMap[hIdx], gMid = midMap[hIdx + 1], bMid = midMap[hIdx + 2];
          const rLarge = largeMap[hIdx], gLarge = largeMap[hIdx + 1], bLarge = largeMap[hIdx + 2];
          
          // Screen blend mode helper
          const blendScreen = (base: number, blend: number) => {
             const b = Math.max(0, Math.min(255, blend));
             return 255 - ((255 - base) * (255 - b)) / 255;
          };
          
          // Linear Dodge (Add) helper
          const blendAdd = (base: number, blend: number) => {
             return Math.min(255, base + blend);
          };

          // 1. Core Glow: Screen mode, keeps original color
          const coreIntensity = halIntensity * 0.6;
          let r = blendScreen(dstData[i], rCore * coreIntensity);
          let g = blendScreen(dstData[i + 1], gCore * coreIntensity);
          let b = blendScreen(dstData[i + 2], bCore * coreIntensity);
          
          // 2. Red Halation Fringe (Mid map): Add mode, pure red/orange
          // This creates the tight red edge around highlights
          const midIntensity = halIntensity * 1.2;
          const midLum = (rMid * 0.299 + gMid * 0.587 + bMid * 0.114);
          r = blendAdd(r, midLum * midIntensity * 2.0);
          g = blendAdd(g, midLum * midIntensity * 0.1); 
          b = blendAdd(b, 0); 
          
          // 3. Diffused Bloom (Large map): Soft overall glow, slightly warm but mostly neutral
          const largeIntensity = halIntensity * 0.4;
          const largeLum = (rLarge * 0.299 + gLarge * 0.587 + bLarge * 0.114);
          r = blendScreen(r, largeLum * largeIntensity * 1.2);
          g = blendScreen(g, largeLum * largeIntensity * 1.0);
          b = blendScreen(b, largeLum * largeIntensity * 0.8); 
          
          dstData[i] = r;
          dstData[i + 1] = g;
          dstData[i + 2] = b;
        }

        // Simple 3x3 Sharpening & Clarity
        if (sharpenK > 0 || clarityK !== 0) {
          // Kernel for sharpening: [0, -1, 0], [-1, 5, -1], [0, -1, 0]
          // We'll use a weighted average of neighbors
          let sumR = 0, sumG = 0, sumB = 0;
          const neighbors = [
            ((y - 1) * width + x) * 4,
            ((y + 1) * width + x) * 4,
            (y * width + (x - 1)) * 4,
            (y * width + (x + 1)) * 4
          ];
          
          for (const ni of neighbors) {
            sumR += tempData[ni];
            sumG += tempData[ni + 1];
            sumB += tempData[ni + 2];
          }
          
          const avgR = sumR / 4;
          const avgG = sumG / 4;
          const avgB = sumB / 4;

          // Sharpening: boost difference from local average
          if (sharpenK > 0) {
            dstData[i] += (dstData[i] - avgR) * sharpenK * 2;
            dstData[i + 1] += (dstData[i + 1] - avgG) * sharpenK * 2;
            dstData[i + 2] += (dstData[i + 2] - avgB) * sharpenK * 2;
          }

          // Clarity: local contrast enhancement (mid-tone boost)
          if (clarityK !== 0) {
            const lum = (0.299 * dstData[i] + 0.587 * dstData[i + 1] + 0.114 * dstData[i + 2]) / 255;
            const midtoneWeight = Math.pow(Math.sin(lum * Math.PI), 2); // Peak at 0.5
            const diffR = dstData[i] - avgR;
            const diffG = dstData[i + 1] - avgG;
            const diffB = dstData[i + 2] - avgB;
            
            dstData[i] += diffR * clarityK * midtoneWeight * 1.5;
            dstData[i + 1] += diffG * clarityK * midtoneWeight * 1.5;
            dstData[i + 2] += diffB * clarityK * midtoneWeight * 1.5;
          }
        }

        // Advanced Noise Reduction (Capture One style Edge-Aware Bilateral Filter)
        if (chromaNrK > 0 || lumNrK > 0) {
          const r = dstData[i], g = dstData[i + 1], b = dstData[i + 2];
          const yVal = 0.299 * r + 0.587 * g + 0.114 * b;
          const u = -0.14713 * r - 0.28886 * g + 0.436 * b;
          const v = 0.615 * r - 0.51499 * g - 0.10001 * b;

          let sumY = 0, sumU = 0, sumV = 0;
          let weightSumY = 0, weightSumC = 0;
          
          // 5x5 Edge-Aware Bilateral Filter
          let wIdx = 0;
          for (let ky = -radius; ky <= radius; ky++) {
            for (let kx = -radius; kx <= radius; kx++) {
              const ny = Math.max(0, Math.min(height - 1, y + ky));
              const nx = Math.max(0, Math.min(width - 1, x + kx));
              const ni = (ny * width + nx) * 4;
              
              const nr = tempData[ni], ng = tempData[ni + 1], nb = tempData[ni + 2];
              const nyVal = 0.299 * nr + 0.587 * ng + 0.114 * nb;
              
              const lumDiff = Math.min(255, Math.floor(Math.abs(yVal - nyVal)));
              const spatialWeight = spatialWeights[wIdx++];
              
              // Range weight (Luminance difference)
              // Luminance NR: preserve edges strongly.
              if (lumNrK > 0) {
                const weightY = spatialWeight * lumWeights[lumDiff];
                sumY += nyVal * weightY;
                weightSumY += weightY;
              }
              
              // Chroma NR: can be more aggressive, color bleeds less noticeably
              if (chromaNrK > 0) {
                const weightC = spatialWeight * chromaWeights[lumDiff];
                
                const nu = -0.14713 * nr - 0.28886 * ng + 0.436 * nb;
                const nv = 0.615 * nr - 0.51499 * ng - 0.10001 * nb;
                sumU += nu * weightC;
                sumV += nv * weightC;
                weightSumC += weightC;
              }
            }
          }

          const finalY = lumNrK > 0 ? (sumY / weightSumY) * lumNrK + yVal * (1 - lumNrK) : yVal;
          const finalU = chromaNrK > 0 ? (sumU / weightSumC) * chromaNrK + u * (1 - chromaNrK) : u;
          const finalV = chromaNrK > 0 ? (sumV / weightSumC) * chromaNrK + v * (1 - chromaNrK) : v;

          // Back to RGB
          dstData[i] = finalY + 1.13983 * finalV;
          dstData[i + 1] = finalY - 0.39465 * finalU - 0.5806 * finalV;
          dstData[i + 2] = finalY + 2.03211 * finalU;
        }

        // Final clamp for spatial effects
        dstData[i] = Math.max(0, Math.min(255, dstData[i]));
        dstData[i + 1] = Math.max(0, Math.min(255, dstData[i + 1]));
        dstData[i + 2] = Math.max(0, Math.min(255, dstData[i + 2]));
      }
    }
  }

  return { data: dstImageData, srcStats: computedSrcStats };
}
