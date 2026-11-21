import { parseSettings } from './theme.js';
import { MIXER_COLORS, type CurvePoints, type Settings, type Theme } from './types.js';

/** crs:* attribute -> settings path. */
const SCALARS: Record<string, string> = {
  Exposure2012: 'exposure',
  Contrast2012: 'contrast',
  Highlights2012: 'highlights',
  Shadows2012: 'shadows',
  Whites2012: 'whites',
  Blacks2012: 'blacks',
  IncrementalTemperature: 'temp',
  IncrementalTint: 'tint',
  Vibrance: 'vibrance',
  Saturation: 'saturation',
  Texture: 'texture',
  Clarity2012: 'clarity',
  Dehaze: 'dehaze',
  ParametricShadows: 'parametric.shadows',
  ParametricDarks: 'parametric.darks',
  ParametricLights: 'parametric.lights',
  ParametricHighlights: 'parametric.highlights',
  ParametricShadowSplit: 'parametric.shadowSplit',
  ParametricMidtoneSplit: 'parametric.midtoneSplit',
  ParametricHighlightSplit: 'parametric.highlightSplit',
  SplitToningShadowHue: 'grading.shadows.hue',
  SplitToningShadowSaturation: 'grading.shadows.sat',
  SplitToningHighlightHue: 'grading.highlights.hue',
  SplitToningHighlightSaturation: 'grading.highlights.sat',
  SplitToningBalance: 'grading.balance',
  ColorGradeShadowLum: 'grading.shadows.lum',
  ColorGradeMidtoneHue: 'grading.midtones.hue',
  ColorGradeMidtoneSat: 'grading.midtones.sat',
  ColorGradeMidtoneLum: 'grading.midtones.lum',
  ColorGradeHighlightLum: 'grading.highlights.lum',
  ColorGradeGlobalHue: 'grading.global.hue',
  ColorGradeGlobalSat: 'grading.global.sat',
  ColorGradeGlobalLum: 'grading.global.lum',
  ColorGradeBlending: 'grading.blending',
  Sharpness: 'sharpening.amount',
  SharpenRadius: 'sharpening.radius',
  SharpenDetail: 'sharpening.detail',
  SharpenEdgeMasking: 'sharpening.masking',
  LuminanceSmoothing: 'noiseReduction.luminance',
  ColorNoiseReduction: 'noiseReduction.color',
  PostCropVignetteAmount: 'vignette.amount',
  PostCropVignetteMidpoint: 'vignette.midpoint',
  PostCropVignetteRoundness: 'vignette.roundness',
  PostCropVignetteFeather: 'vignette.feather',
  PostCropVignetteHighlightContrast: 'vignette.highlights',
  GrainAmount: 'grain.amount',
  GrainSize: 'grain.size',
  GrainFrequency: 'grain.roughness',
};

const MIXER_XMP = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
MIXER_COLORS.forEach((color, i) => {
  SCALARS[`HueAdjustment${MIXER_XMP[i]}`] = `mixer.${color}.hue`;
  SCALARS[`SaturationAdjustment${MIXER_XMP[i]}`] = `mixer.${color}.sat`;
  SCALARS[`LuminanceAdjustment${MIXER_XMP[i]}`] = `mixer.${color}.lum`;
});

const CURVES: Record<string, 'rgb' | 'red' | 'green' | 'blue'> = {
  ToneCurvePV2012: 'rgb',
  ToneCurvePV2012Red: 'red',
  ToneCurvePV2012Green: 'green',
  ToneCurvePV2012Blue: 'blue',
};

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] ??= {};
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Reads a Lightroom / Camera Raw preset (.xmp) and returns it as a theme.
 * Handles both attribute (`crs:Contrast2012="+27"`) and element forms.
 */
export function parseXmp(text: string, fallbackName = 'imported'): { theme: Theme; warnings: string[] } {
  if (!/crs:/i.test(text)) throw new Error('This does not look like a Lightroom/Camera Raw XMP preset (no crs: settings found).');
  const values = new Map<string, string>();
  for (const m of text.matchAll(/crs:(\w+)\s*=\s*"([^"]*)"/g)) values.set(m[1], decodeEntities(m[2]));
  for (const m of text.matchAll(/<crs:(\w+)>([^<]*)<\/crs:\1>/g)) values.set(m[1], decodeEntities(m[2]));

  const raw: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(SCALARS)) {
    const v = values.get(key);
    if (v === undefined) continue;
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) setPath(raw, path, n);
  }

  for (const [key, which] of Object.entries(CURVES)) {
    const block = text.match(new RegExp(`<crs:${key}>([\\s\\S]*?)</crs:${key}>`));
    if (!block) continue;
    const pts: CurvePoints = [];
    for (const li of block[1].matchAll(/<rdf:li>\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*<\/rdf:li>/g)) {
      pts.push([Number(li[1]), Number(li[2])]);
    }
    if (pts.length >= 2) setPath(raw, `curve.${which}`, pts);
  }

  let name = values.get('Name');
  if (!name) {
    const alt = text.match(/<crs:Name>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/);
    if (alt) name = decodeEntities(alt[1]);
  }
  const warnings: string[] = [];
  if (values.has('Temperature') && !values.has('IncrementalTemperature')) {
    warnings.push('The preset sets an absolute (Kelvin) white balance, which only applies to raw files; it was skipped. Use --temp/--tint per photo.');
  }
  const settings = parseSettings(raw, warnings);
  const slug = (name ?? fallbackName)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallbackName;
  return {
    theme: { name: slug, description: name ? `Imported from the Lightroom preset “${name}”.` : undefined, settings },
    warnings,
  };
}

function fmt(v: number): string {
  return Number.isInteger(v) ? (v > 0 ? `+${v}` : `${v}`) : v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
}

/** Writes a theme as a Lightroom preset (.xmp) so it can be used in Lightroom too. */
export function toXmp(theme: Theme): string {
  const s: Settings = theme.settings;
  const attrs: string[] = [];
  const lookup = (path: string): number | undefined => {
    let cur: unknown = s;
    for (const p of path.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined;
    return typeof cur === 'number' ? cur : undefined;
  };
  for (const [key, path] of Object.entries(SCALARS)) {
    const v = lookup(path);
    if (v === undefined) continue;
    const unsigned = /Hue$|Saturation$|Sat$|Sharpness|SharpenRadius|SharpenDetail|SharpenEdgeMasking|Smoothing|NoiseReduction|Grain|Split$|Blending|Midpoint|Feather/.test(key);
    attrs.push(`   crs:${key}="${unsigned ? String(v) : fmt(v)}"`);
  }
  const hasCurve = Object.values(s.curve ?? {}).some((c) => c && c.length >= 2);
  const curves = Object.entries(CURVES)
    .map(([key, which]) => {
      const pts = s.curve?.[which];
      if (!pts || pts.length < 2) return '';
      const lis = pts.map(([x, y]) => `      <rdf:li>${Math.round(x)}, ${Math.round(y)}</rdf:li>`).join('\n');
      return `   <crs:${key}>\n    <rdf:Seq>\n${lis}\n    </rdf:Seq>\n   </crs:${key}>`;
    })
    .filter(Boolean)
    .join('\n');
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="looks">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Normal"
   crs:Version="15.0"
   crs:ProcessVersion="11.0"
   crs:HasSettings="True"
${hasCurve ? '   crs:CurveRefineSaturation="100"\n' : ''}${attrs.join('\n')}>
   <crs:Name>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${esc(theme.name)}</rdf:li>
    </rdf:Alt>
   </crs:Name>
${curves}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;
}
