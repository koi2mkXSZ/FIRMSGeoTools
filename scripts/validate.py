#!/usr/bin/env python3
import argparse,json,os,sys,urllib.request,urllib.error
from pathlib import Path

def load_env(path):
    p=Path(path)
    if not p.exists():
        raise SystemExit(f"Missing env file: {path}")
    for raw in p.read_text(encoding="utf-8").splitlines():
        line=raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k,v=line.split("=",1)
        os.environ.setdefault(k.strip(),v.strip())

def validate_local():
    checks=[]
    def add(i,s,m,fix=None):
        d={"id":i,"status":s,"message":m}
        if fix:d["fix"]=fix
        checks.append(d)

    ref=os.getenv("SUPABASE_PROJECT_REF","").strip()
    if ref and ref!="your-project-ref":
        add("local_project_ref","pass","SUPABASE_PROJECT_REF is set")
    else:
        add("local_project_ref","fail","SUPABASE_PROJECT_REF is missing or still uses the placeholder","Set the real project reference in .env.local.")

    for key in ("FIRMS_MAP_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","INSTALL_TOKEN"):
        if os.getenv(key,"").strip():
            add("local_"+key.lower(),"pass",f"{key} is set locally")
        else:
            add("local_"+key.lower(),"fail",f"{key} is missing locally",f"Set {key} in .env.local.")

    aoi=Path(os.getenv("AOI_FILE","config/aoi.geojson"))
    if not aoi.exists():
        add("local_aoi","fail",f"AOI file not found: {aoi}","Copy and edit config/aoi.example.geojson.")
    else:
        try:
            doc=json.loads(aoi.read_text(encoding="utf-8"))
            features=doc.get("features",[]) if isinstance(doc,dict) else []
            valid_types={"Polygon","MultiPolygon"}
            bad=[f for f in features if not isinstance(f,dict) or f.get("geometry",{}).get("type") not in valid_types]
            if doc.get("type")!="FeatureCollection" or not features:
                add("local_aoi","fail","AOI must be a non-empty GeoJSON FeatureCollection","Fix config/aoi.geojson.")
            elif bad:
                add("local_aoi","fail",f"AOI contains {len(bad)} unsupported geometry feature(s)","Use Polygon or MultiPolygon only.")
            else:
                add("local_aoi","pass",f"AOI GeoJSON parsed: {len(features)} feature(s)")
        except Exception as e:
            add("local_aoi","fail",f"AOI JSON parse failed: {e}","Fix GeoJSON syntax.")

    cfg=Path(os.getenv("CONFIG_FILE","config/monitoring.json"))
    if not cfg.exists():
        add("local_config","fail",f"Config file not found: {cfg}","Copy config/monitoring.example.json.")
    else:
        try:
            c=json.loads(cfg.read_text(encoding="utf-8"))
            poll=int(c.get("poll_interval_minutes",15))
            if poll<5 or poll>60:
                add("local_config","fail",f"poll_interval_minutes={poll} is outside 5..60","Use a value from 5 to 60.")
            else:
                add("local_config","pass",f"Monitoring config parsed; polling={poll} min")
        except Exception as e:
            add("local_config","fail",f"Monitoring config parse failed: {e}","Fix config/monitoring.json.")

    return checks

def call_doctor(telegram_test):
    ref=os.getenv("SUPABASE_PROJECT_REF","").strip()
    token=os.getenv("INSTALL_TOKEN","").strip()
    url=f"https://{ref}.supabase.co/functions/v1/firewatch-doctor"
    payload=json.dumps({"telegram_test":telegram_test}).encode()
    req=urllib.request.Request(
        url,data=payload,method="POST",
        headers={"Content-Type":"application/json","x-install-token":token}
    )
    try:
        with urllib.request.urlopen(req,timeout=120) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body=e.read().decode(errors="replace")
        try:
            data=json.loads(body)
            if isinstance(data,dict) and "status" in data:
                return data
        except Exception:
            pass
        raise RuntimeError(f"Doctor HTTP {e.code}: {body[:800]}")
    except Exception as e:
        raise RuntimeError(f"Doctor request failed: {e}")

def icon(s):
    return {"pass":"PASS","warn":"WARN","fail":"FAIL"}.get(s.upper() if False else s,"????")

def main():
    ap=argparse.ArgumentParser(description="Validate a FIRMSGeoTools clean install")
    ap.add_argument("--env",default=".env.local")
    ap.add_argument("--telegram-test",action="store_true",help="Send one silent Telegram test message")
    ap.add_argument("--strict",action="store_true",help="Treat WARN as non-zero exit status")
    args=ap.parse_args()

    load_env(args.env)
    local=validate_local()
    local_fail=any(x["status"]=="fail" for x in local)

    print("FIRMSGeoTools local validation")
    print("="*34)
    for x in local:
        print(f"[{x['status'].upper():4}] {x['message']}")
        if x.get("fix"): print(f"       Fix: {x['fix']}")

    if local_fail:
        print("\nRemote doctor skipped because local validation failed.")
        return 2

    print("\nFIRMSGeoTools remote doctor")
    print("="*34)
    try:
        report=call_doctor(args.telegram_test)
    except Exception as e:
        print(f"[FAIL] {e}")
        return 2

    for x in report.get("checks",[]):
        print(f"[{str(x.get('status','?')).upper():4}] {x.get('message','')}")
        if x.get("fix"): print(f"       Fix: {x['fix']}")

    s=report.get("summary",{})
    print("\nSummary:",f"PASS={s.get('pass',0)} WARN={s.get('warn',0)} FAIL={s.get('fail',0)}")
    print("Overall:",str(report.get("status","unknown")).upper())

    if report.get("status")=="fail":
        return 2
    if args.strict and report.get("status")=="warn":
        warnings=[x for x in report.get("checks",[]) if x.get("status")=="warn"]
        expected_learning=(
            warnings
            and all(x.get("id")=="source_baseline" for x in warnings)
            and str((report.get("integrity") or {}).get("source_baseline",{}).get("status",""))=="learning"
        )
        if not expected_learning:
            return 1
        print("Strict acceptance: baseline learning is expected on a fresh installation.")
    return 0

if __name__=="__main__":
    sys.exit(main())
