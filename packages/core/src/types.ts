/**
 * A look ("theme") is a named set of Lightroom-style develop settings.
 * Every number uses the same units and ranges as the matching Lightroom slider,
 * so values can be copied straight from Lightroom (or a tutorial video).
 */

export const MIXER_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const;
export type MixerColor = (typeof MIXER_COLORS)[number];

export const GRADE_REGIONS = ['shadows', 'midtones', 'highlights', 'global'] as const;
export type GradeRegion = (typeof GRADE_REGIONS)[number];

/** One colour band of the Color Mixer (HSL panel). Each value is -100..100. */
export interface MixerBand {
  hue?: number;
  sat?: number;
  lum?: number;
}

/** One Color Grading wheel. hue 0..360 (degrees), sat 0..100, lum -100..100. */
export interface GradeWheel {
  hue?: number;
  sat?: number;
  lum?: number;
}

/** A curve given as [x, y] points on a 0..255 grid, like Lightroom's point curve. */
export type CurvePoints = Array<[number, number]>;

export interface Settings {
  // Light
  /** Exposure in stops (EV), -5..5. */
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;

  // Color
  /** Relative white balance shift, -100 (cooler) .. 100 (warmer). */
  temp?: number;
  /** Relative tint shift, -100 (greener) .. 100 (more magenta). */
  tint?: number;
  vibrance?: number;
  saturation?: number;

  // Presence
  texture?: number;
  clarity?: number;
  dehaze?: number;

  // Tone curve
  /** Parametric tone curve regions, -100..100 each; splits are 0..100 (defaults 25/50/75). */
  parametric?: {
    highlights?: number;
    lights?: number;
    darks?: number;
    shadows?: number;
    shadowSplit?: number;
    midtoneSplit?: number;
    highlightSplit?: number;
  };
  /** Point curves on a 0..255 grid. */
  curve?: {
    rgb?: CurvePoints;
    red?: CurvePoints;
    green?: CurvePoints;
    blue?: CurvePoints;
  };

  // Color Mixer (HSL)
  mixer?: Partial<Record<MixerColor, MixerBand>>;

  // Color Grading
  grading?: Partial<Record<GradeRegion, GradeWheel>> & {
    /** 0..100, default 50. */
    blending?: number;
    /** -100..100, default 0. */
    balance?: number;
  };

  // Detail
  sharpening?: {
    /** 0..150 */
    amount?: number;
    /** 0.5..3 px, default 1.0 */
    radius?: number;
    /** 0..100, default 25 */
    detail?: number;
    /** 0..100 */
    masking?: number;
  };
  noiseReduction?: {
    luminance?: number;
    color?: number;
  };

  // Effects
  vignette?: {
    /** -100..100 */
    amount?: number;
    /** 0..100, default 50 */
    midpoint?: number;
    /** -100..100 */
    roundness?: number;
    /** 0..100, default 50 */
    feather?: number;
    /** Highlight priority, 0..100 */
    highlights?: number;
  };
  grain?: {
    amount?: number;
    /** 0..100, default 25 */
    size?: number;
    /** 0..100, default 50 */
    roughness?: number;
  };
}

export interface Theme {
  name: string;
  description?: string;
  /** Free-form notes, e.g. which sliders the original author sets per photo. */
  notes?: string;
  author?: string;
  source?: string;
  settings: Settings;
}

/** An RGB image, gamma-encoded sRGB, 0..1, interleaved (r, g, b, r, g, b, ...). */
export interface RGBImage {
  width: number;
  height: number;
  data: Float32Array;
}

export interface ApplyOptions {
  /** Blend between the original (0) and the full look (1). Default 1. */
  strength?: number;
  /**
   * Size of this image relative to the full-resolution photo (e.g. 0.25 for a
   * quarter-size preview). Pixel-sized effects (sharpening radius, grain size,
   * noise reduction) are scaled by it so previews match the final export.
   */
  pixelScale?: number;
  /** Seed for film grain, so the same photo always gets the same grain. */
  seed?: number;
}
