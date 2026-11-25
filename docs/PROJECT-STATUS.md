# Overwatch — project status and chat handoff

Last updated: 2026-11-25

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
- Compressor history chart remains empty until the matching compressor-frequency point is identified.
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
