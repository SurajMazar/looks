import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertToSrgb, heifColourProfile, isHeif, isSrgbLike, nclxProfile, type RGBImage } from '../src/index.js';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

describe('HEIF + colour profiles', () => {
  it('recognises HEIC files by their ftyp brand', () => {
    expect(isHeif(fixture('p3.heic'))).toBe(true);
    expect(isHeif(fixture('reference.png'))).toBe(false);
    expect(isHeif(new Uint8Array(8))).toBe(false);
  });

  it('reads the Display P3 ICC profile from an iPhone-style HEIC', () => {
    const p = heifColourProfile(fixture('p3.heic'))!;
    expect(p.name).toMatch(/P3/);
    expect(isSrgbLike(p)).toBe(false);
  });

  it('knows nclx codes and leaves sRGB alone', () => {
    expect(isSrgbLike(nclxProfile(1, 13)!)).toBe(true);
    expect(isSrgbLike(nclxProfile(12, 13)!)).toBe(false);
    expect(nclxProfile(99, 13)).toBeNull();
  });

  it('converts P3 values to sRGB (saturated P3 red is out of sRGB gamut, neutral stays neutral)', () => {
    const img: RGBImage = { width: 2, height: 1, data: new Float32Array([1, 0, 0, 0.5, 0.5, 0.5]) };
    convertToSrgb(img, nclxProfile(12, 13)!);
    expect(img.data[0]).toBeCloseTo(1, 3);
    expect(img.data[1]).toBeLessThan(0.01);
    for (const v of img.data.subarray(3)) expect(v).toBeCloseTo(0.5, 2);
  });
});
