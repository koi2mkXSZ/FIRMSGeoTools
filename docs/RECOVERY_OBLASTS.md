# Recovery: Ukraine oblast boundaries

GeoWatch production uses `public.oblasts` with 27 administrative-region geometries in EPSG:4326.

The Stage 38 recovery migrations intentionally do **not** embed or export the production geometry dataset. Restore boundaries as a separate recovery step.

## Production reference

- Expected rows: **27**
- Geometry column: `geom`
- Geometry SRID: **4326**
- Production source label: `CDCgov/Ukraine-HIV-Recency`
- Production source IDs use values such as `UA01`

## Required target schema

The Stage 38 schema migration creates `public.oblasts`. Before enabling scheduled ingestion, populate these columns for each oblast:

- `code`
- `name`
- `name_uk`
- `name_en`
- `source`
- `source_id`
- `geom`

Do not copy production row IDs unless the import workflow explicitly depends on them. Let the identity key be generated and resolve references through the geographic lookup functions.

## Import procedure

1. Obtain the same or an equivalent authoritative Ukraine ADM1 boundary dataset covering all 27 production regions.
2. Convert source geometries to EPSG:4326.
3. Normalize polygon geometry to `MultiPolygon` where required.
4. Insert/upsert the 27 regions into `public.oblasts`.
5. Set `source` and `source_id` so the dataset provenance is auditable.
6. Run the validation SQL below.
7. Only after all checks pass, restore Vault secrets and install production cron jobs.

## Validation

```sql
select count(*) as oblast_count
from public.oblasts;
-- expected: 27

select
  count(*) filter (where geom is null) as missing_geometry,
  count(*) filter (where not extensions.st_isvalid(geom)) as invalid_geometry,
  count(*) filter (where extensions.st_srid(geom) <> 4326) as wrong_srid
from public.oblasts;
-- expected: 0 / 0 / 0

select code, name, source, source_id
from public.oblasts
order by name;
```

Validate spatial assignment with known points before enabling ingestion:

```sql
select public.lookup_oblast_id(50.4501, 30.5234);
```

The result must resolve to the Kyiv administrative region in the restored dataset.

## Important

Do not start the FIRMS ingestion cron while `public.oblasts` is empty or incomplete. Geographic assignment and downstream oblast analytics depend on this table.
