# Stage 40.5.1 — Telegram visual previews

## Goal

When Deep OSINT has cached open visual reference imagery, Telegram should show the preview directly after the text report.

## Behavior

The `/deeposint <event-id>` command now:

1. sends the normal Deep OSINT text;
2. sends up to one Panoramax preview;
3. sends up to one OpenAerialMap preview.

Maximum extra media per command: two images.

The media path is fail-soft. A Telegram `sendPhoto` failure is logged but does not fail the Deep OSINT command.

## Panoramax

The visual parser now supports the actual Panoramax STAC asset structure:

- thumbnail: `assets.thumb.href` or `properties["geovisio:thumbnail"]`
- original/HD: `assets.hd.href`, then `assets.sd.href`, then `properties["geovisio:image"]`

Telegram caption includes:

- source
- distance from event
- capture date

The inline button **Открыть оригинал** points to the HD/image asset when available.

## OpenAerialMap

The parser now supports the current OAM STAC fields:

- thumbnail: `assets.thumbnail.href`
- primary visual COG: `assets.visual.href`
- platform: `properties["oam:platform_type"]`
- producer: `properties["oam:producer_name"]`

Telegram caption includes:

- source
- acquisition date
- platform
- GSD when available

The preview is the PNG thumbnail; GeoTIFF/COG is not passed to Telegram as a photo.

## Validation

Public live-source validation confirmed:

- Panoramax thumbnail returns HTTP 200 with `image/jpeg`
- OpenAerialMap thumbnail returns HTTP 200 with `image/png`

No current GeoWatch event has cached Panoramax/OAM coverage, so no unrelated test image was injected into the production Telegram bot.

## Interpretation

Every visual message is explicitly labeled as a visual reference.

The image itself is not automatically treated as confirmation of the fire event, damage, cause or attribution.
