import { Adjustments } from '../types';

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
  const clipLow = 0.005; // 0.5%
  const clipHigh = 0.005; // 0.5%
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

  return {
    r: getPercentile(histR),
    g: getPercentile(histG),
    b: getPercentile(histB)
  };
}

export function calculateAutoWhiteBalance(srcData: Uint8ClampedArray, isNeg: boolean, autoMask: boolean, levels: any) {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

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

    // Ignore extreme shadows and highlights for white balance calculation
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 20 && lum < 235) {
      sumR += r;
      sumG += g;
      sumB += b;
      count++;
    }
  }

  if (count === 0) return { rOffset: 0, gOffset: 0, bOffset: 0 };

  const avgR = sumR / count;
  const avgG = sumG / count;
  const avgB = sumB / count;
  const avg = (avgR + avgG + avgB) / 3;

  return {
    rOffset: Math.round(avg - avgR),
    gOffset: Math.round(avg - avgG),
    bOffset: Math.round(avg - avgB)
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
  const { filmType, autoMask, exposure, temperature, tint, contrast, saturation, rOffset, gOffset, bOffset, shadows, highlights, whites, blacks, gamma } = adjustments;

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

  const applyLogCurve = (v: number) => {
    let x = v / 255;
    // A log curve that lifts shadows and compresses highlights to create a "flat" gray film look
    const logBase = 20;
    x = Math.log(1 + logBase * x) / Math.log(1 + logBase);
    return x * 255;
  };

  for (let i = 0; i < srcData.length; i += 4) {
    let r = srcData[i];
    let g = srcData[i + 1];
    let b = srcData[i + 2];

    // 1. Invert
    if (isNeg) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    // 2. Auto Mask (Levels)
    if (autoMask && levels) {
      r = ((r - levels.r.low) / (levels.r.high - levels.r.low)) * 255;
      g = ((g - levels.g.low) / (levels.g.high - levels.g.low)) * 255;
      b = ((b - levels.b.low) / (levels.b.high - levels.b.low)) * 255;
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

    // Final clamp
    dstData[i] = Math.max(0, Math.min(255, r));
    dstData[i + 1] = Math.max(0, Math.min(255, g));
    dstData[i + 2] = Math.max(0, Math.min(255, b));
    dstData[i + 3] = srcData[i + 3];
  }

  // 10. Spatial Effects (Sharpen, Clarity, Color Noise Reduction)
  if (adjustments.sharpen > 0 || adjustments.clarity !== 0 || adjustments.colorNoiseReduction > 0) {
    const tempData = new Uint8ClampedArray(dstData);
    const sharpenK = adjustments.sharpen / 100;
    const clarityK = adjustments.clarity / 100;
    const nrK = adjustments.colorNoiseReduction / 100;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        
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

        // Color Noise Reduction (Chroma Blur)
        if (nrK > 0) {
          let sumR = 0, sumG = 0, sumB = 0;
          // 3x3 box blur for chroma
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const ni = ((y + ky) * width + (x + kx)) * 4;
              sumR += tempData[ni];
              sumG += tempData[ni + 1];
              sumB += tempData[ni + 2];
            }
          }
          const blurR = sumR / 9;
          const blurG = sumG / 9;
          const blurB = sumB / 9;

          // Convert to YUV-ish and apply blur only to UV
          const r = dstData[i], g = dstData[i + 1], b = dstData[i + 2];
          const yVal = 0.299 * r + 0.587 * g + 0.114 * b;
          const u = -0.14713 * r - 0.28886 * g + 0.436 * b;
          const v = 0.615 * r - 0.51499 * g - 0.10001 * b;

          const bu = -0.14713 * blurR - 0.28886 * blurG + 0.436 * blurB;
          const bv = 0.615 * blurR - 0.51499 * blurG - 0.10001 * blurB;

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
