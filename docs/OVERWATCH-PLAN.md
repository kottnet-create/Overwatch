# Overwatch – technical plan

This document records the implementation plan for the personal home-energy dashboard.

## Goal

Build a local-first dashboard that combines the user's own energy systems, preserves timestamped history, and calculates energy flows and financial results without double-counting.

## Confirmed data sources

| Source | Intended responsibility | Integration status |
| --- | --- | --- |
| Huawei FusionSolar | PV generation | Investigate Northbound API access and account/installer permissions |
| Emaldo | Home battery charge, discharge and state of charge | Product confirmed: Power Store, 3 battery modules, 15.36 kWh total storage capacity. Owner describes system as 15 kW; official product information lists up to 10.8 kW charge/discharge. Customer API/access method still unconfirmed |
| Tibber + Tibber Pulse | Grid import/export, live power, consumption history and electricity prices | Official Tibber APIs available; confirm scopes and available fields for this account |
| Zaptec | EV charger state, charging sessions and energy | Charger confirmed: Zaptec Go. Official Zaptec Cloud REST API verified. Current developer guide says API access requires an owner/service UserGroup and access requested through Zaptec country representative or Support; current documented token flow is OAuth 2.0 password grant, planned to transition to authorization-code grant. Portal visibility alone does not confirm API access. Read-only integration must use GET endpoints only |
| myUplink / NIBE F1255 | Heat-pump measurements and, if exposed, software/version information | Official public myUplink v2 API and OAuth endpoints verified. GET endpoints expose systems, devices, parameter points, alarms and firmware info; API also has write endpoints, so Overwatch must request READSYSTEM only and implement GET-only calls. Exact F1255 points and account access remain to be verified |

## Architecture principles

1. **Read-only integrations.** Overwatch will not send commands or change settings on the inverter, battery, charger or heat pump.
2. **Server-side credentials only.** OAuth tokens, passwords, API keys and device identifiers must never be placed in `public/` or browser JavaScript.
3. **One adapter per provider.** Each adapter authenticates, fetches source data, normalizes units and timestamps, and reports source freshness.
4. **Canonical measurements.** Store original source, source timestamp, received timestamp, metric, value and unit. Preserve raw provider payloads only where useful and safe.
5. **No fabricated values.** Missing, stale or unavailable readings remain unknown/null, never silently converted to zero.
6. **No double counting.** Tibber Pulse is the primary source for grid exchange / whole-home net flow. PV production, battery flow and Zaptec charging are separate components used for attribution and reconciliation, not blindly added to the Pulse total.
7. **Separate energy and money.** kWh flows and SEK cost/revenue calculations are separate layers with explicit assumptions and tariff components.
8. **Keep history.** Store timestamped samples in persistent storage on the eventual always-on host/NAS. Backups and retention must be planned before production use.
9. **Build in stages.** First establish the canonical data model and demo UI, then integrate one source at a time and validate readings against the manufacturer's app.

## Initial energy model

The dashboard should distinguish at least:

- PV generation (kW / kWh)
- Grid import and grid export (kW / kWh)
- Battery charge and discharge power (kW), plus state of charge (%)
- Whole-home load (kW / kWh), where measurement semantics are verified
- EV charging power and session energy (kW / kWh)
- Heat-pump measurements exposed by the specific NIBE model
- Electricity spot price and applicable network/tax/supplier charges (SEK/kWh)
- Export compensation and other export-related credits (SEK/kWh)

A single instantaneous power reading is not enough to calculate energy: integrate valid, timestamped power samples over time or use authoritative energy counters. Every derived figure must identify its source and assumptions.

## NIBE monitoring and software information

The NIBE F1255 integration in Overwatch is **read-only**, regardless of which controls the myUplink mobile app may offer on the free account.

Planned information, subject to what myUplink actually exposes for this device/account:

- Current indoor/outdoor and relevant flow/return temperatures
- Hot-water temperatures and status
- Compressor frequency and operating information
- Brine in/out temperatures and other available heat-pump measurements
- Current software/firmware version and update availability, if exposed by the official API

Overwatch may display update/version information, but will not initiate firmware installation or change heat-pump settings. Users can continue to use the official myUplink app for any controls available under their subscription. Do not assume every possible F1255 reading or firmware action is available through the API.

## Initial financial model

Report separately:
- Imported electricity cost
- Variable grid charges and energy tax
- Fixed fees (shown separately, not allocated invisibly)
- Export revenue / credits
- Estimated value of self-consumed PV
- EV charging cost
- Battery charge/discharge and any measured/verified savings
- Net operating cost

Avoid claiming battery or solar "profit" without a stated counterfactual and verified tariff/efficiency assumptions. Present estimates separately from invoice-verified totals.

## First implementation milestones

### Milestone 1 – Foundation
- Rename visible product identity to Overwatch.
- Replace starter-specific labels and demo copy.
- Introduce provider-neutral measurement and source-status concepts.
- Keep synthetic demo data clearly marked as synthetic.
- Add tests for unit conversion, freshness, timestamp alignment and energy-balance calculations.

### Milestone 2 – Provider discovery
- Confirm exact models and account permissions.
- Confirm official API availability, rate limits, OAuth requirements and terms for each provider.
- Start with a read-only Tibber Pulse or myUplink proof of concept.
- Confirm the Emaldo integration route with Emaldo; do not depend on undocumented/private endpoints.

### Milestone 3 – Persistence and dashboard
- Add a private server-side adapter/collector.
- Persist data on a durable volume.
- Add energy-flow, history and cost views only after data is validated.

## Provider documentation to verify during implementation

- Tibber developer portal: https://developer.tibber.com/docs/
- Tibber Data API: https://data-api.tibber.com/docs/
- Zaptec developer guide: https://docs.zaptec.com/
- myUplink API: https://api.myuplink.com/swagger/index.html
- Huawei FusionSolar SmartPVMS manual / Northbound API account: https://info.support.huawei.com/Energy/info/en_US/solar/docView/EDOC1100612098

## Open questions

- Whether the FusionSolar company administrator/installer can create a Northbound API account and enable the required read-only plant/device data capabilities.
- Whether Emaldo provides a supported customer/partner API or export for the Power Store.
- Ask Zaptec whether they can provision a dedicated API UserGroup/service account for the private read-only Overwatch integration; separate portal user “Overwatch Zaptec” is active and has User + Owner roles on Immesstad 607.
- F1255 returns 499 public API points. Dashboard maps live values by their BT labels/names: outdoor temperature, BT2 supply, BT3 return, BT6 hot-water charge, BT7 hot-water top, BT10/BT11 brine in/out and BT12 condenser. User verified the displayed temperatures against myUplink. Local SQLite history is implemented: read-only collection at server start and every five minutes, 30-day retention, provider source timestamp plus polling timestamp, configurable database path via OVERWATCH_DB_PATH, and local history endpoints. Heat-pump history charts read the stored BT7 series; compressor chart remains empty until a matching compressor-frequency point is identified. Alarms and firmware info remain future GET-only tasks.
- Whether the Tibber Pulse is connected to the main electricity meter and which grid data fields are available.
- Electricity supplier, grid operator, tariff, fuse size and export compensation terms.
- NAS model and supported Node/Docker runtime.


## Camera monitoring

The camera UI is configuration-driven. The home overview contains compact camera panels and the Cameras page contains larger panels.

| Camera | Role | Status |
| --- | --- | --- |
| Tapo C520WS | Garage | User verified local RTSP access in VLC at 192.168.20.137:554. UniFi allows TCP 554 from 192.168.1.218 to the camera. Browser playback is not implemented; a server-side RTSP-to-WebRTC/HLS bridge is required. ONVIF PTZ support, ports and presets must be verified before controls are added. |
| Tapo C460 | Outdoor | Integration pending. Battery camera; local RTSP/ONVIF support has not been verified. |

The `/api/cameras` endpoint exposes metadata only. Stream URLs and credentials must remain server-side in local environment configuration and must never be returned to browser code. Add future cameras to `cameras.mjs`. This is UI/status scaffolding, not working browser live video or PTZ.
