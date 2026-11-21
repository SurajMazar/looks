// Builds the sample gallery used by the web app (and the README):
//   apps/web/public/samples/<theme>.jpg          the photo, 1200px (committed source)
//   apps/web/public/samples/<theme>-before.webp  thumbnail, as shot
//   apps/web/public/samples/<theme>-after.webp   thumbnail with the look applied by the real engine
//   apps/web/public/samples/samples.json         manifest the app reads
//
//   node scripts/build-samples.mjs                regenerate thumbnails from the committed photos
//   node scripts/build-samples.mjs --import DIR   first shrink DIR/<theme>.jpg originals into place
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'packages/cli/package.json'));
const sharp = require('sharp');
const out = join(root, 'apps/web/public/samples');
const cli = join(root, 'packages/cli/dist/looks.js');

/** One hand-picked, free-licence photo per built-in look (Unsplash License: free to use, no attribution required). */
const SAMPLES = [
  { theme: 'gta6', alt: 'Ocean Drive, Miami, at dusk', credit: 'https://unsplash.com/photos/vehicles-parked-beside-curb-during-daytime-e0y06kkszX0' },
  { theme: 'cyberpunk', alt: 'City skyline at sunset', credit: 'https://unsplash.com/photos/city-buildings-during-sunset-Vtl6cOhO87Y' },
  { theme: 'solo-leveling', alt: 'Rainy city street at night', credit: 'https://unsplash.com/photos/people-walking-on-street-during-nighttime-WpUOPwkswpw' },
  { theme: 'dandandan', alt: 'Basketball hoop at dusk', credit: 'https://unsplash.com/photos/basketball-hoop-on-a-court-at-sunset-JBsK9rJEccA' },
  { theme: 'mushoku-tensei', alt: 'Grassy path through a green field', credit: 'https://unsplash.com/photos/grassy-path-winding-uphill-through-a-vibrant-green-field-74BSKWPzTu4' },
  { theme: 'tokyo-ghoul', alt: 'Train platform at night', credit: 'https://unsplash.com/photos/two-people-stand-on-a-train-platform-at-night-aY_i87chJJg' },
  { theme: 'bleach-1000-year-blood-war', alt: 'River and street light at sunset', credit: 'https://unsplash.com/photos/a-street-light-sitting-next-to-a-body-of-water-X34q3blcAl8' },
];

const importDir = process.argv.includes('--import') ? process.argv[process.argv.indexOf('--import') + 1] : null;
if (!existsSync(cli)) execFileSync('node', ['build.mjs'], { cwd: join(root, 'packages/cli'), stdio: 'inherit' });
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'looks-samples-'));
const thumb = (input, file) =>
  sharp(input).resize(640, 640, { fit: 'inside' }).webp({ quality: 80 }).toFile(join(out, file));

try {
  for (const s of SAMPLES) {
    const photo = join(out, `${s.theme}.jpg`);
    if (importDir) {
      await sharp(join(importDir, `${s.theme}.jpg`))
        .rotate()
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 84, mozjpeg: true })
        .toFile(photo);
    }
    if (!existsSync(photo)) throw new Error(`Missing ${photo}; run with --import <dir> first.`);
    const after = join(tmp, `${s.theme}-after.png`);
    execFileSync('node', [cli, s.theme, photo, '-o', after], { stdio: 'pipe' });
    await thumb(photo, `${s.theme}-before.webp`);
    await thumb(after, `${s.theme}-after.webp`);
    console.log(`✓ ${s.theme}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const manifest = SAMPLES.map((s) => ({
  theme: s.theme,
  alt: s.alt,
  photo: `samples/${s.theme}.jpg`,
  before: `samples/${s.theme}-before.webp`,
  after: `samples/${s.theme}-after.webp`,
  credit: s.credit,
}));
writeFileSync(join(out, 'samples.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(
  join(out, 'CREDITS.md'),
  '# Sample photos\n\nFree photos from Unsplash, used under the [Unsplash License](https://unsplash.com/license).\n\n' +
    SAMPLES.map((s) => `- \`${s.theme}\`: [${s.alt}](${s.credit})`).join('\n') +
    '\n',
);
console.log(`wrote ${join(out, 'samples.json')}`);
