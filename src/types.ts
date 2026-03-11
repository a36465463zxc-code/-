export type FilmType = 'color_neg' | 'bw_neg' | 'log' | 'positive';

export interface LUT3D {
  name: string;
  size: number;
  data: Float32Array;
}

export interface Adjustments {
  filmType: FilmType;
  autoMask: boolean;
  exposure: number;
  temperature: number;
  tint: number;
  contrast: number;
  saturation: number;
  rOffset: number;
  gOffset: number;
  bOffset: number;
  shadows: number;
  highlights: number;
  whites: number;
  blacks: number;
  gamma: number;
  rotation: number;
  lut: LUT3D | null;
  lutIntensity: number;
  colorBalance: {
    shadows: { r: number; g: number; b: number };
    midtones: { r: number; g: number; b: number };
    highlights: { r: number; g: number; b: number };
    preserveLuminosity: boolean;
  };
  sharpen: number;
  clarity: number;
  colorNoiseReduction: number;
  halationIntensity: number;
  halationRadius: number;
  halationThreshold: number;
  vignette: number;
}

export const defaultAdjustments: Adjustments = {
  filmType: 'color_neg',
  autoMask: true,
  exposure: 0,
  temperature: 0,
  tint: 0,
  contrast: 0,
  saturation: 0,
  rOffset: 0,
  gOffset: 0,
  bOffset: 0,
  shadows: 0,
  highlights: 0,
  whites: 0,
  blacks: 0,
  gamma: 100,
  rotation: 0,
  lut: null,
  lutIntensity: 100,
  colorBalance: {
    shadows: { r: 0, g: 0, b: 0 },
    midtones: { r: 0, g: 0, b: 0 },
    highlights: { r: 0, g: 0, b: 0 },
    preserveLuminosity: true,
  },
  sharpen: 0,
  clarity: 0,
  colorNoiseReduction: 0,
  halationIntensity: 0,
  halationRadius: 10,
  halationThreshold: 80,
  vignette: 0,
};

export interface ImageItem {
  id: string;
  name: string;
  src: string;
  adjustments: Adjustments;
  crop?: any;
  cropAspect?: number;
}
