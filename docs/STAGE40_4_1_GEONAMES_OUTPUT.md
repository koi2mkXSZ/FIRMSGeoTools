# Stage 40.4.1 — GeoNames normalized Telegram output

## Changes

GeoNames reverse-geocoding now uses:

- `lang=uk`
- `style=FULL`
- `localCountry=true`

The official GeoNames documentation states that `findNearbyPlaceName` supports the `lang` parameter for the returned name and that the distance field is expressed in kilometres.

Stored GeoNames place records now include:

- localized `name`
- canonical `toponym_name`
- filtered `alternate_names`
- `feature_class_name`
- `feature_code_name`
- feature class/code
- population
- distance in kilometres

Obvious metadata aliases such as Wikipedia URLs and Wikidata Q-IDs are removed from `alternate_names`.

## Telegram presentation

The client Deep OSINT view now formats GeoNames as individual rows instead of a comma-separated name list.

Example:

`• Здолбунів (Zdolbuniv) • 2.9 км • адм. центр уровня 3`

Common GeoNames feature codes are translated for operator readability:

- `PPL` → населённый пункт
- `PPLA` → административный центр
- `PPLA2` → адм. центр уровня 2
- `PPLA3` → адм. центр уровня 3
- `PPLA4` → адм. центр уровня 4

Admin output shows up to five GeoNames rows; client output shows up to three.

## Semantic integration

Filtered GeoNames alternate names are now included in the event-local semantic gazetteer together with:

- localized name
- canonical toponym
- admin1

This improves matching of historical/transliterated spellings without treating a nearby place as proof of event location.

## Validation

Event `eb9d8ee2` returned 15 GeoNames populated places.

Examples:

- Kvasyliv — 1.7 km — PPL
- Здолбунів (Zdolbuniv) — 2.9 km — PPLA3
- Колоденка (Kolodenka) — 5.9 km — PPL

The connector status remained `active`.
