# HDR Editing for Safelight

A [Safelight](https://github.com/anthonyreimche/SafeLight) extension for HDR: highlights
brighter than SDR white, from your edit. Turn on **HDR** for a photo and the highlights
your SDR edit had to squeeze below white get room above it, up to a headroom you choose.
Your edit is still the SDR version, so every Safelight tool works as before and HDR off
is exactly the photo you had.

## What it does

- **HDR** switch per photo, in the **HDR** panel. Needs the current processing (photos
  edited before process versions show *Update processing*).
- **Headroom** (+0.5…+4 stops): how far above SDR white the brightest highlights go.
  **Start**: where the lift begins, in stops below SDR white. **Roll-off**: how many
  stops above the start it takes to reach 80 % of the headroom. **Highlight
  protection**: keeps highlights your edit deliberately darkened from being lifted.
- **HDR histogram**: the HDR version's brightness in stops, SDR range and HDR range.
- **HDR preview**: on an HDR display (Windows with HDR on, macOS), shows the HDR version
  live over the Develop view. Set **Preferences ▸ Extensions ▸ HDR Editing ▸ Display
  headroom** to what your display can show. It needs WebGPU; the panel says why when it
  can't run.
- **Visualize HDR**: on any display, paints the image by how far it goes above SDR white:
  blue (0–1 stop), green (1–2), yellow (2–3), red (3–4); SDR areas show as dimmed grey.
- **Export ▸ HDR ▸ HDR output**:
  - **Ultra HDR JPEG** (export format JPEG): a normal JPEG every app can open, with a
    gain map that viewers which read Ultra HDR or ISO 21496-1 gain maps (Chrome and
    Android among them) use to show it in HDR. Both Adobe (hdrgm) and ISO 21496-1
    metadata are written; the gain map is stored at the image's size (a viewer scales
    a gain map of another size to the image, as the format allows).
  - **HDR AVIF** (export format JPEG, PNG or WebP; the file becomes .avif): a 10-bit
    PQ / Rec.2020 AVIF. It is built from an sRGB render of the photo, so it carries no
    metadata and no output sharpening. Building it takes several seconds for a typical
    photo and longer for a large one at full size, in a background worker, so Safelight
    stays as responsive as during any other export.
    Its colour description is written in both the file's colour box and the AV1 stream;
    it is checked in Chromium.

  Photos with HDR off export as normal.

## How it works

The HDR version is your SDR edit with a per-pixel lift in stops, computed from the
scene's brightness before Safelight's default highlight roll-off compressed it
(Highlights and every other edit still shape it). That lift is exactly what a gain map
stores, so the preview, Visualize HDR, the histogram and both export formats all come
from the same SDR frame and gain map. Brightness only: colours keep their hue.

## Notes

- The preview needs an HDR display and WebGPU; HDR on Linux desktops is limited.
- HDR AVIF needs the extension installed (not loaded from a Developer Tools dev folder),
  because its 3.5 MB encoder and the worker that runs it load from the extension's
  folder on first use.
- Display headroom can't be read from the system, so it's a preference.
- Export processors that change the file type rely on Safelight 3.0.0's export hooks; with
  HDR output off, exports are untouched.
- Export add-ons run in the order their sections appear in the Export panel. One below
  HDR that re-encodes the file (a watermark, for example) drops the gain map or the HDR
  AVIF, so turn it off for HDR exports.

## Requirements

Safelight 3.0.0 or later.

## Licence

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
