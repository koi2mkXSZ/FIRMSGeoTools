-- Stage 41.0.1 — disable EUMETSAT MTG LI
-- 2026-09-24

update public.osint_source_catalog
set enabled=false,
    notes=coalesce(notes,'') || ' Disabled 2026-09-24 by project decision: EUMETSAT Data Store credential/subscription dependency rejected.',
    updated_at=now()
where source_key='EUMETSAT_MTG_LI';

update public.event_environment_context
set lightning_status='disabled',
    lightning_product_count=0,
    lightning_products='[]'::jsonb,
    lightning_local_signal='disabled',
    updated_at=now();

-- firewatch_environment_context() is updated in production to expose
-- MTG LI as disabled and to keep RainViewer as the only active source
-- in the environment-context layer.
