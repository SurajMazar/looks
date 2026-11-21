import { GRADE_REGIONS, MIXER_COLORS, type Settings } from './types.js';

/** One slider, shared by the CLI (`--set`, `looks keys`) and the web UI. */
export interface Control {
  /** Dotted path inside Settings, e.g. "contrast" or "mixer.blue.sat". */
  path: string;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

const c = (
  group: string,
  path: string,
  label: string,
  min: number,
  max: number,
  def = 0,
  step = 1,
  unit?: string,
): Control => ({ group, path, label, min, max, default: def, step, unit });

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const CONTROLS: Control[] = [
  c('Light', 'exposure', 'Exposure', -5, 5, 0, 0.05, 'EV'),
  c('Light', 'contrast', 'Contrast', -100, 100),
  c('Light', 'highlights', 'Highlights', -100, 100),
  c('Light', 'shadows', 'Shadows', -100, 100),
  c('Light', 'whites', 'Whites', -100, 100),
  c('Light', 'blacks', 'Blacks', -100, 100),

  c('Color', 'temp', 'Temp', -100, 100),
  c('Color', 'tint', 'Tint', -100, 100),
  c('Color', 'vibrance', 'Vibrance', -100, 100),
  c('Color', 'saturation', 'Saturation', -100, 100),

  c('Effects', 'texture', 'Texture', -100, 100),
  c('Effects', 'clarity', 'Clarity', -100, 100),
  c('Effects', 'dehaze', 'Dehaze', -100, 100),
  c('Effects', 'vignette.amount', 'Vignette', -100, 100),
  c('Effects', 'vignette.midpoint', 'Midpoint', 0, 100, 50),
  c('Effects', 'vignette.roundness', 'Roundness', -100, 100),
  c('Effects', 'vignette.feather', 'Feather', 0, 100, 50),
  c('Effects', 'vignette.highlights', 'Highlights', 0, 100),
  c('Effects', 'grain.amount', 'Grain', 0, 100),
  c('Effects', 'grain.size', 'Size', 0, 100, 25),
  c('Effects', 'grain.roughness', 'Roughness', 0, 100, 50),

  c('Curve', 'parametric.highlights', 'Highlights', -100, 100),
  c('Curve', 'parametric.lights', 'Lights', -100, 100),
  c('Curve', 'parametric.darks', 'Darks', -100, 100),
  c('Curve', 'parametric.shadows', 'Shadows', -100, 100),
  c('Curve', 'parametric.shadowSplit', 'Shadow split', 10, 70, 25),
  c('Curve', 'parametric.midtoneSplit', 'Midtone split', 20, 80, 50),
  c('Curve', 'parametric.highlightSplit', 'Highlight split', 30, 90, 75),

  ...MIXER_COLORS.flatMap((color) => [
    c('Color Mixer', `mixer.${color}.hue`, `${cap(color)} hue`, -100, 100),
    c('Color Mixer', `mixer.${color}.sat`, `${cap(color)} saturation`, -100, 100),
    c('Color Mixer', `mixer.${color}.lum`, `${cap(color)} luminance`, -100, 100),
  ]),

  ...GRADE_REGIONS.flatMap((region) => [
    c('Color Grading', `grading.${region}.hue`, `${cap(region)} hue`, 0, 360, 0, 1, '°'),
    c('Color Grading', `grading.${region}.sat`, `${cap(region)} saturation`, 0, 100),
    c('Color Grading', `grading.${region}.lum`, `${cap(region)} luminance`, -100, 100),
  ]),
  c('Color Grading', 'grading.blending', 'Blending', 0, 100, 50),
  c('Color Grading', 'grading.balance', 'Balance', -100, 100),

  c('Detail', 'sharpening.amount', 'Sharpening', 0, 150),
  c('Detail', 'sharpening.radius', 'Radius', 0.5, 3, 1, 0.1),
  c('Detail', 'sharpening.detail', 'Detail', 0, 100, 25),
  c('Detail', 'sharpening.masking', 'Masking', 0, 100),
  c('Detail', 'noiseReduction.luminance', 'Noise reduction', 0, 100),
  c('Detail', 'noiseReduction.color', 'Color noise reduction', 0, 100),
];

export const CONTROL_BY_PATH: Map<string, Control> = new Map(CONTROLS.map((ctl) => [ctl.path, ctl]));

/** Aliases accepted by `--set` so people can type what Lightroom shows. */
const ALIASES: Record<string, string> = {
  temperature: 'temp',
  vignette: 'vignette.amount',
  grain: 'grain.amount',
  sharpening: 'sharpening.amount',
  sharpen: 'sharpening.amount',
  noise: 'noiseReduction.luminance',
};

export function resolvePath(path: string): Control | undefined {
  const p = path.trim();
  const key = ALIASES[p.toLowerCase()] ?? p;
  if (CONTROL_BY_PATH.has(key)) return CONTROL_BY_PATH.get(key);
  // Case-insensitive fallback ("Mixer.Blue.Sat").
  const lower = key.toLowerCase();
  for (const ctl of CONTROLS) if (ctl.path.toLowerCase() === lower) return ctl;
  // Accept "saturation"/"luminance" spelled out inside mixer/grading paths.
  const short = lower.replace(/\.saturation$/, '.sat').replace(/\.luminance$/, '.lum');
  for (const ctl of CONTROLS) if (ctl.path.toLowerCase() === short) return ctl;
  return undefined;
}

export function getValue(s: Settings, path: string): number | undefined {
  let cur: unknown = s;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'number' ? cur : undefined;
}

/** Sets a slider value, creating nested objects. Returns a new Settings object. */
export function setValue(s: Settings, path: string, value: number | undefined): Settings {
  const next = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  const parts = path.split('.');
  let cur = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  const leaf = parts[parts.length - 1];
  if (value === undefined) delete cur[leaf];
  else cur[leaf] = value;
  return pruneSettings(next as Settings);
}

/** Drops values equal to their default and empty groups, so theme files stay short. */
export function pruneSettings(s: Settings): Settings {
  const walk = (obj: Record<string, unknown>, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (path === 'curve') {
        const curve = v as Record<string, unknown>;
        const kept = Object.fromEntries(
          Object.entries(curve ?? {}).filter(([, pts]) => Array.isArray(pts) && pts.length >= 2),
        );
        if (Object.keys(kept).length) out[k] = kept;
        continue;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inner = walk(v as Record<string, unknown>, path);
        if (Object.keys(inner).length) out[k] = inner;
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const ctl = CONTROL_BY_PATH.get(path);
      if (ctl && v === ctl.default) continue;
      out[k] = v;
    }
    return out;
  };
  return walk(s as Record<string, unknown>, '') as Settings;
}

export function clampToControl(ctl: Control, v: number): number {
  return Math.min(ctl.max, Math.max(ctl.min, v));
}
