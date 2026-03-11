import { Adjustments } from '../types';

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
  
  // For negatives, the "low" percentile represents the film base (mask).
  // We use a slightly more aggressive clip to ensure we fully subtract the mask.
  const clipLow = isNeg ? 0.01 : 0.005; 
  const clipHigh = isNeg ? 0.005 : 0.005;
  
  const targetLow = totalPixels * clipLow;
  const targetHigh = totalPixels * (1 - clipHigh);

  const getPercentile = (hist: Int32Array) => {
    let low = 0;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += hist[i];
      if (sum >= targetLow) {
        low = i;
        break;
      }
    }
    let high = 255;
    sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += hist[i];
      if (sum >= targetHigh) {
        high = i;
        break;
      }
    }
    if (high <= low) high = low + 1;
    return { low, high };
  };

  const rLevels = getPercentile(histR);
  const gLevels = getPercentile(histG);
  const bLevels = getPercentile(histB);

  // OPTIMIZATION: Linked Highlights for Negatives
  if (isNeg) {
    const globalHigh = Math.max(rLevels.high, gLevels.high, bLevels.high);
    // Reduced blend to prevent the image from becoming too dark
    const blend = 0.3; 
    rLevels.high = Math.round(rLevels.high * (1 - blend) + globalHigh * blend);
    gLevels.high = Math.round(gLevels.high * (1 - blend) + globalHigh * blend);
    bLevels.high = Math.round(bLevels.high * (1 - blend) + globalHigh * blend);
  }

  return {
    r: rLevels,
    g: gLevels,
    b: bLevels
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
      r = ((r - levels.r.low) / (levels.r.high - levels.r.low)) * 255;
      g = ((g - levels.g.low) / (levels.g.high - levels.g.low)) * 255;
      b = ((b - levels.b.low) / (levels.b.high - levels.b.low)) * 255;
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

  // Target values for each channel
  let targetR = avg;
  let targetG = avg;
  let targetB = avg;

  // OPTIMIZATION: Specifically address the blue cast in film negatives
  if (isNeg && avgB > avgG * 1.02) {
    const blueExcess = (avgB - avgG) / avgG;
    // Reduce blue target more aggressively to counteract the cast
    targetB -= avg * blueExcess * 0.6; 
    // Slightly lift red to warm up the midtones
    targetR += avg * blueExcess * 0.2;
  }

  // 4. Limit the maximum correction to avoid destroying natural lighting (e.g., sunsets)
  const maxCorrection = 40;
  const clamp = (val: number) => Math.max(-maxCorrection, Math.min(maxCorrection, val));

  return {
    rOffset: clamp(Math.round(targetR - avgR)),
    gOffset: clamp(Math.round(targetG - avgG)),
    bOffset: clamp(Math.round(targetB - avgB))
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

export function processImageData(
  srcData: Uint8ClampedArray,
  width: number,
  height: number,
  adjustments: Adjustments,
  levels: any
) {
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

  const applyLogCurve = (v: number) => {
    let x = v / 255;
    // A more standard log curve (similar to LogC) that provides a better flat profile
    // Lifts shadows significantly and compresses highlights smoothly
    if (x > 0.010591) {
      x = 0.244161 * Math.log2(5.555556 * x + 0.052272) + 0.385537;
    } else {
      x = 5.367655 * x + 0.092809;
    }
    return Math.max(0, Math.min(1, x)) * 255;
  };

  for (let i = 0; i < srcData.length; i += 4) {
    let r = srcData[i];
    let g = srcData[i + 1];
    let b = srcData[i + 2];

    // 1. Invert (Improved Analog-style Inversion)
    if (isNeg) {
      // Use a power less than 1.0 to lift shadows and midtones for a brighter look
      const analogInvert = (v: number) => 255 * Math.pow(1 - v / 255, 0.95);
      r = analogInvert(r);
      g = analogInvert(g);
      b = analogInvert(b);
    }

    // 2. Auto Mask (Improved De-masking)
    if (autoMask && levels) {
      const deMask = (v: number, low: number, high: number) => {
        const range = high - low;
        if (range <= 0) return v;
        let norm = (v - low) / range;
        norm = Math.max(0, Math.min(1, norm));
        
        // Apply a mid-tone lift to prevent the image from being too dark
        // This is a common requirement for film negative inversion
        norm = Math.pow(norm, 0.85);

        const curved = (3 * norm * norm - 2 * norm * norm * norm);
        return (norm * 0.4 + curved * 0.6) * 255;
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
    r += temperature;
    b -= temperature;
    g += tint;
    r -= tint / 2;
    b -= tint / 2;

    // 5. Contrast
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    // 6. Basic Adjustments (Whites, Blacks, Shadows, Highlights, Gamma)
    const applyBasic = (val: number) => {
      let v = val / 255;
      
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
    r = applyBasic(r);
    g = applyBasic(g);
    b = applyBasic(b);

    // Clamp before saturation
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));

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

  // 10. Spatial Effects (Sharpen, Clarity, Color Noise Reduction, Halation)
  if (adjustments.sharpen > 0 || adjustments.clarity !== 0 || adjustments.colorNoiseReduction > 0 || adjustments.halationIntensity > 0) {
    const tempData = new Uint8ClampedArray(dstData);
    const sharpenK = adjustments.sharpen / 100;
    const clarityK = adjustments.clarity / 100;
    const nrK = adjustments.colorNoiseReduction / 100;
    const halIntensity = adjustments.halationIntensity / 100;
    const halRadius = Math.max(1, Math.round(adjustments.halationRadius));
    const halThreshold = adjustments.halationThreshold;

    // Halation Pre-pass: Extract highlights with soft thresholding
    let coreMap: Float32Array | null = null;
    let midMap: Float32Array | null = null;
    let largeMap: Float32Array | null = null;

    if (halIntensity > 0) {
      const halMap = new Float32Array(width * height * 3);
      for (let i = 0; i < tempData.length; i += 4) {
        const r = tempData[i], g = tempData[i + 1], b = tempData[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        
        // Dynamic Highlight Extension: smoother extraction to prevent hard edges
        let weight = 0;
        const softThreshold = Math.max(0, halThreshold - 50); // Even wider soft edge
        if (lum > softThreshold) {
          const range = 255 - softThreshold;
          if (range > 0) {
            const normalized = Math.min(1, (lum - softThreshold) / range);
            // Softer power curve so it spreads more naturally and continuously
            weight = Math.pow(normalized, 1.2);
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
      // We increase the radii significantly to get that wide, cinematic 800T diffusion.
      const radii = [
        Math.max(1, Math.round(baseRadius * 0.8)), // Core Glow (small)
        Math.max(2, Math.round(baseRadius * 2.5)), // Diffused Bloom (medium)
        Math.max(3, Math.round(baseRadius * 6.0))  // Large Halation (large)
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

          // 1. Core Glow: Screen mode, keeps original color but reduces green/blue to avoid washing out to white
          const coreIntensity = halIntensity * 0.7;
          let r = blendScreen(dstData[i], rCore * coreIntensity);
          let g = blendScreen(dstData[i + 1], gCore * coreIntensity * 0.6);
          let b = blendScreen(dstData[i + 2], bCore * coreIntensity * 0.3);
          
          // 2. Diffused Bloom: Add mode, Chromatic shift to rich orange
          const midIntensity = halIntensity * 0.9;
          const midLum = (rMid * 0.299 + gMid * 0.587 + bMid * 0.114);
          r = blendAdd(r, midLum * midIntensity * 2.2);
          g = blendAdd(g, midLum * midIntensity * 0.4); // Add some green for a richer orange transition
          b = blendAdd(b, midLum * midIntensity * 0.05); // Tiny bit of blue to prevent pure flatness
          
          // 3. Large Halation: Add mode, Chromatic shift to deep cinematic red
          const largeIntensity = halIntensity * 0.7;
          const largeLum = (rLarge * 0.299 + gLarge * 0.587 + bLarge * 0.114);
          r = blendAdd(r, largeLum * largeIntensity * 2.5);
          g = blendAdd(g, largeLum * largeIntensity * 0.05); // Almost pure red, tiny bit of green for depth
          b = blendAdd(b, 0); 
          
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

        // Color Noise Reduction (Edge-Aware Chroma Blur)
        if (nrK > 0) {
          const r = dstData[i], g = dstData[i + 1], b = dstData[i + 2];
          const yVal = 0.299 * r + 0.587 * g + 0.114 * b;
          const u = -0.14713 * r - 0.28886 * g + 0.436 * b;
          const v = 0.615 * r - 0.51499 * g - 0.10001 * b;

          let sumU = 0, sumV = 0, totalWeight = 0;
          
          // 3x3 Edge-Aware Chroma Blur
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const ni = ((y + ky) * width + (x + kx)) * 4;
              const nr = tempData[ni], ng = tempData[ni + 1], nb = tempData[ni + 2];
              const nyVal = 0.299 * nr + 0.587 * ng + 0.114 * nb;
              
              // Weight based on luminance difference (Edge-aware)
              // Pixels with similar luminance are likely part of the same object
              const lumDiff = Math.abs(yVal - nyVal);
              const weight = 1.0 / (1.0 + lumDiff * 0.2); 
              
              const nu = -0.14713 * nr - 0.28886 * ng + 0.436 * nb;
              const nv = 0.615 * nr - 0.51499 * ng - 0.10001 * nb;
              
              sumU += nu * weight;
              sumV += nv * weight;
              totalWeight += weight;
            }
          }

          const bu = sumU / totalWeight;
          const bv = sumV / totalWeight;

          // Blend original UV with blurred UV
          const finalU = u * (1 - nrK) + bu * nrK;
          const finalV = v * (1 - nrK) + bv * nrK;

          // Back to RGB
          dstData[i] = yVal + 1.13983 * finalV;
          dstData[i + 1] = yVal - 0.39465 * finalU - 0.5806 * finalV;
          dstData[i + 2] = yVal + 2.03211 * finalU;
        }

        // Final clamp for spatial effects
        dstData[i] = Math.max(0, Math.min(255, dstData[i]));
        dstData[i + 1] = Math.max(0, Math.min(255, dstData[i + 1]));
        dstData[i + 2] = Math.max(0, Math.min(255, dstData[i + 2]));
      }
    }
  }

  return dstImageData;
}
