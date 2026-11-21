import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  applySettings,
  BUILTIN_THEMES,
  checkThemeName,
  CONTROLS,
  findBuiltin,
  mergeSettings,
  resolvePath,
  setValue,
  themeToJson,
  toXmp,
  type Settings,
  type Theme,
} from '@looks/core';
import { readImage, writeImage, WRITABLE } from './io.js';
import {
  listUserThemes,
  loadTheme,
  readThemeFile,
  removeUserTheme,
  saveUserTheme,
  themesDir,
  userThemePath,
} from './store.js';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint(1);
const dim = paint(2);
const green = paint(32);
const yellow = paint(33);
const red = paint(31);
const cyan = paint(36);

const HELP = `${bold('looks')} — save photo looks as named themes and apply them to images.

${bold('Apply a theme')}
  looks <theme> <image...> [options]      e.g.  looks gta6 photo.jpg
  looks apply <theme> <image...>          same thing, spelled out
  <theme> can also be a path to a .json theme or a Lightroom .xmp preset.

  -o, --out <path>        output file, or a folder for several images
                          (default: <name>-<theme>.<ext> next to the photo)
  -s, --strength <n>      blend with the original: 0..1 or 0..100% (default 1)
      --exposure <ev>     per-photo exposure, added to the theme's: 0.4 brighter, -0.3 darker
      --temp <n>          per-photo white balance nudge: negative cooler, positive warmer
      --tint <n>          per-photo tint nudge: negative greener, positive more magenta
      --set key=value     set any slider outright, e.g. --set contrast=40 --set mixer.blue.sat=20
      --max-size <px>     shrink so the long edge is at most this many pixels
  -q, --quality <1-100>   JPEG/WebP/AVIF quality (default 92)
  -f, --force             allow overwriting the input file

${bold('Manage themes')}
  looks list                              list built-in and saved themes
  looks show <theme> [--xmp]              print a theme (JSON, or as a Lightroom preset)
  looks save <name> [file] [options]      save a theme from a .json / .xmp file and/or flags
        --from <theme>                    start from an existing theme
        --set key=value                   set sliders (repeatable)
        -d, --description <text>
        --force                           replace an existing theme
  looks new <name> [--from <theme>]       create a theme file and open it in $EDITOR
  looks edit <name>                       open a saved theme in $EDITOR
  looks rm <name>                         delete a saved theme
  looks export <theme> [file] [--xmp]     write a theme to a file (or stdout)
  looks keys                              list every slider you can set
  looks path                              print the folder themes are saved in

${bold('Examples')}
  looks gta6 IMG_2041.HEIC
  looks gta6 *.jpg -o edited/ --strength 80%
  looks gta6 beach.jpg --exposure -0.3 --temp -10
  looks save moody --from gta6 --set contrast=45 --set grading.shadows.sat=35
  looks save film ~/Downloads/Kodak.xmp

Themes are saved in ${themesDir()}
`;

class UsageError extends Error {}

function fail(msg: string): never {
  throw new UsageError(msg);
}

function parseNumber(flag: string, v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v.trim().replace(/%$/, ''));
  if (!Number.isFinite(n)) fail(`${flag} needs a number, got "${v}".`);
  return n;
}

function parseStrength(v: string | undefined): number {
  if (v === undefined) return 1;
  const pct = v.trim().endsWith('%');
  let n = parseNumber('--strength', v)!;
  if (pct || n > 1) n /= 100;
  if (n < 0 || n > 1) fail('--strength must be between 0 and 1 (or 0% and 100%).');
  return n;
}

function applySets(settings: Settings, sets: string[] | undefined): Settings {
  let s = settings;
  for (const item of sets ?? []) {
    const eq = item.indexOf('=');
    if (eq < 1) fail(`--set expects key=value, got "${item}".`);
    const key = item.slice(0, eq);
    const ctl = resolvePath(key);
    if (!ctl) fail(`Unknown setting "${key}". Run "looks keys" to see them all.`);
    const value = parseNumber(`--set ${key}`, item.slice(eq + 1))!;
    if (value < ctl.min || value > ctl.max) fail(`${ctl.path} must be between ${ctl.min} and ${ctl.max}.`);
    s = setValue(s, ctl.path, value);
  }
  return s;
}

function warn(lines: string[], context: string): void {
  for (const w of lines) console.error(yellow(`warning (${context}): ${w}`));
}

// ------------------------------------------------------------------ apply

interface ApplyFlags {
  out?: string;
  strength?: string;
  exposure?: string;
  temp?: string;
  tint?: string;
  set?: string[];
  quality?: string;
  force?: boolean;
  'max-size'?: string;
}

function outputPathFor(input: string, themeName: string, flags: ApplyFlags, many: boolean): string {
  const ext = extname(input);
  const outExt = WRITABLE.has(ext.toLowerCase()) ? ext : '.jpg';
  const stem = basename(input, ext);
  const defaultName = `${stem}-${themeName}${outExt}`;
  if (!flags.out) return join(dirname(input), defaultName);
  const out = flags.out;
  const isDir = many || out.endsWith('/') || out.endsWith('\\') || (existsSync(out) && statSync(out).isDirectory());
  if (isDir) {
    mkdirSync(out, { recursive: true });
    return join(out, defaultName);
  }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  return extname(out) ? out : `${out}${outExt}`;
}

async function cmdApply(themeRef: string | undefined, images: string[], flags: ApplyFlags): Promise<void> {
  if (!themeRef) fail('Which theme? e.g. looks gta6 photo.jpg');
  if (!images.length) fail(`Which photo(s)? e.g. looks ${themeRef} photo.jpg`);
  const loaded = loadTheme(themeRef);
  warn(loaded.warnings, loaded.theme.name);

  // Per-photo nudges are relative to the theme, like dragging the slider from where the preset left it.
  let settings = loaded.theme.settings;
  const nudges: Array<[string, number | undefined, number, number]> = [
    ['exposure', parseNumber('--exposure', flags.exposure), -5, 5],
    ['temp', parseNumber('--temp', flags.temp), -100, 100],
    ['tint', parseNumber('--tint', flags.tint), -100, 100],
  ];
  for (const [key, delta, min, max] of nudges) {
    if (delta === undefined) continue;
    const base = (settings as Record<string, unknown>)[key];
    const next = (typeof base === 'number' ? base : 0) + delta;
    settings = setValue(settings, key, Math.min(max, Math.max(min, Math.round(next * 100) / 100)));
  }
  settings = applySets(settings, flags.set);
  const strength = parseStrength(flags.strength);
  const quality = parseNumber('--quality', flags.quality) ?? 92;
  const maxSize = parseNumber('--max-size', flags['max-size']);

  const many = images.length > 1;
  let failed = 0;
  for (const input of images) {
    const started = Date.now();
    try {
      if (!existsSync(input)) throw new Error('file not found');
      const out = outputPathFor(input, loaded.theme.name, flags, many);
      if (resolve(out) === resolve(input) && !flags.force) {
        throw new Error('output would overwrite the original; pass --force if you really want that');
      }
      const image = await readImage(input, maxSize);
      applySettings(image.img, settings, { strength, seed: 7 });
      await writeImage(out, image, { quality, sixteenBit: image.sixteenBit });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${green('✓')} ${input} ${dim('→')} ${out} ${dim(`(${image.img.width}×${image.img.height}, ${secs}s)`)}`);
    } catch (e) {
      failed++;
      console.error(`${red('✗')} ${input}: ${(e as Error).message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

// ------------------------------------------------------------------ themes

function cmdList(): void {
  const user = listUserThemes();
  const userNames = new Set(user.map((t) => t.name));
  console.log(bold('Built-in'));
  for (const t of BUILTIN_THEMES) {
    const shadowed = userNames.has(t.name) ? dim(' (replaced by your saved version)') : '';
    console.log(`  ${cyan(t.name.padEnd(16))} ${t.description ?? ''}${shadowed}`);
  }
  console.log(bold('\nSaved'));
  if (!user.length) console.log(dim(`  none yet — try: looks save mylook --from gta6 --set contrast=40`));
  for (const t of user) {
    if (t.error) console.log(`  ${red(t.name.padEnd(16))} ${red(`broken: ${t.error}`)}`);
    else console.log(`  ${cyan(t.name.padEnd(16))} ${t.theme?.description ?? ''}`);
  }
  console.log(dim(`\nSaved themes live in ${themesDir()}`));
}

function cmdShow(ref: string | undefined, xmp: boolean): void {
  if (!ref) fail('Which theme? e.g. looks show gta6');
  const { theme, origin, path, warnings } = loadTheme(ref);
  warn(warnings, theme.name);
  if (!xmp && process.stdout.isTTY) console.error(dim(`# ${origin}${path ? `: ${path}` : ''}`));
  process.stdout.write(xmp ? toXmp(theme) : themeToJson(theme));
}

function cmdExport(ref: string | undefined, file: string | undefined, xmpFlag: boolean): void {
  if (!ref) fail('Which theme? e.g. looks export gta6 gta6.xmp');
  const { theme } = loadTheme(ref);
  const asXmp = xmpFlag || (file ? extname(file).toLowerCase() === '.xmp' : false);
  const text = asXmp ? toXmp(theme) : themeToJson(theme);
  if (!file) {
    process.stdout.write(text);
    return;
  }
  writeFileSync(file, text);
  console.log(`${green('✓')} wrote ${file}${asXmp ? dim(' (Lightroom preset)') : ''}`);
}

function ensureNewName(name: string | undefined, force: boolean | undefined): string {
  if (!name) fail('Give the theme a name, e.g. looks save mylook ...');
  const bad = checkThemeName(name);
  if (bad) fail(bad);
  const lower = name.toLowerCase();
  if (existsSync(userThemePath(lower)) && !force) fail(`You already have a theme called "${lower}". Add --force to replace it.`);
  if (findBuiltin(lower) && !existsSync(userThemePath(lower)) && !force) {
    fail(`"${lower}" is a built-in theme. Add --force to save your own version over it.`);
  }
  return lower;
}

function cmdSave(name: string | undefined, file: string | undefined, flags: { from?: string; set?: string[]; description?: string; force?: boolean }): void {
  const finalName = ensureNewName(name, flags.force);
  if (!file && !flags.from && !flags.set?.length) {
    fail(`Nothing to save. Pass a .json/.xmp file, --from <theme>, or --set key=value. (Or "looks new ${finalName}" to start from a template.)`);
  }
  let settings: Settings = {};
  let description: string | undefined;
  let notes: string | undefined;
  if (flags.from) {
    const base = loadTheme(flags.from);
    settings = base.theme.settings;
    description = `Based on ${base.theme.name}.`;
  }
  if (file) {
    if (!existsSync(file)) fail(`File not found: ${file}`);
    const { theme, warnings } = readThemeFile(file, finalName);
    warn(warnings, basename(file));
    settings = mergeSettings(settings, theme.settings);
    description = theme.description ?? description;
    notes = theme.notes;
  }
  settings = applySets(settings, flags.set);
  const theme: Theme = { name: finalName, description: flags.description ?? description, notes, settings };
  const path = saveUserTheme(theme);
  console.log(`${green('✓')} saved ${cyan(finalName)} ${dim(`→ ${path}`)}`);
  console.log(dim(`  apply it with: looks ${finalName} photo.jpg`));
}

function openEditor(path: string): void {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor || !process.stdin.isTTY) {
    console.log(`Edit it here: ${path}`);
    return;
  }
  const res = spawnSync(`${editor} "${path.replace(/"/g, '\\"')}"`, { stdio: 'inherit', shell: true });
  if (res.status !== 0) console.error(yellow(`editor exited with status ${res.status}`));
  try {
    const { warnings } = readThemeFile(path, basename(path, '.json'));
    warn(warnings, basename(path));
    console.log(`${green('✓')} ${basename(path, '.json')} looks valid`);
  } catch (e) {
    console.error(red(`The theme file has a problem: ${(e as Error).message}`));
    process.exitCode = 1;
  }
}

const STARTER = (name: string) => `{
  "name": "${name}",
  "description": "",
  "settings": {
    "exposure": 0,
    "contrast": 0,
    "highlights": 0,
    "shadows": 0,
    "whites": 0,
    "blacks": 0,
    "temp": 0,
    "tint": 0,
    "vibrance": 0,
    "saturation": 0,
    "clarity": 0,
    "mixer": {
      "red": { "hue": 0, "sat": 0, "lum": 0 },
      "orange": { "hue": 0, "sat": 0, "lum": 0 },
      "yellow": { "hue": 0, "sat": 0, "lum": 0 },
      "green": { "hue": 0, "sat": 0, "lum": 0 },
      "aqua": { "hue": 0, "sat": 0, "lum": 0 },
      "blue": { "hue": 0, "sat": 0, "lum": 0 },
      "purple": { "hue": 0, "sat": 0, "lum": 0 },
      "magenta": { "hue": 0, "sat": 0, "lum": 0 }
    },
    "grading": {
      "shadows": { "hue": 0, "sat": 0, "lum": 0 },
      "midtones": { "hue": 0, "sat": 0, "lum": 0 },
      "highlights": { "hue": 0, "sat": 0, "lum": 0 }
    }
  }
}
`;

function cmdNew(name: string | undefined, flags: { from?: string; force?: boolean; description?: string }): void {
  const finalName = ensureNewName(name, flags.force);
  const path = userThemePath(finalName);
  mkdirSync(themesDir(), { recursive: true });
  if (flags.from) {
    const base = loadTheme(flags.from);
    writeFileSync(path, themeToJson({ ...base.theme, name: finalName, description: flags.description ?? `Based on ${base.theme.name}.` }));
  } else {
    writeFileSync(path, STARTER(finalName));
  }
  console.log(`${green('✓')} created ${cyan(finalName)} ${dim(`→ ${path}`)}`);
  openEditor(path);
}

function cmdEdit(name: string | undefined): void {
  if (!name) fail('Which theme? e.g. looks edit mylook');
  const lower = name.toLowerCase();
  const path = userThemePath(lower);
  if (!existsSync(path)) {
    const builtin = findBuiltin(lower);
    if (!builtin) fail(`No saved theme called "${lower}".`);
    saveUserTheme(builtin);
    console.log(dim(`Copied the built-in ${lower} to your themes so you can edit it.`));
  }
  openEditor(path);
}

function cmdRemove(name: string | undefined): void {
  if (!name) fail('Which theme? e.g. looks rm mylook');
  const path = removeUserTheme(name.toLowerCase());
  console.log(`${green('✓')} removed ${path}`);
}

function cmdKeys(): void {
  let group = '';
  for (const c of CONTROLS) {
    if (c.group !== group) {
      group = c.group;
      console.log(bold(`\n${group}`));
    }
    const range = `${c.min}..${c.max}${c.unit && c.unit !== '°' ? ` ${c.unit}` : c.unit ?? ''}`;
    const def = c.default ? dim(` (default ${c.default})`) : '';
    console.log(`  ${cyan(c.path.padEnd(28))} ${range}${def}`);
  }
  console.log(dim('\nCurves: put "curve": { "rgb": [[0,0],[64,58],[255,255]], "red": [...], ... } in a theme file (0..255 points).'));
}

// ------------------------------------------------------------------ main

const STRING_OPTS = ['out', 'strength', 'exposure', 'temp', 'tint', 'set', 'quality', 'from', 'description', 'max-size'];
const SHORT_STRING = ['-o', '-s', '-q', '-d'];

/** Lets people write "--exposure -0.5" instead of "--exposure=-0.5". */
function normaliseArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    const takesValue = (a.startsWith('--') && STRING_OPTS.includes(a.slice(2))) || SHORT_STRING.includes(a);
    if (takesValue && next !== undefined && /^-\d|^-\.\d/.test(next)) {
      out.push(`${a}=${next}`);
      i++;
    } else out.push(a);
  }
  return out;
}

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: normaliseArgv(argv),
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      strength: { type: 'string', short: 's' },
      exposure: { type: 'string' },
      temp: { type: 'string' },
      tint: { type: 'string' },
      set: { type: 'string', multiple: true },
      quality: { type: 'string', short: 'q' },
      'max-size': { type: 'string' },
      force: { type: 'boolean', short: 'f' },
      from: { type: 'string' },
      description: { type: 'string', short: 'd' },
      xmp: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.version) {
    console.log(VERSION);
    return;
  }
  const [cmd, ...rest] = positionals;
  if (values.help || !cmd || cmd === 'help') {
    process.stdout.write(HELP);
    return;
  }

  switch (cmd) {
    case 'apply':
      return cmdApply(rest[0], rest.slice(1), values);
    case 'list':
    case 'ls':
      return cmdList();
    case 'show':
      return cmdShow(rest[0], !!values.xmp);
    case 'export':
      return cmdExport(rest[0], rest[1], !!values.xmp);
    case 'save':
      return cmdSave(rest[0], rest[1], values);
    case 'new':
      return cmdNew(rest[0], values);
    case 'edit':
      return cmdEdit(rest[0]);
    case 'rm':
    case 'remove':
    case 'delete':
      return cmdRemove(rest[0]);
    case 'keys':
      return cmdKeys();
    case 'path':
      console.log(themesDir());
      return;
    case 'version':
      console.log(VERSION);
      return;
    default:
      return cmdApply(cmd, rest, values);
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  const err = e as Error & { code?: string };
  if (err instanceof UsageError || err.code?.startsWith('ERR_PARSE_ARGS')) {
    console.error(red(err.message));
    console.error(dim('Run "looks --help" for usage.'));
  } else {
    console.error(red(err.message || String(err)));
  }
  process.exitCode = 1;
});
