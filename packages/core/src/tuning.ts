/**
 * Strength constants that map Lightroom slider units onto this engine.
 * Calibrated against before/after pairs edited in Lightroom
 * by fitting region colours. Not part of the public API.
 */
export const TUNING = {
  /** Contrast S-curve steepness per unit of contrast. */
  contrastK: 2,
  shadowsK: 0.2,
  highlightsK: 0.22,
  whitesK: 0.22,
  blacksK: 0.24,
  /** How strongly vibrance boosts muted colours. */
  vibranceK: 2,
  /** Mixer hue ±100 moves this fraction of the way to the neighbouring colour. */
  mixerHueSpan: 0.8,
  /** Mixer saturation ±100 scales chroma by this fraction. */
  mixerSatK: 1.25,
  /** Mixer luminance ±100 scales OKLab lightness by this fraction. */
  mixerLumK: 0.32,
  /** Colour grading saturation 100 adds this much OKLab chroma. */
  gradeSatK: 0.28,
  /** Colour grading luminance ±100 shifts OKLab lightness by this much. */
  gradeLumK: 0.3,
  /** OKLab lightness where shadows hand over to highlights (balance 0). */
  gradePivot: 0.74,
};
