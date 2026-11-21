import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BIN = join(__dirname, '..', 'dist', 'looks.js');
let dir: string;
let env: NodeJS.ProcessEnv;

const looks = (...args: string[]) => {
  const res = spawnSync(process.execPath, [BIN, ...args], { env, cwd: dir, encoding: 'utf8' });
  return { code: res.status, out: res.stdout, err: res.stderr };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'looks-test-'));
  env = { ...process.env, LOOKS_HOME: join(dir, 'home'), NO_COLOR: '1' };
  const w = 64;
  const h = 48;
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    px[i * 3] = (i % w) * 4;
    px[i * 3 + 1] = Math.floor(i / w) * 5;
    px[i * 3 + 2] = 128;
  }
  await sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg().toFile(join(dir, 'photo.jpg'));
  await sharp(px, { raw: { width: w, height: h, channels: 3 } }).ensureAlpha(0.5).png().toFile(join(dir, 'clear.png'));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('looks CLI', () => {
  it('applies the built-in gta6 theme next to the photo', async () => {
    const r = looks('gta6', 'photo.jpg');
    expect(r.code, r.err).toBe(0);
    const out = join(dir, 'photo-gta6.jpg');
    expect(existsSync(out)).toBe(true);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([64, 48]);
  });

  it('keeps transparency and supports -o, --strength and per-photo nudges', async () => {
    const r = looks('apply', 'gta6', 'clear.png', '-o', 'out/clear.png', '--strength', '50%', '--exposure', '-0.2', '--temp', '10');
    expect(r.code, r.err).toBe(0);
    const meta = await sharp(join(dir, 'out', 'clear.png')).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it('saves, lists, shows, exports and removes a theme', () => {
    expect(looks('save', 'moody', '--from', 'gta6', '--set', 'contrast=45', '--set', 'grading.shadows.sat=35').code).toBe(0);
    const saved = JSON.parse(readFileSync(join(dir, 'home', 'themes', 'moody.json'), 'utf8'));
    expect(saved.settings.contrast).toBe(45);
    expect(saved.settings.grading.shadows).toEqual({ hue: 196, sat: 35, lum: -6 });
    expect(saved.settings.mixer.yellow.hue).toBe(-26);

    expect(looks('list').out).toMatch(/moody/);
    expect(JSON.parse(looks('show', 'moody').out).name).toBe('moody');
    expect(looks('show', 'moody', '--xmp').out).toMatch(/crs:Contrast2012="\+45"/);

    expect(looks('export', 'moody', 'moody.xmp').code).toBe(0);
    expect(looks('save', 'fromxmp', 'moody.xmp').code).toBe(0);
    const imported = JSON.parse(readFileSync(join(dir, 'home', 'themes', 'fromxmp.json'), 'utf8'));
    expect(imported.settings).toEqual(saved.settings);

    expect(looks('moody', 'photo.jpg').code).toBe(0);
    expect(existsSync(join(dir, 'photo-moody.jpg'))).toBe(true);

    expect(looks('rm', 'moody').code).toBe(0);
    expect(looks('list').out).not.toMatch(/^ +moody /m);
  });

  it('applies a theme straight from a JSON file', () => {
    writeFileSync(join(dir, 'warm.json'), JSON.stringify({ name: 'warm', settings: { temp: 30, vibrance: 20 } }));
    const r = looks('./warm.json', 'photo.jpg');
    expect(r.code, r.err).toBe(0);
    expect(existsSync(join(dir, 'photo-warm.jpg'))).toBe(true);
  });

  it('refuses bad input with a helpful message', () => {
    expect(looks('nosuchtheme', 'photo.jpg').err).toMatch(/No theme called "nosuchtheme"/);
    expect(looks('save', 'list', '--from', 'gta6').err).toMatch(/command name/);
    expect(looks('save', 'gta6', '--set', 'contrast=1').err).toMatch(/built-in/);
    expect(looks('gta6', 'photo.jpg', '--set', 'contrast=500').err).toMatch(/between -100 and 100/);
    expect(looks('gta6', 'photo.jpg', '-o', 'photo.jpg').err).toMatch(/overwrite the original/);
    expect(looks('gta6', 'missing.jpg').code).toBe(1);
  });

  it('prints help and version', () => {
    expect(looks('--help').out).toMatch(/looks <theme> <image/);
    expect(execFileSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' }).trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
