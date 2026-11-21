export * from './types.js';
export { applySettings, BAND_CENTERS } from './engine.js';
export {
  CONTROLS,
  CONTROL_BY_PATH,
  resolvePath,
  getValue,
  setValue,
  pruneSettings,
  clampToControl,
  type Control,
} from './controls.js';
export {
  parseTheme,
  parseSettings,
  themeToJson,
  mergeSettings,
  checkThemeName,
  RESERVED_NAMES,
  NAME_PATTERN,
  type ParsedTheme,
} from './theme.js';
export { parseXmp, toXmp } from './xmp.js';
export { BUILTIN_THEMES, findBuiltin } from './builtins.js';
export { hslToRgb } from './color.js';

import type { RGBImage } from './types.js';

/** 8-bit RGBA (canvas ImageData layout) -> float RGB. */
export function rgbaToImage(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): RGBImage {
  const n = width * height;
  const data = new Float32Array(n * 3);
  for (let i = 0, j = 0, k = 0; i < n; i++, j += 3, k += 4) {
    data[j] = rgba[k] / 255;
    data[j + 1] = rgba[k + 1] / 255;
    data[j + 2] = rgba[k + 2] / 255;
  }
  return { width, height, data };
}

/** Float RGB -> 8-bit RGBA, keeping the alpha channel from `alphaFrom` when given. */
export function imageToRgba(
  img: RGBImage,
  out?: Uint8ClampedArray<ArrayBuffer>,
  alphaFrom?: Uint8Array | Uint8ClampedArray,
): Uint8ClampedArray<ArrayBuffer> {
  const n = img.width * img.height;
  const rgba = out ?? new Uint8ClampedArray(n * 4);
  const d = img.data;
  for (let i = 0, j = 0, k = 0; i < n; i++, j += 3, k += 4) {
    rgba[k] = d[j] * 255 + 0.5;
    rgba[k + 1] = d[j + 1] * 255 + 0.5;
    rgba[k + 2] = d[j + 2] * 255 + 0.5;
    rgba[k + 3] = alphaFrom ? alphaFrom[k + 3] : 255;
  }
  return rgba;
}
export { isHeif, heifColourProfile, decodeHeif, type LibHeif, type DecodedHeif } from './heif.js';
export { parseIccProfile, convertToSrgb, isSrgbLike, nclxProfile, type RgbProfile } from './icc.js';
