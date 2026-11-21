import { describe, expect, it } from 'vitest';
import {
  applySettings,
  BAND_CENTERS,
  BUILTIN_THEMES,
  findBuiltin,
  parseTheme,
  parseXmp,
  resolvePath,
  setValue,
  themeToJson,
  toXmp,
  type RGBImage,
  type Settings,
} from '../src/index.js';
import { curveLut, toneLut, LUT_N } from '../src/curves.js';

function testImage(w = 48, h = 32): RGBImage {
  const data = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      // Hue sweep across, brightness down, plus a neutral strip.
      const t = x / (w - 1);
      const v = 1 - y / (h - 1);
      if (y < 4) {
        data[i] = data[i + 1] = data[i + 2] = t;
      } else {
        data[i] = v * (0.5 + 0.5 * Math.cos(2 * Math.PI * t));
        data[i + 1] = v * (0.5 + 0.5 * Math.cos(2 * Math.PI * (t - 1 / 3)));
        data[i + 2] = v * (0.5 + 0.5 * Math.cos(2 * Math.PI * (t - 2 / 3)));
      }
    }
  }
  return { width: w, height: h, data };
}

const copy = (img: RGBImage): RGBImage => ({ ...img, data: new Float32Array(img.data) });
const maxDiff = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const meanOf = (img: RGBImage, ch: number) => {
  let s = 0;
  for (let i = ch; i < img.data.length; i += 3) s += img.data[i];
  return s / (img.data.length / 3);
};

describe('engine', () => {
  it('leaves the image untouched with empty settings', () => {
    const img = testImage();
    const out = copy(img);
    applySettings(out, {});
    expect(maxDiff(img.data, out.data)).toBeLessThan(1e-6);
  });

  it('strength 0 is a no-op and 0.5 lands halfway', () => {
    const img = testImage();
    const full = copy(img);
    const half = copy(img);
    const none = copy(img);
    const s: Settings = { contrast: 50, vibrance: 40 };
    applySettings(full, s);
    applySettings(half, s, { strength: 0.5 });
    applySettings(none, s, { strength: 0 });
    expect(maxDiff(none.data, img.data)).toBe(0);
    for (let i = 0; i < img.data.length; i++) {
      expect(half.data[i]).toBeCloseTo((img.data[i] + full.data[i]) / 2, 5);
    }
  });

  it('keeps every value in 0..1 even with extreme settings', () => {
    const out = testImage();
    applySettings(out, {
      exposure: 3,
      contrast: 100,
      whites: 100,
      blacks: -100,
      vibrance: 100,
      saturation: 100,
      clarity: 100,
      dehaze: 100,
      mixer: { blue: { hue: 100, sat: 100, lum: -100 } },
      grading: { shadows: { hue: 200, sat: 100, lum: -100 }, highlights: { hue: 30, sat: 100, lum: 100 } },
      sharpening: { amount: 150, radius: 3 },
      vignette: { amount: -100 },
      grain: { amount: 100 },
    });
    for (const v of out.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic (grain included)', () => {
    const a = testImage();
    const b = testImage();
    const s = findBuiltin('gta6')!.settings;
    applySettings(a, { ...s, grain: { amount: 40 } }, { seed: 3 });
    applySettings(b, { ...s, grain: { amount: 40 } }, { seed: 3 });
    expect(maxDiff(a.data, b.data)).toBe(0);
  });

  it('moves sliders in the right direction', () => {
    const base = testImage();
    const bright = copy(base);
    applySettings(bright, { exposure: 1 });
    expect(meanOf(bright, 1)).toBeGreaterThan(meanOf(base, 1));

    const warm = copy(base);
    applySettings(warm, { temp: 50 });
    expect(meanOf(warm, 0) - meanOf(warm, 2)).toBeGreaterThan(meanOf(base, 0) - meanOf(base, 2));

    const grey = copy(base);
    applySettings(grey, { saturation: -100 });
    for (let i = 0; i < grey.data.length; i += 3) {
      expect(Math.abs(grey.data[i] - grey.data[i + 1])).toBeLessThan(1e-4);
      expect(Math.abs(grey.data[i + 1] - grey.data[i + 2])).toBeLessThan(1e-4);
    }
  });

  it('the fast 3D-LUT path matches exact per-pixel maths', () => {
    const { sharpening, noiseReduction, ...pointwise } = findBuiltin('gta6')!.settings;
    void sharpening;
    void noiseReduction;
    const big = testImage(640, 400); // 256k px -> LUT path
    const exact = copy(big);
    applySettings(big, pointwise);
    // Two halves of 128k px each take the exact path.
    const half = exact.data.length / 2;
    for (const part of [exact.data.subarray(0, half), exact.data.subarray(half)]) {
      applySettings({ width: 640, height: 200, data: part }, pointwise);
    }
    let sum = 0;
    for (let i = 0; i < big.data.length; i++) sum += Math.abs(big.data[i] - exact.data[i]);
    expect(sum / big.data.length).toBeLessThan(0.004);
    expect(maxDiff(big.data, exact.data)).toBeLessThan(0.06);
  });

  it('colour grading tints neutral shadows toward the wheel hue', () => {
    const img: RGBImage = { width: 1, height: 1, data: new Float32Array([0.25, 0.25, 0.25]) };
    applySettings(img, { grading: { shadows: { hue: 196, sat: 60 } } });
    const [r, g, b] = img.data;
    expect(b).toBeGreaterThan(r); // teal-blue
    expect(g).toBeGreaterThan(r);
  });
});

describe('curves', () => {
  it('mixer band centres go round the hue circle in order', () => {
    for (let i = 1; i < BAND_CENTERS.length; i++) expect(BAND_CENTERS[i]).toBeGreaterThan(BAND_CENTERS[i - 1]);
  });

  it('tone and point curves are monotone', () => {
    const tone = toneLut({ contrast: 100, highlights: -100, shadows: 100, whites: 100, blacks: -100 })!;
    const pts = curveLut([
      [0, 20],
      [60, 50],
      [190, 210],
      [255, 240],
    ])!;
    for (let i = 1; i <= LUT_N; i++) {
      expect(tone[i]).toBeGreaterThanOrEqual(tone[i - 1]);
      expect(pts[i]).toBeGreaterThanOrEqual(pts[i - 1]);
    }
    expect(pts[0]).toBeCloseTo(20 / 255, 5);
    expect(pts[LUT_N]).toBeCloseTo(240 / 255, 5);
  });
});

describe('themes', () => {
  it('built-ins parse cleanly', () => {
    expect(BUILTIN_THEMES.map((t) => t.name)).toContain('gta6');
    const gta6 = findBuiltin('GTA6')!;
    expect(gta6.settings.contrast).toBe(27);
    expect(gta6.settings.mixer?.yellow).toEqual({ hue: -26, sat: -21, lum: 9 });
    expect(gta6.settings.grading?.shadows).toEqual({ hue: 196, sat: 22, lum: -6 });
  });

  it('every built-in theme file is valid, with no warnings', async () => {
    const files = ['gta6', 'cyberpunk'];
    for (const f of files) {
      const raw = (await import(`../themes/${f}.json`)).default;
      expect(parseTheme(raw).warnings, f).toEqual([]);
    }
    const cp = findBuiltin('cyberpunk')!;
    expect(cp.settings.curve?.rgb).toEqual([[0, 0], [32, 22], [64, 55], [128, 133], [192, 207], [255, 255]]);
    expect(cp.settings.grading?.highlights).toEqual({ hue: 345, sat: 22, lum: 5 });
    expect(cp.settings.mixer?.green).toEqual({ hue: 20, sat: -65, lum: -15 });
  });

  it('warns about unknown keys and clamps out-of-range values', () => {
    const { theme, warnings } = parseTheme({ name: 'x', settings: { contrast: 500, bogus: 1, mixer: { blue: { hue: 10 } } } });
    expect(theme.settings.contrast).toBe(100);
    expect(theme.settings).not.toHaveProperty('bogus');
    expect(theme.settings.mixer?.blue?.hue).toBe(10);
    expect(warnings.length).toBe(2);
  });

  it('accepts a bare settings object', () => {
    const { theme } = parseTheme('{"contrast": 10, "vibrance": 5}', 'bare');
    expect(theme).toEqual({ name: 'bare', settings: { contrast: 10, vibrance: 5 } });
  });

  it('round-trips through JSON and Lightroom XMP', () => {
    const gta6 = findBuiltin('gta6')!;
    expect(parseTheme(themeToJson(gta6)).theme.settings).toEqual(gta6.settings);
    const back = parseXmp(toXmp(gta6)).theme;
    expect(back.name).toBe('gta6');
    expect(back.settings).toEqual(gta6.settings);
  });

  it('reads element-style XMP with curves', () => {
    const xmp = `<x:xmpmeta><rdf:RDF><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      crs:Contrast2012="+15" crs:SplitToningShadowHue="210" crs:SplitToningShadowSaturation="18">
      <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Faded Film</rdf:li></rdf:Alt></crs:Name>
      <crs:Vibrance>-10</crs:Vibrance>
      <crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 25</rdf:li><rdf:li>128, 128</rdf:li><rdf:li>255, 240</rdf:li></rdf:Seq></crs:ToneCurvePV2012>
      </rdf:Description></rdf:RDF></x:xmpmeta>`;
    const { theme } = parseXmp(xmp);
    expect(theme.name).toBe('faded-film');
    expect(theme.settings).toEqual({
      contrast: 15,
      vibrance: -10,
      grading: { shadows: { hue: 210, sat: 18 } },
      curve: { rgb: [[0, 25], [128, 128], [255, 240]] },
    });
  });

  it('resolves --set paths and aliases', () => {
    expect(resolvePath('Mixer.Blue.Saturation')?.path).toBe('mixer.blue.sat');
    expect(resolvePath('temperature')?.path).toBe('temp');
    expect(resolvePath('nope')).toBeUndefined();
    expect(setValue({}, 'grading.shadows.hue', 200)).toEqual({ grading: { shadows: { hue: 200 } } });
    expect(setValue({ grading: { blending: 70 } }, 'grading.blending', 50)).toEqual({});
  });
});
