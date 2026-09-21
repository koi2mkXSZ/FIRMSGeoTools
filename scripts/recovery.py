#!/usr/bin/env python3
import argparse,json,os,sys,urllib.request,urllib.error
from datetime import datetime,timezone
from pathlib import Path

def load_env(path):
    p=Path(path)
    if not p.exists(): raise SystemExit(f"Missing env file: {path}")
    for raw in p.read_text(encoding="utf-8").splitlines():
        line=raw.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k,v=line.split("=",1)
        os.environ.setdefault(k.strip(),v.strip())

def call_setup(mode):
    ref=os.getenv("SUPABASE_PROJECT_REF","").strip()
    token=os.getenv("INSTALL_TOKEN","").strip()
    if not ref or ref=="your-project-ref": raise RuntimeError("SUPABASE_PROJECT_REF is missing")
    if not token: raise RuntimeError("INSTALL_TOKEN is missing")
    url=f"https://{ref}.supabase.co/functions/v1/firewatch-setup"
    req=urllib.request.Request(
        url,data=json.dumps({"mode":mode}).encode("utf-8"),method="POST",
        headers={"Content-Type":"application/json","x-install-token":token}
    )
    try:
        with urllib.request.urlopen(req,timeout=120) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body=e.read().decode(errors="replace")
        raise RuntimeError(f"setup HTTP {e.code}: {body[:1200]}")

def cmd_export(args):
    load_env(args.env)
    data=call_setup("recovery_export")
    bundle=data.get("recovery")
    if not isinstance(bundle,dict): raise RuntimeError("Recovery payload missing")
    out=Path(args.output) if args.output else Path("backups")/f"firmsgeotools-recovery-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(bundle,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"Recovery bundle written: {out}")
    print("Secrets included: NO")
    return 0

def cmd_unpack(args):
    src=Path(args.bundle)
    doc=json.loads(src.read_text(encoding="utf-8"))
    if doc.get("format")!="FIRMSGeoTools-Recovery-v1":
        raise RuntimeError("Unsupported recovery bundle format")
    out=Path(args.output_dir)
    out.mkdir(parents=True,exist_ok=True)

    aoi=doc.get("aoi") or {"type":"FeatureCollection","features":[]}
    regions=doc.get("regions") or {"type":"FeatureCollection","features":[]}
    (out/"aoi.geojson").write_text(json.dumps(aoi,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    if regions.get("features"):
        (out/"regions.geojson").write_text(json.dumps(regions,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

    pc=doc.get("project_config") or {}
    sources=doc.get("sources") or []
    src_map={str(x.get("source_id")):bool(x.get("enabled",True)) for x in sources if x.get("source_id")}
    viirs=next((int(x.get("match_radius_m")) for x in sources if str(x.get("source_id","")).startswith("VIIRS_") and x.get("match_radius_m") is not None),750)
    modis=next((int(x.get("match_radius_m")) for x in sources if x.get("source_id")=="MODIS_NRT" and x.get("match_radius_m") is not None),1000)

    cfg={
      "project_name":pc.get("project_name","My FIRMS Monitor"),
      "profile":"core",
      "timezone":pc.get("timezone","UTC"),
      "poll_interval_minutes":pc.get("poll_interval_minutes",15),
      "event_match_hours":pc.get("event_match_hours",24),
      "bootstrap_fresh_hours":pc.get("bootstrap_fresh_hours",3),
      "inactive_after_hours":pc.get("inactive_after_hours",3),
      "close_after_hours":pc.get("close_after_hours",24),
      "sources":src_map,
      "event_match_radius_m":{"VIIRS":viirs,"MODIS":modis},
      "geo":{"mode":"custom_geojson","aoi_file":"config/aoi.geojson","regions_file":"config/regions.geojson" if regions.get("features") else None},
      "telegram":{"enabled":bool(pc.get("telegram_enabled",True))},
      "dashboard":{"enabled":bool(pc.get("dashboard_enabled",True))}
    }
    (out/"monitoring.json").write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"Recovery configuration unpacked into: {out}")
    print("Re-enter secrets in .env.local, then run the normal installer on a new Supabase project.")
    return 0

def main():
    ap=argparse.ArgumentParser(description="FIRMSGeoTools portable recovery")
    sub=ap.add_subparsers(dest="cmd",required=True)
    e=sub.add_parser("export");e.add_argument("--env",default=".env.local");e.add_argument("--output");e.set_defaults(fn=cmd_export)
    u=sub.add_parser("unpack");u.add_argument("bundle");u.add_argument("--output-dir",default="config");u.set_defaults(fn=cmd_unpack)
    args=ap.parse_args()
    try:return args.fn(args)
    except Exception as e:
        print(f"ERROR: {e}",file=sys.stderr);return 2

if __name__=="__main__": sys.exit(main())
