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
4. [Repository README](../README.md) — actual application features and local run instructions.

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
