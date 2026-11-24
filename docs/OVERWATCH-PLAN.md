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
| Tapo C520WS | Garage | User verified local RTSP access in VLC at 192.168.20.137:554 and confirmed live browser playback in Overwatch through go2rtc/WebRTC. UniFi allows TCP 554 from 192.168.1.218 to the camera. ONVIF PTZ pan/tilt and saving/recalling presets have been verified in Agent DVR when the Windows PC is connected to the IoT network. Cross-VLAN ONVIF required additional UniFi policy work; TCP 2020 alone was insufficient for the full session. Digital zoom works in the Tapo app but ONVIF/Agent DVR zoom control has not been verified. Overwatch server-side ONVIF adapter and UI controls have been added on `overwatch-foundation`; dependency installation, local credentials, and end-to-end runtime verification from the Overwatch host remain. |
| Tapo C460 | Outdoor | Battery/solar camera on direct Wi-Fi. No standard RTSP/ONVIF; investigate TP-Link proprietary Direct stream via pytapo/Tapo: Cameras Control. User reports no Camera Account or Third-Party Compatibility option in app. Live stream should be on-demand and released when viewer closes. Motion-event push is unverified and may be unavailable because battery models often do not expose ONVIF events. |

The `/api/cameras` endpoint exposes metadata only. Stream URLs and credentials must remain server-side in local environment configuration and must never be returned to browser code. Add future cameras to `cameras.mjs`. Browser live video is now confirmed working for the garage camera. PTZ pan/tilt and preset save/recall have been verified externally in Agent DVR on the IoT network. Overwatch server-side ONVIF adapter and UI controls are committed; installation/configuration and runtime verification are still pending. Zoom is not a priority.


### C520WS browser playback bridge

The selected bridge is go2rtc. It consumes the existing RTSP source and exposes a WebRTC browser player locally. Overwatch displays the player only when `OVERWATCH_GO2RTC_ENABLED=true`; the public camera API never returns the RTSP source or credentials. Sample configuration: `go2rtc.example.yaml`. Keep the real config and environment credentials local and untracked.

The existing UniFi exception is only RTSP TCP 554 from 192.168.1.218 to 192.168.20.137. go2rtc WebRTC also requires the browser to reach the local PC service (default HTTP TCP 1984 and media TCP/UDP 8555); these are local-host ports. Check Windows Firewall and go2rtc candidates if WebRTC fails. Do not add another IoT VLAN exception without testing. End-to-end browser playback in Overwatch has been confirmed by the user. PTZ/ONVIF remains a separate later step.

## Future always-on host and TV dashboard

The current Windows PC is the development and interim runtime environment; it is normally powered off and should not be treated as the permanent always-on host. After the currently planned Overwatch features are implemented and validated, evaluate moving the service to a dedicated low-power always-on host.

- Initial target to evaluate: Raspberry Pi 4 or Raspberry Pi 5. Choose the final model/RAM and storage only after checking the actual workload, especially simultaneous camera streaming, data collection and database writes.
- The user's available Raspberry Pi 1 Model B+ (512 MB, ARMv6) is not a suitable host for the current Node.js 22.5+ application and should not be used for production.
- Keep the application portable: configuration and credentials outside the repository, persistent application data separated from code, documented startup/service setup, and a tested backup/restore procedure.
- Keep the active SQLite database on reliable local storage on the host. Use the ReadyNAS as temporary network file storage and backup target, not as the live SQLite database location.
- The ReadyNAS NV+ v2 is an interim device only. Restrict its network access, expose no NAS services directly to the internet, and give Overwatch a dedicated non-admin SMB account with access only to required shares. Treat its ageing disks as untrusted until extended SMART tests and RAID health checks complete; maintain a separate backup.
- Reassess the best always-on platform before purchase. A newer Raspberry Pi, small x86 mini-PC, or another suitable platform may be preferable depending on the final camera and integration workload. No hardware purchase is committed yet.
- Future display goal: use a Fire TV Stick or other thin client to open a TV-optimized Overwatch dashboard from the always-on host. This is deferred until the existing core features are complete. The TV client should only display the dashboard; server-side integrations and credentials remain on the host.
- Remote access should be provided through the UniFi VPN (for example WireGuard/Teleport) with narrowly scoped network access, not by exposing the NAS or the local Overwatch server directly to the public internet.



### Tapo C460 battery-camera integration (research and next steps)

The C460 is connected directly to Wi-Fi (no H200 hub). TP-Link's documentation says battery/solar models including C460 generally do not support RTSP/ONVIF because of their power-saving design. Do not try to reuse the C520WS RTSP/go2rtc or ONVIF path.

A community project, HomeAssistant-Tapo-Control, explicitly lists C460 as supported and provides proprietary TP-Link Direct streams for battery/solar cameras. Direct streams do not pass through go2rtc. The underlying Python library pytapo documents direct streaming and native WebRTC sessions, with FFmpeg required for media decoding. Candidate approach: a small isolated local Python sidecar using a pinned, reviewed pytapo version; Overwatch Node server controls it over loopback only and proxies the resulting media to the browser. Keep C520WS/go2rtc untouched.

Authentication must be verified for this exact C460 firmware. Community documentation indicates newer Tapo firmware may require the TP-Link cloud account credentials (not a Camera Account); never request credentials in chat and never commit them. Store secrets only in the private local .env or a protected local secret file. Ask whether TP-Link account two-step verification is enabled before choosing an auth flow; do not assume it is supported.

Expected behavior:
- No continuous polling or stream when nobody is viewing the camera.
- Start a direct stream only on explicit user request/opening the C460 view.
- Stop the stream and release the session when the view closes or after a short idle timeout.
- Do not wake the battery camera repeatedly for background thumbnails.
- Motion-triggered UI updates are a separate research item: community docs say motion entities generally require ONVIF events, which battery/solar models may not expose. Do not promise push alerts until verified. Potential fallback: show the last event/recording only if a safe, supported local API is established.

Network research indicates the community integration uses local camera TCP 443 for control and TCP 8800 for proprietary direct video; 2020 is only relevant if ONVIF events exist. Do not open WAN ports. Before adding any UniFi rules, discover the C460's DHCP IP and test reachability from the Overwatch host. Add only narrow host-to-camera rules after confirming the exact protocol.

No C460 code, credentials, or firewall rules have been added yet. First validate authentication and a single on-demand snapshot/direct stream on the user's Windows development PC, then integrate into Overwatch and test stream shutdown.
