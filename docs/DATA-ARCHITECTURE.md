# Overwatch — measurement storage architecture

Status: design decision, not yet implemented.
Branch: overwatch-foundation
Date: 2026-11-25

## Why this is needed

The current code has three independent history paths:

| Path | Current implementation | Current behavior |
| --- | --- | --- |
| NIBE / myUplink | nibe-history.mjs | SQLite at data/overwatch.sqlite; records selected BT points every five minutes; 30-day retention |
| Tibber Pulse | tibber.mjs | data/tibber-history.json; stores a sample no more often than every five minutes; keeps at most 9,000 samples |
| Generic recorder | history.mjs + collector.mjs | Schema-1 JSON at data/history.json; maximum 5,000 samples and 2 MB |

Tibber prices are separately cached in data/tibber-prices.json. The general recorder is not currently the persistent store used by the live Tibber or NIBE integrations.

This split makes retention, backup, querying and future dashboards harder to reason about. New integrations should not introduce another unrelated history format.

## Decision: one local SQLite time-series database

Use one SQLite database on the always-on host's reliable local storage for operational time-series data. The current Windows development machine remains supported. The eventual Raspberry Pi or other server should use the same application-level database contract.

The existing NIBE database is the starting point. Its measurements table already has most of the required canonical fields:

- source: provider/integration name, for example myUplink or Tibber
- system_id: provider account/site/home identifier where available
- device_id: provider device identifier or a stable logical device key
- parameter_id: stable metric/parameter identifier
- parameter_name: human-readable provider name
- value and unit: numeric measurement and explicit unit
- source_at: timestamp supplied by the provider/device
- received_at: timestamp when Overwatch received/polled the value

Keep both timestamps. They answer different questions: when the equipment says the value was measured, and when Overwatch actually obtained it.

### Storage rules

1. Provider adapters remain separate and read-only. They normalize values and timestamps, then write through a shared storage interface.
2. Store only finite, valid measurements. Missing, unavailable or invalid readings are not converted to zero.
3. Keep source identity and units on every stored measurement. Do not combine different providers merely because labels look similar.
4. Preserve repeated polls when useful: an unchanged NIBE value can still prove that the device was reachable at a later poll. The provider timestamp remains unchanged while received_at advances.
5. Prevent accidental duplicate inserts using a stable uniqueness key. Repeated polls and duplicate delivery must be distinguished deliberately; do not deduplicate solely on value.
6. Keep derived calculations (whole-home load, energy, cost, savings) separate from raw source measurements and record their assumptions.
7. Use parameterized SQL, bounded query windows, indexes for source/time and device/parameter/time, WAL mode, and a documented backup/checkpoint process.

### Tibber mapping

Tibber's live WebSocket message is one source event containing several fields. Store each available numeric field as a measurement row with the same source timestamp and receipt timestamp. Use explicit units, for example:

- power, powerProduction, minPower, averagePower, maxPower: W
- accumulatedConsumption, accumulatedProduction: use the unit documented by Tibber for the returned field; verify before persisting or displaying as kWh
- accumulatedCost: store the returned currency alongside the numeric value; do not assume SEK if the API says otherwise
- lastMeterProduction, lastMeterConsumption: verify the provider's semantics and unit before exposing them as energy totals

Do not infer a missing unit or reinterpret a cumulative counter as instantaneous power. Preserve Tibber's provider timestamp; record a separate local receipt timestamp.

Tibber spot-price forecasts are not ordinary live measurements. They can remain a separately cached dataset initially, or move to a dedicated SQLite price table later. Price rows must retain interval start, resolution, currency, energy/tax/total components, provider and fetched-at time. Do not mix forecast prices with measured consumption history.

### NIBE mapping

Continue recording the selected BT points and compressor-frequency point only when its exact identity has been verified. Keep the current 30-day retention initially. Do not expand the set of points automatically just because the API returns hundreds of parameters.

### Generic schema-1 recorder

Keep schema-1 JSON import/export as a portable interchange format for now. It is not the long-term operational database. Do not remove history.mjs or collector.mjs until the dashboard import/export workflow and any existing local history have a deliberate replacement.

## Migration plan — preserve data first

Implement in small, testable stages:

1. Add a shared SQLite storage module and tests without changing current live integrations.
2. Make NIBE use the shared module while preserving the existing table, database path, API response shape and 30-day retention. Verify that existing data/overwatch.sqlite rows remain readable.
3. Add Tibber writes to the same database while preserving /api/tibber/history response compatibility for the current UI.
4. Add a one-time, explicit migration for existing Tibber JSON history. Keep the original JSON files untouched as a backup until row counts and timestamp ranges have been verified. The old JSON format does not contain a separate receipt timestamp; migration must document that limitation rather than pretending the original receipt time is known.
5. Update the UI to read a provider-neutral history API where appropriate. Keep provider-specific status endpoints where they add value.
6. Retire the legacy JSON Tibber writer only after the SQLite path has passed tests and local verification.

No migration should delete, overwrite or silently truncate existing history.

## Retention, backup and hardware

- Start with 30 days of detailed operational measurements, then adjust based on actual database growth and the user's desired history depth.
- Keep the active SQLite database on local storage attached to the server. Do not use an SMB/NFS share on the ReadyNAS or future UNAS as the live SQLite database location.
- Back up the database to the NAS/UNAS using SQLite's backup API or a clean stopped/checkpointed copy. A raw copy of only the main SQLite file while WAL writes are active may be incomplete.
- Keep application code, private configuration, and persistent data in separate paths so the server can move from Windows to Raspberry Pi or a stronger host without changing integrations.
- Hardware sizing must be based on measured load, especially concurrent camera streams and collection work. Do not constrain application architecture to the current or planned Pi 5.

## Mobile, LAN and Fire TV access

The current server intentionally binds to 127.0.0.1 and rejects foreign Host headers. This is safe for the current single-PC development workflow, but it prevents a phone or Fire TV from reaching the dashboard.

Do not simply change the bind address to 0.0.0.0 or remove Host checks. Before LAN access is enabled, design and test:

- an authenticated access layer for dashboard and API requests;
- secure session handling and CSRF/origin protections for any write-capable routes;
- a narrowly scoped UniFi network policy, allowing only intended client devices/subnets;
- no public WAN port forwarding;
- a VPN-based route for access away from home;
- server-side secrets and camera stream credentials, never delivered to browser JavaScript.

The Fire TV Stick should act as a browser/display client only. All provider connections, credentials, polling and database writes stay on the server.

## Current implementation gaps

- Tibber history still writes to JSON, not the NIBE SQLite database.
- NIBE and Tibber do not yet share a storage abstraction.
- The generic schema-1 recorder remains separate and is not a unified multi-provider store.
- OVERWATCH_DB_PATH currently configures the NIBE SQLite database; it is not yet a general database setting for every integration.
- The current server is loopback-only; mobile and Fire TV access are not yet implemented.
- There is no verified automated SQLite backup/restore workflow yet.

## Acceptance criteria

- Existing NIBE history remains intact and query-compatible after the refactor.
- Tibber live history persists across server restarts in the same SQLite database.
- Provider timestamps and Overwatch receipt timestamps remain distinct.
- Missing or invalid values never become zero.
- A provider outage does not prevent other integrations or the dashboard from starting.
- Retention is enforced and tested.
- Tests use temporary databases and do not touch the user's real data/overwatch.sqlite.
- Existing JSON histories remain recoverable until migration is explicitly verified.
- No secrets or private data enter Git.
