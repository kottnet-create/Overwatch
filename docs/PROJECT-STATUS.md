# Overwatch — project status and chat handoff

Last updated: 2026-11-26

> This file is the quick-start memory for future development sessions. It summarizes the current project direction and points to the detailed technical plan. It is not a substitute for inspecting the actual code before editing it.

## Repository and working branch

- Repository: https://github.com/kottnet-create/Overwatch
- Active development branch confirmed during this update: `overwatch-foundation`
- Do not assume that `main` is the working branch. Do not make changes to `main` unless explicitly requested.
- Inspect the current branch, working tree and recent commits before making changes.
- Keep changes small, test them, and report exact files changed and test results.

## Read these files first

1. [Technical plan and detailed decisions](OVERWATCH-PLAN.md) — provider status, energy model, cameras, network notes, hardware plans and open questions.
2. [Connections guide](CONNECTIONS.md) — adapter boundary, credential handling and local-only architecture.
3. [Data format](DATA-FORMAT.md) — schema 1, metric keys, units, timestamp and freshness rules.
4. [Data architecture](DATA-ARCHITECTURE.md) — shared SQLite storage design, migration stages, retention, backups and secure multi-screen access.
5. [Repository README](../README.md) — actual application features and local run instructions.

## Product goal

Overwatch is a private, local-first home energy and equipment dashboard. It should bring together energy production, consumption, grid import/export, battery, EV charging, heat pump, costs and eventually camera monitoring. The UI direction requested by the user is dark/black with orange accents, compact readable text and a useful house/energy-flow visualization.

## Non-negotiable project principles

- Start read-only. Do not control devices or change settings unless the user explicitly approves a separately scoped feature.
- Keep API keys, passwords, OAuth tokens, camera credentials and private config out of Git and browser code.
- Keep provider credentials and device communication server-side.
- Preserve source timestamps and distinguish source time from polling/received time.
- Unknown, missing, stale or unavailable data must remain unknown/null, never silently become zero.
- Verify units and readings against manufacturer apps or another trusted meter.
- Avoid double-counting (especially site load, grid flow, solar, battery and EV charging).
- Keep provider integrations isolated so a failure in one does not take down the dashboard.
- Do not invent implementation status. Label features as implemented and verified, implemented but not verified, planned, or under investigation.
- Before changing code, inspect the actual files and current branch. Run relevant tests after changes.

## Energy integrations and equipment

- Tibber + Tibber Pulse: user has the free Tibber service and an API key. Do not assume Premium. Intended for grid import/export, live power, consumption and price data; exact available account fields/scopes still need confirmation.
- Huawei FusionSolar: solar generation. Official Northbound API access and account/installer permissions need confirmation.
- Emaldo Power Store: three battery modules, 15.36 kWh total storage capacity. Supported customer API/access route remains unconfirmed.
- Zaptec Go: read-only charger integration. API access and service/UserGroup permissions need confirmation.
- NIBE F1255 via myUplink: read-only monitoring. Detailed implementation status and point mapping are in OVERWATCH-PLAN.md and README.md.

### NIBE status recorded in the repository

The development branch README documents:
- 499 public myUplink points returned for the F1255.
- Live values mapped using BT labels/names; user verified displayed temperatures against myUplink.
- Local SQLite history implemented, collected at server start and every five minutes.
- 30-day retention; both provider source timestamp and polling timestamp are stored.
- Database path configurable using `OVERWATCH_DB_PATH`.
- Local history endpoints: `/api/myuplink/history?hours=24` (up to 720 hours) and `/api/myuplink/history/latest`.
- BT7 history chart uses stored data.
- Compressor activity is now verified against the NIBE app using myUplink parameter ID `41778` (`Aktuell kompressor­frek­vens`, Hz). The card and local history chart are working; the user confirmed the displayed 40.0 Hz matched the NIBE app on 2026-11-26.
- Alarm and firmware information are future GET-only tasks.

Verify these claims against the current code before relying on them.

## Camera integration status

### Tapo C520WS — garage

The repository README and technical plan record:
- Local RTSP source at camera address `192.168.20.137:554`.
- User confirmed live browser playback in Overwatch using go2rtc/WebRTC.
- go2rtc bridge is gated by `OVERWATCH_GO2RTC_ENABLED=true`.
- The public camera API should expose metadata only; RTSP credentials and source URLs remain server-side.
- ONVIF pan/tilt and preset save/recall were verified externally in Agent DVR on the IoT network.
- Overwatch server-side ONVIF adapter and PTZ UI were added, but installation/configuration and runtime verification from the Overwatch server remain to be completed.
- Cross-VLAN ONVIF has needed more than a simple TCP 2020 rule; do not broaden firewall access without testing.
- Zoom is not a priority.

Relevant files include `go2rtc.example.yaml`, `camera-ptz.env.example`, `cameras.mjs` and the camera-related server/UI code. Inspect the current code to confirm exact paths and behavior.

### Tapo C460 — outdoor battery/solar camera

The detailed research and network notes are in [OVERWATCH-PLAN.md](OVERWATCH-PLAN.md). Key constraints:
- User uses the normal TP-Link/Tapo cloud account for C460; the app did not offer a separate Camera Account for this model.
- User has 2FA enabled; authenticator/app code is primary and email is the backup method.
- User reports firmware 1.2.2; exact hardware/region/build should be confirmed before any more login attempts.
- Do not assume C460 supports the same RTSP/ONVIF/go2rtc path as C520WS. Treat it as a separate proprietary battery-camera integration.
- Investigated candidate route: a carefully pinned/reviewed pytapo-based Python sidecar for TP-Link Direct stream, controlled by the local Node server. This is research, not an implemented integration.
- Desired behavior: only wake/open the stream when the user explicitly opens the camera; stop and release the session when closed/idle; no repeated background polling or thumbnails.
- Existing network observations in OVERWATCH-PLAN.md indicate camera control/video ports were reachable only while the battery camera was awake/live in the Tapo app. Recheck DHCP address and reachability before firewall changes.
- Do not expose ports to the WAN.

#### Latest C460 authentication test — 2026-11-25

A local Python test was run from:
`C:\Overwatch-extra\Tapo-C460\venv\Scripts\python.exe`

The test used `getpass()` so the password was not echoed in the terminal. The user confirmed that they could not see the password while typing; this is expected behavior.

The library returned:
`Exception: Invalid authentication data`

Interpretation: authentication was rejected, but the result does not establish whether the password was wrong, whether 2FA is incompatible with the attempted flow, whether the firmware requires a different login sequence, or whether the library has a firmware-specific issue.

Important safety rule: do not ask the user to paste passwords or verification codes into chat. Do not repeat login/discovery attempts casually. Before another attempt, inspect the exact installed pytapo/pyTapo version and source/request sequence, compare with the latest documented fix for the reported C460 firmware, and plan one controlled test. Avoid assuming that `admin` plus the cloud password is a verified solution; it has only been discussed as a possibility and must be checked against authoritative/current library guidance first.

## User workflow and collaboration preferences

- The user works on Windows and prefers clear, step-by-step PowerShell instructions.
- Explain what each command does and ask for the output; do not ask for secrets.
- Make one change/test at a time, especially during device authentication and network troubleshooting.
- The user prefers starting a new ChatGPT chat when work branches into a separate area. Use this document and the detailed plan as the handoff.
- At the end of a substantial work session, update this status file and the relevant technical document with what changed, what was tested, results, remaining risks and the exact next step.

## Backup and record-keeping

Git history is useful but is not a complete backup by itself. For important milestones:
- Commit working code and documentation on the development branch.
- Keep a separate backup of private local configuration and persistent data, encrypted where appropriate; never commit secrets.
- Keep database backups separate from the live SQLite database.
- Do not commit `.env`, real `go2rtc.yaml`, camera credentials, API tokens, private datasets or `data/`.
- Test restore procedures periodically.
- Record hardware/network changes and verified IPs in the technical plan, but review them before applying firewall rules.

## First actions in a new chat

1. Read this file and [OVERWATCH-PLAN.md](OVERWATCH-PLAN.md).
2. Inspect the current GitHub branch and working tree/commit state.
3. Inspect the exact files involved in the requested task.
4. Confirm which parts are implemented and which are only planned.
5. Continue from the latest documented next step; do not restart completed work or make speculative changes.


## Private local configuration and credentials

Some details are required to make future sessions easy to resume, but secrets must never be placed in this repository or in a chat handoff.

- Keep actual API keys, passwords, account email addresses, OAuth refresh tokens, camera credentials and private device identifiers in a private local configuration file (normally `.env`) or a reputable password manager.
- The repository may contain only sanitized templates such as `.env.example` with variable names and placeholder values.
- Confirm that `.env*`, real camera bridge configuration, private keys and local data remain excluded by `.gitignore` before every commit.
- Back up the private configuration separately in an encrypted password manager or encrypted backup. Do not put an unencrypted copy in a shared folder or ordinary Git repository.
- For a new ChatGPT session, tell the assistant which local configuration file exists and which variable names are configured; do not paste the secret values. The assistant can guide the user to run local checks that confirm whether a value is present without printing it.
- Record non-secret account/setup metadata here when useful (provider, account type, 2FA method, API access status, which variables are required, where the local file lives). Never record the actual email/password/token.
- The assistant cannot directly read files on the user's PC just because their paths are documented here. The user must run commands locally or provide a sanitized output.

## Standard prompt to start every new Overwatch chat

Copy and paste this block into a new chat in the Overwatch Project:

```text
We are continuing the existing Overwatch project. Do not start over.

Repository: https://github.com/kottnet-create/Overwatch
Working branch: overwatch-foundation (verify the current branch before editing; do not change main unless I explicitly ask).

First read:
- docs/PROJECT-STATUS.md
- docs/OVERWATCH-PLAN.md
- README.md
- and any relevant integration/data documentation.

Then inspect the actual current repository state and the files relevant to my request. Treat GitHub code as the source of truth for implementation status; documentation is the record of decisions and handoffs. Do not assume planned work is implemented.

Project rules:
- Read-only integrations unless I explicitly approve otherwise.
- Never ask me to paste passwords, 2FA codes, API keys, tokens or private account details into chat.
- Secrets are stored locally in private .env/config files or a password manager. Use sanitized templates in Git only.
- Give me clear, one-step-at-a-time Windows PowerShell instructions.
- Make small changes, explain what they do, run relevant tests, and report exact files changed and results.
- Preserve working functionality; do not make speculative changes.
- Clearly distinguish verified, implemented-but-unverified, planned and unresolved items.

At the end of a substantial work session, update docs/PROJECT-STATUS.md and the relevant detailed documentation with decisions, files changed, tests/results, remaining issues and the exact next step. Do not commit secrets or private data.

My current task is: [WRITE THE TASK HERE]
```

## Chat handoff / near-capacity procedure

A chat cannot be relied on to detect its own remaining capacity or guarantee that it will automatically create a handoff before becoming full. The user should ask for a handoff when changing work areas, after a substantial milestone, or whenever the conversation becomes long.

When asked to prepare a handoff:
1. Summarize only decisions and results actually established in that chat.
2. Separate completed/verified, completed/unverified, in progress, planned and blocked work.
3. List exact files, branches, commands, test outputs and relevant commit IDs when known.
4. Record errors verbatim where useful and state what has and has not been tried.
5. Identify the next single action.
6. Update this file and the relevant technical document in the repository when GitHub access is available.
7. Provide the user with the short standard new-chat prompt above, plus a concise task-specific continuation note.
8. Never include secret values; refer only to local variable names/configuration locations.


## Routine summary after every 10 chats

To reduce information loss across conversations, use a checkpoint after approximately every 10 Overwatch chats:

1. At the start of a new Overwatch chat, if the user mentions the checkpoint or asks for a handoff, check whether a recent checkpoint is recorded here. Do not claim to know the exact total number of chats unless the user has supplied the count.
2. When the user says 10 chats have passed, or asks for the 10-chat checkpoint, prepare a consolidated summary of decisions, verified implementation, unresolved issues, important commands/results, relevant files and the next steps.
3. Update this status file and the relevant technical documentation on the active development branch when GitHub access is available.
4. Give the user a short continuation note/prompt that can be pasted into the next chat.
5. Also prepare a checkpoint sooner after a major milestone or when a chat is becoming long; do not wait for the 10-chat mark if that risks losing information.

Limitation: ChatGPT cannot reliably count all separate chats in the background, monitor chat creation, or trigger a summary automatically at exactly chat number 10. Treat this as a collaboration procedure, not an automatic scheduled trigger. If the count is uncertain, make a checkpoint when the user asks or when a substantial milestone is reached.


## Backend and storage review — 2026-11-25

Reviewed the current implementation on the active branch. The branch head at review time was b7920c3588ec07a09e98fb5a2fc4718e62887f4c.

Confirmed current storage paths:
- NIBE / myUplink: data/overwatch.sqlite through nibe-history.mjs, 30-day retention, source_at and received_at timestamps.
- Tibber live history: data/tibber-history.json, 5-minute minimum storage interval, maximum 9,000 samples.
- Tibber spot prices: data/tibber-prices.json.
- Generic schema-1 recorder: data/history.json, maximum 5,000 samples and 2 MB.
- OVERWATCH_DB_PATH currently configures the NIBE SQLite database only.

Added docs/DATA-ARCHITECTURE.md as a design decision for moving operational time-series data into one local SQLite database while retaining provider-specific adapters and preserving existing data. This is documentation only; no integration code or local database has been changed by this step.

Important access finding: server.mjs binds to 127.0.0.1 and rejects non-local Host headers. This is intentional protection, but mobile and Fire TV access are not implemented. Do not remove these protections or bind to 0.0.0.0 until an authenticated LAN/VPN access layer and scoped UniFi rules are designed.

Next implementation step:
1. Add and test a shared SQLite storage module without changing current live integrations.
2. Refactor NIBE to use it without changing the existing measurements table or API response.
3. Add Tibber storage to the same database, preserving the existing /api/tibber/history response for the UI.
4. Migrate old Tibber JSON only through an explicit non-destructive migration, retaining the source files until verified.

Existing data/history.json, data/tibber-history.json, data/tibber-prices.json and data/overwatch.sqlite must remain untouched during the initial shared-store implementation. Tests must use temporary databases.


## Shared measurement store implementation — 2026-11-25

Current implementation progress is recorded in docs/DATA-ARCHITECTURE.md.

Completed on overwatch-foundation:
- Added measurement-store.mjs. It reuses the existing measurements schema, writes batches transactionally, preserves source_at and received_at separately, skips missing/non-numeric values, and supports bounded history/latest queries and retention cleanup.
- Refactored nibe-history.mjs to use the shared store while preserving its existing response shapes and 30-day retention.
- Added test/measurement-store.test.mjs with five focused tests.

Validation performed in an isolated Node.js 22.16 environment:
- Shared store smoke tests passed.
- NIBE shared-store compatibility smoke test passed.
- The complete repository npm test suite has not yet been run after these commits. User should run npm.cmd test locally before any further live-data changes.

No live local data was migrated or modified. Tibber remains on data/tibber-history.json and price cache remains data/tibber-prices.json. Next step is to run the full existing test suite, then migrate Tibber writes with response compatibility and a non-destructive legacy-history migration. Do not change the current loopback-only server access policy in this storage task.


## Energy-flow and data-quality foundation — 2026-11-26

Branch: `overwatch-foundation`. The branch was inspected before this work; the starting head was `654b0797a16704187596b81ce1b105a2d0c9d1d0`. No changes were made to `main`.

Added:
- `energy-flow.mjs`: pure backend calculation for normalized grid, PV and battery power readings. It uses explicit sign conventions and refuses to derive site load when values are missing, stale, misaligned, invalid or physically inconsistent.
- `test/energy-flow.test.mjs`: focused tests for energy-balance arithmetic, sign handling, missing/stale inputs, timestamp skew and unit validation.
- `docs/DATA-ARCHITECTURE.md`: documents the energy-flow contract and explicitly states that the calculation is not yet connected to live provider data.

Calculation contract:
- Grid: positive import, negative export.
- Solar: non-negative generation.
- Battery: positive discharge, negative charge.
- Derived site load = solar + grid net + battery net.
- All inputs must be W, have valid source/receipt timestamps, be received within 3 minutes and have source timestamps within 90 seconds.
- Provider adapters must verify provider field semantics before normalizing. Tibber Pulse net grid flow alone cannot identify whether export is from PV or battery.

Validation status:
- GitHub writes completed on `overwatch-foundation`.
- Tests have NOT yet been run locally against the user's Windows checkout.
- The new calculation module is not wired into the live dashboard or provider integrations.
- Existing NIBE/Tibber behavior and local data files have not been changed by this work.
- Do not claim live whole-home load calculation is available until Huawei PV and Emaldo battery measurements are available and verified.

Next step:
1. User runs `git fetch origin` and `git merge --ff-only origin/overwatch-foundation`.
2. Run `npm.cmd test` and share the result.
3. If tests pass, add a separate provider-neutral data-quality/status layer before connecting live normalized readings to the energy calculation.


## Provider-neutral data-quality foundation — 2026-11-26

Branch: overwatch-foundation. No changes to main.

Added:
- data-quality.mjs: pure helpers assessReadingQuality, assessConnectionStatus and buildSourceStatus.
- test/data-quality.test.mjs: focused tests for reading validity/freshness, connection state, independent last-success freshness, combined usability and unconfigured providers.
- docs/DATA-ARCHITECTURE.md: documents the shared status contract and its integration boundary.

Contract:
- Connection state and measurement quality are separate dimensions.
- Reading quality is missing, invalid, stale or fresh.
- Connection state is not_configured, connected, connecting, disconnected, error, needs_attention or unknown.
- Last successful contact freshness is fresh, stale, invalid or unknown.
- A source is usable only when configured, connected, connection freshness is acceptable and its latest reading is fresh.
- Defaults: three-minute reading freshness, 30-second future-clock tolerance and ten-minute last-success freshness.
- The module does not interpret provider fields, convert units, poll APIs or change stored/live data.

Status:
- Files have been created on the remote development branch.
- Local Windows tests have not yet been run.
- No provider adapters, API routes, dashboard code, collection loops or live data were changed.
- The previous 18/18 test result applies to the pre-existing suite before these new tests; rerun the complete suite after pulling.

Next step:
1. User runs git fetch origin and git merge --ff-only origin/overwatch-foundation.
2. Run npm.cmd test and share the full result.
3. Fix any failures before integrating the module into Tibber, myUplink or Nord Pool.
4. Only after tests pass, map existing provider statuses into the common contract in small, separately tested changes. Leave Huawei, Emaldo and Zaptec unavailable until access is verified.


## Tibber data-quality adapter — 2026-11-26

Added:
- tibber-quality.mjs: maps the existing Tibber monitor status and latest live power sample into the shared data-quality contract.
- test/tibber-quality.test.mjs: five adapter tests.

The adapter only assesses Tibber live power as a W reading with source and receipt timestamps. It does not infer PV production, battery flow or import/export sign semantics. It does not change Tibber collection, WebSocket lifecycle, history storage, API routes or dashboard. It is not yet exposed to the UI.

Local Windows test execution is pending. Next step: pull the branch and run npm.cmd test; after passing, consider a read-only aggregate status endpoint. Other providers remain unadapted.


## myUplink / NIBE data-quality adapter — 2026-11-26

Added:
- nibe-quality.mjs: assesses latest locally stored NIBE readings using the shared data-quality helper.
- test/nibe-quality.test.mjs: six tests covering fresh, stale, mixed, missing and invalid measurements, plus connection/configuration distinction.

Accuracy safeguard:
- Existing /api/myuplink/status only confirms that an OAuth token is stored; it does not verify a live API connection.
- The adapter therefore reports connection=unknown when configured, and not_configured when no token exists. It does not falsely claim connected.
- Data quality is assessed per point using source timestamp, receipt timestamp, value and unit. Mixed results are reported as partial.
- usable remains false until a live API success timestamp is available and the source can be verified.

No OAuth, polling, NIBE history storage, SQLite schema, dashboard or API routes were changed. Local Windows test execution is pending. Next: pull and run npm.cmd test; then implement a safe live-contact timestamp only if it can be recorded without changing collection semantics.


## Nord Pool price-quality adapter — 2026-11-26

Added:
- nordpool-quality.mjs: assesses cached SE3 price snapshots from the existing Nord Pool/Spotpris.nu module.
- test/nordpool-quality.test.mjs: seven tests for fresh valid prices, future intervals, missing cache, stale cache, malformed intervals, wrong market units, upstream errors and optional current interval.

Assessment uses fetchedAt (30-minute default freshness), not interval startsAt, because future price periods are expected. The adapter checks SE3, SEK, SEK/kWh and finite interval prices. A refresh error makes the source unusable while preserving the error and cached series metadata.

No Nord Pool fetch, conversion, cache, retry, endpoint or graph behavior changed. Local Windows test execution is pending.
Next step: pull branch, run npm.cmd test (expected 43 tests), then implement a read-only aggregate source-status endpoint.


## Aggregate source status API — 2026-11-26

Added GET /api/status in server.mjs. It composes the Tibber, NIBE and Nord Pool quality adapters and returns generatedAt, summary counts and per-provider status. It is read-only, does not trigger provider refreshes, and does not expose credential/token fields. NIBE remains connection=unknown when the only evidence is a locally stored OAuth token.

Added test/status-api.test.mjs with route tests for all three providers, unavailable/missing providers, summary counts and token non-disclosure.

Local Windows test execution is pending. Expected suite size after this change: 45 tests. Pull the development branch and run npm.cmd test before treating the endpoint as verified. Dashboard does not consume /api/status yet.


## NIBE status response compacting — 2026-11-26

The first live /api/status response exposed that nibeHistory.getLatest() returns a bounded set of recent history rows (up to 499), not one latest row per parameter. The NIBE quality adapter now deduplicates by parameterId/parameterName and assesses only the newest received sample for each point. This keeps the aggregate status response compact and prevents old historical samples from dominating the current per-point quality assessment. Added a regression test. Local verification pending.


## NIBE live status correction — 2026-11-26

User verified GET /api/myuplink/systems returns connected=true and device connectionState=Connected for Nibe F1255. The aggregate status was incorrectly hardcoding NIBE connection=unknown because it only inspected local token status.

Updated:
- myuplink.mjs: added read-only connectionStatus() calling /v2/systems/me and mapping device connectionState.
- server.mjs: GET /api/status awaits live connectionStatus(); errors become an explicit error state.
- nibe-quality.mjs: consumes live state and lastSuccessAt; NIBE snapshot freshness uses receivedAt (poll time), while sourceTimestamp is retained as sourceAgeMs because it can represent last value change. Seven-minute snapshot freshness aligns with five-minute polling.
- test/nibe-quality.test.mjs: regression test for live connected status with an unchanged older source timestamp and fresh poll receipt.
- docs/DATA-ARCHITECTURE.md updated.

Local Windows tests have not yet been run. Pull branch and run npm.cmd test. Expected suite size after the added live-status route regression test: 48 tests. Then restart the server and inspect /api/status. No NIBE controls, data deletion or migration were performed.


## NIBE history quality diagnostics — 2026-11-26

Added a read-only per-point history quality endpoint on overwatch-foundation:
- GET /api/myuplink/history/quality?hours=720
- Uses the existing SQLite measurements table; no schema migration or live-data changes.
- Reports one row per NIBE point with sample count, first/last poll receipt, latest value/unit, source timestamp, receipt age and fresh/stale classification.
- Seven-minute freshness threshold aligns with the five-minute collection interval.
- Query window is bounded to 1–720 hours.
- Existing history endpoints remain unchanged.
- Added tests for per-point SQL aggregation and endpoint response.
- Updated DATA-ARCHITECTURE.md.

Files changed: measurement-store.mjs, nibe-history.mjs, server.mjs, nibe-quality.mjs, test/measurement-store.test.mjs, test/status-api.test.mjs, docs/DATA-ARCHITECTURE.md, docs/PROJECT-STATUS.md.
Local Windows test suite has not yet been run for these changes. Next: fetch/fast-forward overwatch-foundation, run npm.cmd test, then inspect /api/myuplink/history/quality?hours=24 and the 720-hour overview. No live SQLite database has been modified by the code authoring operation.


## NIBE collection-gap diagnostics — 2026-11-26

Extended GET /api/myuplink/history/quality?hours=... with two per-point fields:
- `gapsOver10Minutes`: number of intervals between successive stored samples longer than ten minutes.
- `maxGapMinutes`: longest interval between successive stored samples, rounded to two decimals.

This is calculated from `received_at` using SQLite LAG/window functions. It is read-only; no schema changes, migrations or live-data modifications. It helps verify whether five-minute collection has been continuous but does not diagnose the cause of any gap.

Added tests for a deliberate 15-minute collection gap and for the endpoint response fields. Local Windows tests are pending. Next: fetch/fast-forward, run `npm.cmd test`, then inspect the 720-hour quality endpoint again. Do not restart or edit the running server until the local test result is known.


## NIBE history coverage and automatic retention — 2026-11-26

Added to the per-point history quality endpoint:
- `expectedSamples`: expected five-minute samples for the requested window (`ceil(hours * 12)`).
- `coveragePercent`: sample count divided by expected samples, capped at 100 and rounded to two decimals.
- `coveredHours`: elapsed time between first and latest received sample.

Retention enforcement now runs when the SQLite store opens, after each batch write, and hourly from the server independently of NIBE polling. The hourly timer is unref'd and cleared on server close. Existing history API payloads and schema are unchanged; cleanup remains based on `received_at` and the 30-day NIBE retention setting.

Added tests for coverage calculation and startup pruning. Local Windows test execution is pending. Next: fetch/fast-forward `overwatch-foundation`, run `npm.cmd test`, then restart the local server and inspect `/api/myuplink/history/quality?hours=720`. Do not claim the new behavior is locally verified until the test suite passes.


### Local verification update — 2026-11-26

The user pulled the NIBE history coverage/retention changes and ran `npm.cmd test` on Windows. Result: **53 tests passed, 0 failed**. This verifies the test suite locally. The remaining live check is to restart the local server so it loads the new code and inspect `/api/myuplink/history/quality?hours=720` for `expectedSamples`, `coveragePercent`, and `coveredHours` across the nine NIBE points. The retention implementation is covered by a startup-pruning test; a full 30-day expiry against the user's live database has not been forced or manually tested.


## Read-only NIBE compressor point discovery — 2026-11-26

Added `GET /api/myuplink/points/diagnostics`. It fetches the existing read-only myUplink point catalogue and returns only likely compressor/frequency candidates with parameter ID, name, numeric value (when available), unit and source timestamp, plus total catalogue size. This is diagnostic discovery only: candidates are not added to collection/history and no NIBE settings or device state are changed. Candidate matching is heuristic and the exact point meaning/unit must be verified before collection is enabled. Added unit and route tests. Local Windows test execution is pending.

Next: pull `overwatch-foundation`, run `npm.cmd test`, then open `http://127.0.0.1:8780/api/myuplink/points/diagnostics` and share the result. Use the result to identify the correct compressor-frequency point without guessing its parameter ID.


### Expanded NIBE point search — 2026-11-26

The user inspected the first diagnostic response: 499 points, 28 name-based candidates, but no confirmed compressor-frequency point. Expanded the read-only diagnostics to scan the full catalogue for frequency-like units (Hz/kHz/MHz/rpm/r/min/1/min/min^-1/s^-1) as well as names containing compressor, frequency, speed, motor or pump clues. The endpoint also reports counts for every observed unit. It remains diagnostic only and does not enable collection for any candidate. Added tests for unit-based discovery. Local test execution is pending.

Next: pull `overwatch-foundation`, run `npm.cmd test`, restart the local server, and reopen `http://127.0.0.1:8780/api/myuplink/points/diagnostics`. Review `frequencyUnitCount`, `unitCounts`, and the candidates. If no credible frequency point appears, do not invent one; mark the compressor frequency unavailable through this myUplink point catalogue and continue with other priorities.


## Verified NIBE compressor-frequency point — 2026-11-26

Correction (2026-11-26): the live compressor-frequency point is parameter ID `41778`, `Aktuell kompressor­frek­vens`, unit `Hz`. Parameter `43122` is the minimum compressor frequency, not the live frequency.

Implementation on `overwatch-foundation`:
- NIBE history collection explicitly recognizes parameter ID `41778` as well as the existing localized/English name patterns.
- The Heat pump view recognizes this parameter ID for the compressor activity card and its history chart, so the mapping does not depend solely on the provider's display name.
- The point remains read-only. Frequency is activity data in Hz, not electrical power.
- Added a temporary-SQLite test to verify that the point is recorded and returned by the history API wrapper without recording unrelated catalogue points.

The user restarted the local server and confirmed the current compressor card shows 40.0 Hz, matching the official NIBE app. The card displays a current update time and its history chart has begun collecting samples (4 saved samples observed). The full local test suite subsequently passed: 58 tests, 0 failures. Existing SQLite history was preserved; old rows for parameter 43122 were not deleted.

## Thermal page startup fallback — 2026-11-26

Investigated the user's report that refreshing the browser sometimes showed synthetic hot-water/outdoor/compressor cards instead of NIBE readings. The live status API and Connections page showed Tibber, myUplink/NIBE and Nord Pool connected with fresh data. In `public/app.js`, the thermal view rendered demo cards whenever NIBE points had not yet finished loading. This could briefly present synthetic values during startup and could leave the view in demo fallback when point loading failed.

Changed on `overwatch-foundation`:
- Added an explicit NIBE loading state to the thermal page.
- While myUplink is loading, the page now shows a waiting card and waiting history message instead of synthetic values.
- After real NIBE points/history load, the page rerenders from the actual data.
- If myUplink or point loading fails, the page shows an unavailable state rather than inventing readings.
- Synthetic thermal cards remain available only when the user explicitly selects Demo.

Commit(s): `51ce183f28e3345f7e55b08c405b64d93be34a78`, `606b4c9a884175a45bdc04a86c6355fe7b405f38`.

Verification: code reviewed after the GitHub updates. Browser runtime verification and the local `npm.cmd test` run are still pending. No server integration, SQLite data or provider credentials were changed.


## NIBE cards render independently of history loading — 2026-11-26

The user reported that after browser refresh the Heat pump page sometimes remained on a single “WAITING FOR NIBE” card, while switching to another page and back made the real measurement cards appear. The Connections page and direct API checks showed myUplink connected, 499 points available, and 948 saved history samples.

Inspection identified a frontend sequencing issue in `public/app.js`: after fetching live points, the code awaited the local 720-hour history request before calling `render()`. This unnecessarily made the live cards depend on the history request completing. Updated the flow to render the live NIBE points immediately, then load history separately and rerender when history arrives. A history request failure no longer prevents the live cards from appearing.

Commit: `245a799492f9e4e612f9592512c7aac87c5dcdfc` on `overwatch-foundation`.

Local browser verification and `npm.cmd test` are pending. Next: fetch/fast-forward the branch, run the test suite, then refresh the Heat pump page and confirm that the real NIBE cards appear without switching pages. No provider, database, credentials or server collection behavior was changed.


## NIBE browser startup diagnostics — 2026-11-26

The first attempt to decouple live NIBE card rendering from history loading did not resolve the user's full-page-refresh symptom. Direct local API checks had already shown myUplink connected, one system, 499 points and 948 saved history samples, while the browser still displayed only WAITING FOR NIBE.

Updated `public/app.js` to expose the current NIBE startup stage directly on the Heat pump page (checking status, loading systems, loading measurement points), show the actual fetch/error message if initialization fails, and prevent overlapping myUplink refresh requests. This is diagnostic instrumentation to identify which browser request or stage is failing; it does not change collection, database contents, credentials or provider permissions.

Commit: `da071614928fa0490c5f40b5fa221229511db114` on `overwatch-foundation`.

Local browser verification and test-suite rerun are pending. Next: fast-forward the user's local branch, hard-refresh the Heat pump page, and report the exact status text displayed. Do not infer the cause until the browser shows which stage is reached.


## Correct NIBE compressor-frequency parameter — 2026-11-26

A fresh read-only myUplink point catalogue confirmed parameter ID `41778` (`Aktuell kompressor­frekvens`) as the current compressor frequency in Hz. Parameter `43122` is `Min kompressor­frekvens` and is a minimum-frequency setting/reading with an older timestamp, not the live compressor frequency. Updated both the browser mapping and NIBE history collector to use `41778`. Existing SQLite history is preserved; historical `43122` rows are not deleted and will no longer be selected as compressor activity. Updated the persistence test to include both points and verify that only `41778` is stored. Local test execution and live verification remain pending.


## Energy-flow and data-quality continuation — 2026-11-26

- The shared `data-quality.mjs` contract and provider adapters for Tibber, myUplink/NIBE and Nord Pool are already present; `GET /api/status` aggregates them without exposing credentials or triggering provider refreshes.
- `energy-flow.mjs` is a pure, tested calculation using normalized W readings and explicit sign conventions. It refuses missing, stale, invalid or misaligned inputs and does not infer provider semantics.
- Local Windows test run reported by the user: 58 tests passed, 0 failed.
- Live site-load calculation remains intentionally unavailable until Huawei PV and Emaldo battery power are accessible and their units/signs are verified. Tibber Pulse alone is not enough to separate PV and battery contribution.
- NIBE compressor frequency is verified on parameter 41778 and should not be changed while developing energy-flow functionality.

Next: continue with provider-neutral energy-flow readiness and data-quality diagnostics, without wiring unverified Huawei/Emaldo data into calculations or changing working NIBE/Tibber collection.


## Dashboard interface branch — 2026-11-26

- Created `feature/dashboard-energy-overview` from `overwatch-foundation` at commit `578d5135a06f0c0b0ad50628ede7b0f945a0225a`.
- Dashboard work is isolated on the feature branch; no integration/backend files are intended to change.
- First UI slice: Swedish overview labels; a clearly incomplete energy-balance panel; Tibber L1/L2/L3 current and voltage display; and a compact source-quality summary using read-only `GET /api/status`.
- Tibber `power` must not be labelled as verified total household consumption. Phase current/voltage must not be used to estimate total power.
- Existing NIBE history UI, Nord Pool price graph/negative-price warning and camera panels remain in place.
- No backend adapters, calculations, SQLite storage, credentials or camera controls are changed in this dashboard slice.
- Verification required: run `npm.cmd test` locally, check dashboard in Edge at desktop/mobile widths, confirm NIBE, Tibber, price and camera sections render, then inspect the Git diff before committing or opening a PR.


### UI polish follow-up — 2026-11-26

- Swedish labels were extended to the main page chrome and remaining views.
- Explicit Demo selection continues to show synthetic energy tiles and history, clearly marked as demo data. Outside Demo, missing live provider data remains unavailable rather than falling back to synthetic values.
- Live overview shows Tibber phase current and voltage individually without inferring total power.
- Local tests and Edge/browser checks remain pending on the Windows checkout.
