# Changelog

All notable changes to FIRMSGeoTools are documented here.

## 1.0.0 — Stable

- completed Stage 8 fresh-project acceptance on a brand-new Supabase project;
- validated zero-to-one migrations, all Core Edge Functions, cron, RLS and recovery;
- validated real NASA FIRMS ingestion across NOAA-20, NOAA-21, Suomi NPP and MODIS;
- validated Telegram delivery and private admin webhook;
- validated Source Coverage and Notification Integrity;
- validated independent Geographic Integrity with missing_in_db = 0;
- published the static GitHub Pages Dashboard and validated signed API access;
- fixed fresh-install SQL delimiter defects found only by real deployment;
- fixed Dashboard hosting architecture and GitHub Pages URL handling;
- added Windows PowerShell 5.1-compatible secret generation;
- finalized stable release metadata and packaging.

## 0.7.0-pre — Stage 7 packaging

- added release metadata and schema version;
- added portable recovery export;
- added recovery unpack tool;
- added upgrade scripts for Windows and Linux/macOS;
- added optional operational data backup;
- added release manifest and automated release checks;
- added recovery, upgrade and release documentation.

## 0.6.0-pre — Stage 6

- self-hosted read-only Web Dashboard;
- signed HMAC access links;
- AOI/regions map;
- event search and analytics;
- integrity/coverage views;
- Dashboard probe in Doctor.

## 0.5.0-pre — Stage 5

- Notification Integrity;
- Source Coverage;
- robust source baseline;
- independent Geographic Integrity audit;
- API → AOI → DB reconciliation.

## 0.4.0-pre — Stage 4

- private Telegram admin panel;
- event detail;
- event search;
- coordinate-radius search;
- analytics across all configured regions.

## 0.3.0-pre — Stage 3

- installation Doctor;
- validation scripts;
- static/security CI;
- Deno type checking.

## 0.2.0-pre — Stage 2

- Telegram delivery;
- bootstrap-safe first import;
- lifecycle;
- parameterized cron;
- Windows/Linux installers.

## 0.1.0-pre — Stage 1

- generic AOI;
- optional regions;
- universal FIRMS worker;
- clean Core schema.
