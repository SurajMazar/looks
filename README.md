# looks

Save Lightroom-style photo looks as **named themes** and apply them in one command:

```bash
looks gta6 photo.jpg
```

…or in the browser, with live sliders and a before/after split: **[looks-omega.vercel.app](https://looks-omega.vercel.app)** (also on [GitHub Pages](https://surajmazar.github.io/looks/)).

Themes use the same sliders and units as Lightroom (Light, Color, Color Mixer, Color Grading, Detail, Effects, Tone Curve), so you can copy settings straight from Lightroom or a tutorial. You can also import Lightroom `.xmp` presets and export any theme back to `.xmp`.

Built-in themes, each transcribed slider-for-slider from a Lightroom tutorial:

- **`gta6`**: GTA VI / Vice City sunset. Teal shadows, candy-pink skies, warm highlights.
- **`cyberpunk`**: Cyberpunk: Edgerunners / Night City sunset. Electric blue skies, hot-pink horizons, purple shadows. Works best on dusk shots; on daylight photos add `--exposure -1.5` or so for a night feel.
- **`solo-leveling`**: Solo Leveling. Cold blue night, deep shadows, glowing cyan lights. Made for night and rainy streets.
- **`dandandan`**: Dandadan. Violet dusk skies, deep indigo shadows, a touch of grain.
- **`mushoku-tensei`**: Mushoku Tensei. Vivid storybook greens, bright cyan skies, soft warm highlights.

- **CLI**: batch-apply themes to JPEG, PNG, WebP, AVIF, TIFF and HEIC/HEIF photos (iPhone photos included).
- **Web app**: open a photo (HEIC too, in any browser), pick or tweak a look, download the result. Nothing is uploaded; it all runs in your browser.
- **One engine**: the CLI and the web app share the same TypeScript image engine, so a theme looks the same in both.

## Install the CLI

Needs [Node.js 24 LTS](https://nodejs.org) and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/SurajMazar/looks.git
cd looks
pnpm install
pnpm install:cli
```

`pnpm install:cli` builds the CLI and puts a `looks` command in `/usr/local/bin`, `/opt/homebrew/bin` or `~/.local/bin` (the first one you can write to). Pass a folder to choose: `sh scripts/install-cli.sh ~/bin`.

## Use it

```bash
looks gta6 IMG_2041.HEIC                      # → IMG_2041-gta6.jpg next to the photo
looks gta6 *.jpg -o edited/                    # a whole folder
looks gta6 beach.jpg --strength 70%            # blend with the original
looks gta6 night.jpg --exposure 0.6 --temp -10 # per-photo nudges
looks gta6 shot.jpg --set contrast=40 --set mixer.blue.sat=20
```

| Option | |
| --- | --- |
| `-o, --out <path>` | Output file, or a folder for several photos. Default: `<name>-<theme>.<ext>` beside the photo. |
| `-s, --strength <n>` | `0`–`1` or `0%`–`100%`. |
| `--exposure <ev>` | Added to the theme's exposure (`0.4` brighter, `-0.3` darker). |
| `--temp <n>`, `--tint <n>` | Nudge white balance (`-` cooler / greener, `+` warmer / more magenta). |
| `--set key=value` | Set any slider outright. `looks keys` lists them all. |
| `--max-size <px>` | Shrink so the long edge is at most this size. |
| `-q, --quality <1-100>` | JPEG / WebP / AVIF quality (default 92). |

### Save your own themes

```bash
looks save moody --from gta6 --set contrast=45 --set grading.shadows.sat=35
looks save film ~/Downloads/Kodak-Portra.xmp      # import a Lightroom preset
looks save mine mine.json                         # or a JSON theme (e.g. exported from the web app)
looks new clean                                   # start from a blank template in $EDITOR
looks edit moody
looks list
looks show moody            # JSON  (add --xmp for a Lightroom preset)
looks export moody moody.xmp
looks rm moody
```

### HEIC / iPhone photos

HEIC and HEIF files work everywhere. On macOS the CLI decodes them with the system's own decoder; on Linux and Windows, and in browsers other than Safari, it uses [libheif](https://github.com/strukturag/libheif) compiled to WebAssembly. iPhone photos are Display P3, so the colour profile stored in the file is converted to sRGB before the look is applied. Edited HEICs are saved as JPEG by default (or pass `-o photo.png` / `.webp` / `.avif`).

Themes are plain JSON files in `~/.config/looks/themes/` (or `$XDG_CONFIG_HOME/looks/themes`, or `$LOOKS_HOME/themes`). You can also pass a file directly: `looks ./warm.json photo.jpg`.

## Theme format

```json
{
  "name": "gta6",
  "description": "GTA VI / Vice City sunset look",
  "settings": {
    "exposure": -0.9,
    "contrast": 27, "highlights": -39, "shadows": 13, "whites": 14, "blacks": -23,
    "vibrance": 32, "saturation": 1,
    "mixer": {
      "yellow": { "hue": -26, "sat": -21, "lum": 9 },
      "aqua": { "hue": -9, "sat": 24, "lum": 12 }
    },
    "grading": {
      "shadows": { "hue": 196, "sat": 22, "lum": -6 },
      "midtones": { "hue": 326, "sat": 12, "lum": 2 },
      "highlights": { "hue": 33, "sat": 23, "lum": 6 }
    },
    "sharpening": { "amount": 33, "radius": 1, "detail": 23, "masking": 53 },
    "noiseReduction": { "luminance": 8, "color": 25 }
  }
}
```

Every value uses Lightroom's range (most sliders −100…100; exposure in stops; colour-grading hue 0…360). Leave out anything you don't change. Also supported: `temp`, `tint`, `texture`, `clarity`, `dehaze`, `parametric` (tone curve regions), `curve` (point curves as `[x, y]` pairs on 0…255 for `rgb`, `red`, `green`, `blue`), `vignette` and `grain`. The full list with ranges is in `looks keys`. The complete `gta6` theme is in [packages/core/themes/gta6.json](packages/core/themes/gta6.json).

## Web app

Live at **[surajmazar.github.io/looks](https://surajmazar.github.io/looks/)**, or run it locally:

```bash
pnpm dev        # http://localhost:5181
```

Drop or paste a photo (JPEG, PNG, WebP, AVIF or HEIC), pick a look, drag the divider to compare (or press `\`). Every Lightroom panel is there, including the Color Mixer dots and Color Grading wheels. Save themes in the browser, import `.json`/`.xmp`, export `.json` (for the CLI) or `.xmp` (for Lightroom), and download the edited photo at full resolution as JPEG, PNG or WebP.

`pnpm --filter @looks/web build` produces a static site in `apps/web/dist` that works on any static host.

### Deploy

- **Vercel**: [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FSurajMazar%2Flooks) or import the repo in Vercel with the default settings. [vercel.json](vercel.json) already sets the install command, build command, output folder and caching headers, so there is nothing to configure. Root Directory can be the repo root or `apps/web` (each has its own `vercel.json`); leave Build and Output overrides off. It installs only the web app's dependencies, using the pinned pnpm version, on Node 24.
- **GitHub Pages**: the CI workflow publishes it on every push to `main` while the repository variable `DEPLOY_PAGES` is `true`.

## How it works

`packages/core` is a dependency-free engine that runs in Node and in browsers. It follows Lightroom's order of operations: noise reduction → white balance and exposure (in linear light) → dehaze → Light panel tone curve (applied hue-preservingly, as Adobe's DNG SDK does) → point/parametric curves → texture and clarity → vibrance and saturation → Color Mixer and Color Grading (in OKLab) → sharpening → vignette → grain. Per-pixel stages are baked into a 3D LUT with tetrahedral interpolation on large images, so a 12-megapixel photo takes about 1.5 s.

Lightroom's exact algorithms aren't public, so this is a close match rather than a bit-exact one. The slider strengths were calibrated against before/after photos edited in Lightroom with the same settings.

```
packages/core   image engine, theme format, Lightroom XMP import/export, built-in themes
packages/cli    the `looks` command (sharp for image I/O)
apps/web        the web app (React + Vite, engine runs in a Web Worker)
```

## Develop

```bash
pnpm test        # engine + CLI tests
pnpm typecheck
pnpm build
```

## License

MIT. HEIC decoding uses [libheif-js](https://github.com/catdad-experiments/libheif-js) (LGPL-3.0), which is loaded as a separate module (a separate file in the web build) and only when a HEIC file is opened.
