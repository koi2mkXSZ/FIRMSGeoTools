#!/usr/bin/env python3
import json,sys
from pathlib import Path

if len(sys.argv)<2:
    raise SystemExit("usage: build_setup_payload.py AOI [REGIONS] [CONFIG]")

aoi_path=Path(sys.argv[1])
regions_path=Path(sys.argv[2]) if len(sys.argv)>2 and sys.argv[2] else None
config_path=Path(sys.argv[3]) if len(sys.argv)>3 and sys.argv[3] else None

payload={"aoi":json.loads(aoi_path.read_text(encoding="utf-8"))}

if regions_path and regions_path.exists():
    payload["regions"]=json.loads(regions_path.read_text(encoding="utf-8"))

if config_path and config_path.exists():
    cfg=json.loads(config_path.read_text(encoding="utf-8"))
    for k in ("project_name","timezone","poll_interval_minutes","event_match_hours","bootstrap_fresh_hours","inactive_after_hours","close_after_hours"):
        if k in cfg:
            payload[k]=cfg[k]
    if isinstance(cfg.get("telegram"),dict):
        payload["telegram_enabled"]=bool(cfg["telegram"].get("enabled",True))
    if isinstance(cfg.get("dashboard"),dict):
        payload["dashboard_enabled"]=bool(cfg["dashboard"].get("enabled",True))
        if cfg["dashboard"].get("public_url"):
            payload["dashboard_public_url"]=str(cfg["dashboard"]["public_url"])
    if isinstance(cfg.get("sources"),dict):
        payload["sources"]=cfg["sources"]
    if isinstance(cfg.get("event_match_radius_m"),dict):
        payload["event_match_radius_m"]=cfg["event_match_radius_m"]

print(json.dumps(payload,ensure_ascii=False,separators=(",",":")))
