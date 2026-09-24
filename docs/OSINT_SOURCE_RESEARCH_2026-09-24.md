# OSINT Source Research — 2026-09-24

## Integrated

| Source | Role | Auth | Stage 40 status |
|---|---|---|---|
| GDACS | global disaster alerts | none | mirrored to Fusion |
| NASA EONET v3 | curated natural events | none | mirrored to Fusion |
| Copernicus EMS Rapid Mapping | official emergency mapping | none | mirrored to Fusion |
| USGS Earthquake Catalog | independent geophysical context | none | active |
| Data.gov.ua / DSNS-MIA dataset | official Ukraine emergency open-data metadata | none | active |
| ReliefWeb / OCHA | curated humanitarian reporting | pre-approved appname | connector ready |

## Evaluated next

### Copernicus EFFIS

Very high value for GeoWatch. Official EFFIS publishes WMS data for active fires, burnt areas and Fire Weather Index. It should be integrated as an optional cached enrichment path rather than a blocking ingestion dependency.

### CAMS Fire Emissions Watch / GFAS

Useful for independent fire-emissions and smoke-plume context. The 2026 application is new; before production integration we need a stable documented machine endpoint rather than scraping the UI.

### DSNS per-incident publications

High-value official source, but the public web pages are not yet treated as a stable API. Prefer structured open-data/API endpoints over brittle HTML scraping.

## Design rule

A source is not considered corroboration merely because it repeats another provider. Strong corroboration requires independent providers, and the engine keeps provider/source-class identity separate from document count.
