# Overwatch — measurement storage architecture

Status: partially implemented. Shared storage module and NIBE adapter refactor are committed; Tibber migration is pending.
Branch: overwatch-foundation
Date: 2026-11-25

## Why this is needed

The current code has three independent history paths:

| Path | Current implementation | Current behavior |
| --- | --- | --- |
| NIBE / myUplink | nibe-history.mjs | SQLite at data/overwatch.sqlite; records selected BT points every five minutes; 30-day retention |
| Tibber Pulse | tibber.mjs + tibber-history.mjs | New samples are written to the shared SQLite database at five-minute intervals; existing data/tibber-history.json is read-only compatibility history until an explicit migration is verified |
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

## Energy-flow calculation contract

The backend has a pure calculation module in energy-flow.mjs. It is deliberately not wired to live provider data yet.

Normalized inputs and sign conventions:
- gridNet: W; positive means grid import, negative means export.
- solarPower: W; non-negative PV generation only.
- batteryNetPower: W; positive means battery discharge to the home, negative means charging.

Derived site load is calculated as:

`siteLoad = solarPower + gridNet + batteryNetPower`

The equation follows conservation of power: PV + grid import + battery discharge supplies site load + grid export + battery charging.

The calculation returns unavailable/null unless all three inputs have finite values, unit W, valid source and receipt timestamps, are no older than three minutes by receipt time, and have source timestamps within 90 seconds of one another. Negative solar values and a negative resulting site load are rejected as inconsistent. The result records its formula, input values, source labels and timestamp alignment.

Important: the module does not decide what provider fields mean. Provider adapters must independently verify field semantics and normalize signs before calling it. Tibber Pulse net grid exchange alone cannot distinguish PV generation from battery discharge. Do not connect the calculation to the current live dashboard until Huawei PV and Emaldo battery power are available and their sign/unit semantics are verified. EV charging is a component of site load, not an additional supply term.

## Migration plan — preserve data first

Implement in small, testable stages:

1. Add a shared SQLite storage module and tests without changing current live integrations.
2. Make NIBE use the shared module while preserving the existing table, database path, API response shape and 30-day retention. Verify that existing data/overwatch.sqlite rows remain readable.
3. Add Tibber writes to the same database while preserving /api/tibber/history response compatibility for the current UI. Implemented in tibber-history.mjs; local runtime verification is pending.
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

- New Tibber live samples now write to the same SQLite database as NIBE through tibber-history.mjs; existing JSON history is still read-only and has not been migrated.
- NIBE and Tibber now share the measurement-store abstraction for new samples, pending local runtime verification.
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


## Implementation progress

### Completed on 2026-11-25

- Added measurement-store.mjs with a shared SQLite API for batch inserts, bounded history/latest queries, source-filtered statistics, and retention cleanup.
- The module reuses the existing measurements table and index names, so it can open the current NIBE database without recreating or replacing its data.
- Refactored nibe-history.mjs to use the shared module while retaining the existing NIBE API response shape, 30-day retention, BT point filtering, and separate source/receipt timestamps.
- Added test/measurement-store.test.mjs with five tests covering persistence/reopen, duplicate delivery versus later polls, missing values and atomic rollback, reuse of a pre-existing NIBE table, and retention/query bounds.
- Isolated Node.js 22.16 smoke tests passed for the shared store and the NIBE wrapper. The repository-wide npm test suite has not yet been run against the updated branch.

### Still pending

- Added tibber-history.mjs and connected tibber.mjs to the shared SQLite measurement store. New Tibber samples retain provider and receipt timestamps, typed units, and the existing five-minute sampling guard.
- Existing data/tibber-history.json remains untouched and is loaded as legacy read-only history. No historical JSON-to-SQLite migration has been run.
- Added test/tibber-history.test.mjs for SQLite persistence, restart behavior, legacy-file preservation, field mapping, and sampling guards. These tests have not yet been run on the user's local Windows checkout.
- Existing data/overwatch.sqlite, data/tibber-history.json and data/tibber-prices.json have not been accessed or modified by these changes.
- The shared module is currently used by NIBE only. Do not describe all integrations as unified until Tibber has been migrated and verified.


## Provider-neutral data quality and status contract — 2026-11-26

A pure backend module, data-quality.mjs, now defines a common assessment contract. It is intentionally not wired into provider adapters, API routes, collection loops or the dashboard yet.

### Reading quality

assessReadingQuality(reading, options) distinguishes:
- missing: no reading supplied;
- invalid: malformed value/unit/timestamp, unexpected unit when an expected unit is supplied, or timestamps too far in the future;
- stale: either the provider source timestamp or Overwatch receipt timestamp is older than the configured maximum age;
- fresh: finite numeric value, non-empty unit, valid source and receipt timestamps, acceptable timestamp age, and matching expected unit when specified.

Default reading freshness is three minutes. A 30-second future tolerance allows small clock differences. Defaults can be overridden for metrics with different update cadences. This function does not interpret provider-specific field semantics, convert units, or decide whether a physical value is plausible.

### Connection status

assessConnectionStatus(config) assesses connection/configuration independently from measurement quality:
- not_configured when credentials/configuration are absent;
- connected, connecting, disconnected, error, needs_attention or unknown from a normalized status label;
- last-success freshness is reported separately as fresh, stale, invalid or unknown.

Default last-success freshness is ten minutes. A provider can therefore be connected while its last successful poll is stale, or connected while its latest measurement is stale. Missing last-success timestamps remain unknown rather than being fabricated.

### Combined source status

buildSourceStatus(...) returns provider, configured, connection, connectionFreshness, lastSuccessAt, connectionAgeMs, dataQuality, dataReason, readingAgeMs and usable.

usable is true only when the provider is configured, connection state is connected, last-success freshness is not stale/invalid, and the latest reading is fresh and valid. This is a conservative general-purpose gate; metric-specific checks and energy-flow alignment rules still apply separately.

### Implementation boundary

- The module is provider-neutral and side-effect free.
- No live integration, API response, dashboard component, polling cadence or stored measurement has been changed.
- Provider adapters must map their existing state to the normalized input contract before adoption.
- A provider with no confirmed API (for example Huawei or Emaldo) must remain not configured/unavailable; sample or demo data must not make it appear live.
- Future adapter integration should preserve the distinction between connection health, last successful contact and measurement freshness.

### Tests

test/data-quality.test.mjs covers fresh, missing, invalid, wrong-unit, stale and future-dated readings; connection-state mapping; independent connection freshness; combined usability; and unconfigured providers. Local Windows test execution is pending.
