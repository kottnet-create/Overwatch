# PRMGR Observatory Starter

A free, local-first foundation for a dashboard that helps you understand your home. Inspired by the PRMGR Home Observatory build: muted green panels, warm highlights, an illustrated home, and readings with context.

[Download the starter](https://github.com/prmgr-org/prmgr-observatory-starter/releases/latest) · [Connection guide](docs/CONNECTIONS.md)

**Version 1.0.0 · No account, subscription, external scripts, analytics, npm dependencies, or build step.**

## Start here — no coding needed for the demo

1. Download and unzip the starter package.
2. Open the `public` folder.
3. Double-click **`index.html`**. It opens in your browser.
4. Try **Home overview**, **Heat pump**, **Explore readings**, and **Make it yours**.

Every initial reading is **synthetic demo data**, not measurements from Peter’s home or yours. The illustration is a generic original SVG. Nothing connects to Homey or your equipment automatically.

If your browser restricts local files, use the optional local server below. Chrome and Edge are good starting points. The packaged demo has also been tested in Chrome; other browsers have not been formally verified.

## What is included?

- Home overview: solar generation, site consumption, grid import/export, battery charge.
- A house/garage split, only when the supplied sample supports it.
- Hot-water temperature and compressor-frequency history.
- Measurement explorer, latest-sample table, explicit missing data.
- JSON import/export with validation; imports remain in the current tab’s memory.
- A read-only HomeyScript export example you configure for your own devices.
- An optional local Node server and recorder for an adapter-produced JSON file.
- Editable labels and generic house artwork; source code under MIT.

This is a starter, not the complete personal system shown in the video. It does **not** include automatic device discovery, a Homey login flow, ready-made NIBE/GoodWe/Shelly integrations, electricity billing, device controls, camera feeds, an Android TV APK, or TV Home-button replacement. It is usable in a browser on a large display; installing a native TV app is separate work.

## Try importing a dataset

Click **Import readings**, then choose `examples/readings.json`. This is another **synthetic** example, saved with its own timestamps. Switch to **Explore readings** to see the sample table. Click **Export JSON** to keep a copy.

Reloading the page returns to demo. Your imports are not sent to a server or saved to browser storage. If you serve the app on a public website, imported readings still stay in the browser; the optional recorder endpoint belongs on a local server.

See [the data format](docs/DATA-FORMAT.md) to make a file with your own readings.

## Optional local server

Install [Node.js LTS](https://nodejs.org/en/download) (Node 22.5 or later; the app uses Node's built-in SQLite support). Open a terminal **inside the extracted starter folder**, the one containing `package.json`:

```sh
node server.mjs
```

Or use `npm start`. You do **not** need `npm install`.

Open **http://127.0.0.1:8780**. This address works only on the computer running the server. It is not a public download link, and another device such as a TV cannot reach it. Stop with Ctrl+C.

Mac users can also run `start.command`; Windows users can run `start-windows.cmd` after installing Node. If macOS blocks the script, run `node server.mjs` in Terminal instead of disabling operating-system protections.

## Keep a history — optional learning workflow

Use three terminal windows, all inside the starter folder:

```sh
# Window 1: generate SYNTHETIC input every 30 seconds
node tools/simulate.mjs
```

```sh
# Window 2: save new readings to data/history.json
node collector.mjs --input examples/current-reading.json
```

```sh
# Window 3: show the dashboard
node server.mjs
```

Click **Load local recorder** on the dashboard. Click again to refresh; it loads a snapshot, not a continuous stream. The badge identifies synthetic recorder data. Stop each process with Ctrl+C.

The recorder runs independently of the page. Closing the page does not stop it; closing the recorder terminal does. It keeps at most 5,000 samples and preserves their original timestamps. It does not manufacture a new measurement time when an input file hasn’t changed. When recording every 30 seconds, 5,000 samples cover about 42 hours; export/archive history for longer retention.

To move from synthetic data to your own adapter:

1. Stop the synthetic generator and recorder.
2. Archive or rename `data/history.json` so demo and real readings stay separate.
3. Have your adapter write a JSON file in the documented format. Use an atomic rename so the recorder never reads a partly written file.
4. Start `node collector.mjs --input /path/to/your/readings.json`.
5. Open the dashboard and load the local recorder.

The recorder only reads that local file. Building the connection between your equipment and that file is a separate step. See [connections and Homey](docs/CONNECTIONS.md).


### NIBE history (local SQLite)

When the local server is started with the myUplink credentials configured, it collects read-only NIBE device points immediately and then every five minutes. Measurements are stored in `data/overwatch.sqlite`; the database is local and excluded from Git. The recorder keeps 30 days of samples and prunes older rows automatically. It stores the polling timestamp as well as the source timestamp, so unchanged readings still appear in the time series without losing when myUplink last updated the point.

The database location can be changed with `OVERWATCH_DB_PATH` in `.env`, for example `OVERWATCH_DB_PATH=D:/OverwatchData/overwatch.sqlite`. Use a persistent local disk path for now. When moving to a NAS later, stop the server first and move the database together with its SQLite WAL/SHM files (or use SQLite's backup/checkpoint procedure); then update the path. Do not place the live database on an unreliable network share.

The history API is local-only: `/api/myuplink/history?hours=24` (up to 720 hours) and `/api/myuplink/history/latest`.

## Make it look like your home

Edit `public/config.js` in a text editor. Change the title and building labels. Keep passwords and tokens out of this file.

Replace the illustration with your own SVG, PNG, JPG, or WebP in `public/assets`, then change `illustration` to its relative path. Use a simple filename such as `my-house.webp`. The local server serves image files only from that assets folder. Use artwork you own or have permission to distribute. The included SVG is generic and may be modified under MIT.

## An always-on machine / Synology

The collector can run on a computer that stays on. Its `data` folder must remain persistent across app updates. Keep your private adapter and credentials separate from anything served to browsers.

The included Dockerfile is an **optional recorder-only recipe**, not a one-click Synology installer. For an experienced Container Manager user:

```sh
docker build -t observatory-starter:1.0.0 .
docker run --rm --name observatory-recorder \
  --mount type=bind,src=/absolute/path/to/private-input,dst=/input,readonly \
  --mount type=bind,src=/absolute/path/to/persistent-data,dst=/app/data \
  observatory-starter:1.0.0
```

Supply `/input/readings.json`, and grant the container’s `node` user write access to the mounted data folder. Adapt host paths and permissions to your NAS. This container does not expose a web port. Container Manager configuration varies by model/version, and this recipe has not been run on a NAS as part of starter verification.

## Useful rules from the build

- Pick one question before adding more devices.
- Verify units against the device or another measurement you trust.
- Keep missing or stale readings unknown; never silently replace them with zero.
- Site consumption is not the same as grid import when solar or batteries are involved.
- A charger already measured by the site meter must not be added twice.
- A compressor’s frequency is not a verified electrical-power reading.
- Align source meter timestamps before calculating a building split.

## Troubleshooting

**No readings after importing:** The file may contain nulls for that metric. Try another measurement or inspect the latest-sample table.

**Recorder says “No newer samples”:** Update the input file with a genuinely new measurement timestamp. The recorder intentionally preserves the old time.

**Source changed:** Archive `data/history.json` before changing the source. This prevents mixing demo and real datasets.

**Port already in use:** Stop another starter instance, or use another port. macOS/Linux: `PORT=8781 node server.mjs`; Windows PowerShell: `$env:PORT=8781; node server.mjs`.

**A local-file import doesn’t work in your browser:** Use the optional local server and try again.

**Nothing updates while looking at the recorder:** Click **Load local recorder** again. Automatic polling is not included in v1.0.0.

## Development and reuse

Run `npm test` with Node 22+ to exercise data validation, history persistence, chart-gap handling, and server boundaries. No package installation is needed. Packaging: `npm run package`.

See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The code and generic illustration are MIT-licensed. The PRMGR name identifies the original project; use your own name for redistributed products rather than implying they are official PRMGR releases. This is a community starter with no support service or device-compatibility promise.


## Camera overview

Overwatch includes a configuration-driven camera overview and a dedicated Cameras page. Camera metadata is served by the local `/api/cameras` endpoint. RTSP URLs and credentials are not sent to browser code. The garage Tapo C520WS stream was verified in VLC and browser live playback in Overwatch is now confirmed through a local go2rtc/WebRTC bridge. The outdoor Tapo C460 is listed as integration pending. PTZ controls are not enabled until ONVIF support and required ports are verified. See [docs/OVERWATCH-PLAN.md](docs/OVERWATCH-PLAN.md).


## Browser camera streaming (go2rtc)

The garage Tapo C520WS can be bridged from RTSP to browser WebRTC with [go2rtc](https://github.com/AlexxIT/go2rtc). The app displays the local player URL only; RTSP credentials stay in local go2rtc configuration/environment. The bridge is disabled until `OVERWATCH_GO2RTC_ENABLED=true`.

1. Download the Windows go2rtc release from the official [go2rtc releases](https://github.com/AlexxIT/go2rtc/releases).
2. Place `go2rtc.exe` in a private local folder, not in the Git repository.
3. Create a local `go2rtc.yaml` from `go2rtc.example.yaml`. Set `TAPO_RTSP_USER` and `TAPO_RTSP_PASSWORD` in the environment used to start go2rtc. Keep the real config private.
4. Start go2rtc, then set `OVERWATCH_GO2RTC_ENABLED=true` in Overwatch's local `.env` and restart Overwatch.
5. Check go2rtc at `http://127.0.0.1:1984` and test stream `overwatch_garage`.

The existing UniFi rule allows RTSP TCP 554 from the PC to the camera. WebRTC also needs the browser to reach go2rtc on the same PC (default HTTP TCP 1984 and media TCP/UDP 8555). These are local PC ports, not additional camera VLAN openings. If playback fails, inspect go2rtc WebRTC candidates and Windows Firewall; do not broaden the IoT rule. The iframe uses go2rtc's documented `stream.html?src=...&mode=webrtc` viewer. End-to-end playback has been confirmed working by the user in Overwatch.
