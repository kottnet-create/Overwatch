# Overwatch – technical plan

This document records the first implementation plan for the personal home-energy dashboard.

## Goal

Build a read-only, local-first dashboard that combines the user's own energy systems, preserves timestamped history, and calculates energy flows and financial results without double-counting.

## Confirmed data sources

| Source | Intended responsibility | Integration status |
| --- | --- | --- |
| Huawei FusionSolar | PV generation | Investigate Northbound API access and account/installer permissions |
| Emaldo | Home battery charge, discharge and state of charge | API/access method not yet confirmed; ask Emaldo support before choosing an integration |
| Tibber + Tibber Pulse | Grid import/export, live power, consumption history and electricity prices | Official Tibber APIs available; confirm scopes and available fields for this account |
| Zaptec | EV charger state, charging sessions and energy | Official Zaptec API available; start read-only |
| myUplink / NIBE | Heat-pump measurements and operating data | Official myUplink Public API available; confirm exact heat-pump model and exposed points |

## Architecture principles

1. **Read-only first.** No commands that change battery, charger, inverter or heat-pump settings in the first versions.
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
- Start with Tibber Pulse or myUplink as a read-only proof of concept.
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

- Exact Huawei inverter model and whether installer/company admin can create a Northbound API account.
- Emaldo product model and whether Emaldo provides a supported customer/partner API or export.
- Zaptec charger model.
- NIBE heat-pump model.
- Whether the Tibber Pulse is connected to the main electricity meter and which grid data fields are available.
- Electricity supplier, grid operator, tariff, fuse size and export compensation terms.
- NAS model and supported Node/Docker runtime.
