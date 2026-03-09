import { Adjustments } from '../types';

export interface FilmPreset {
  id: string;
  name: string;
  description: string;
  adjustments: Partial<Adjustments>;
}

export const FILM_PRESETS: FilmPreset[] = [
  {
    id: 'portra-400',
    name: 'Kodak Portra 400',
    description: 'Warm, natural skin tones with soft contrast.',
    adjustments: {
      filmType: 'color_neg',
      temperature: 8,
      tint: 2,
      saturation: -5,
      contrast: 5,
      highlights: -5,
      shadows: 5
    }
  },
  {
    id: 'tri-x-400',
    name: 'Kodak Tri-X 400',
    description: 'Classic high-contrast black and white with deep blacks.',
    adjustments: {
      filmType: 'bw_neg',
      contrast: 25,
      shadows: -15,
      highlights: 10,
      exposure: 5
    }
  },
  {
    id: 'fuji-400h',
    name: 'Fujifilm Pro 400H',
    description: 'Cooler tones with a signature cyan/green shadow tint.',
    adjustments: {
      filmType: 'color_neg',
      temperature: -6,
      tint: 8,
      saturation: 4,
      contrast: -5,
      highlights: 5
    }
  },
  {
    id: 'gold-200',
    name: 'Kodak Gold 200',
    description: 'Warm, golden vintage look with high saturation.',
    adjustments: {
      filmType: 'color_neg',
      temperature: 12,
      tint: -2,
      saturation: 15,
      contrast: 10
    }
  },
  {
    id: 'hp5',
    name: 'Ilford HP5 Plus',
    description: 'Versatile black and white with moderate contrast and wide latitude.',
    adjustments: {
      filmType: 'bw_neg',
      contrast: 12,
      shadows: 5,
      highlights: -2
    }
  },
  {
    id: 'ektar-100',
    name: 'Kodak Ektar 100',
    description: 'Ultra-vibrant colors and high contrast for landscapes.',
    adjustments: {
      filmType: 'color_neg',
      temperature: 4,
      saturation: 25,
      contrast: 18,
      highlights: -8
    }
  },
  {
    id: 'velvia-50',
    name: 'Fujifilm Velvia 50',
    description: 'Legendary slide film with extreme saturation and contrast.',
    adjustments: {
      filmType: 'positive',
      saturation: 35,
      contrast: 25,
      highlights: -10,
      shadows: -10
    }
  }
];
