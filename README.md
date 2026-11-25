# SignRelay GameShow

**Spin. Sign. Score.** A standalone webcam game for the SignRelay university exhibition on 26 November 2026. Solo players and groups share one laptop and webcam. Every player takes five 20-second turns for up to 50 points. Names, turns, and scores live in the current tab and clear on reload. Camera frames stay in memory. The threshold defaults to Relaxed 0.60.

## Run the prepared offline release

Extract the release ZIP. Install Node.js 22 or newer beforehand, then open a terminal in the extracted folder.

```sh
node scripts/serve.mjs 8787
```

Open the local kiosk in desktop Chrome. The ZIP contains all runtime assets. See the booth guide for camera setup, offline checks, and host controls. [Local kiosk](http://127.0.0.1:8787/) · [Booth operations](docs/BOOTH.md)

## Build from source

Clone the [dedicated GameShow repository](https://github.com/adamjamiesimson/Signrelay-gameshow) and use its default `main` branch. Requires Node.js 22+, pnpm 11.25.0 and Chrome or Chromium for browser tests. The four pinned recognition assets, teaching clips and logo are checked in. Installing the locked JavaScript packages requires registry access once. The asset check and build then run from local files.

```sh
pnpm install --frozen-lockfile
pnpm assets
pnpm build
pnpm test
pnpm test:browser
node scripts/fullscreen-test.mjs
node scripts/camera-lifecycle-test.mjs
pnpm start
```

Set the environment variable **GAMESHOW_CHROME** to the full browser executable path when Chrome is installed elsewhere. Run **pnpm test:browser** after building. Test artifacts are written to **test-output/**. The app needs a secure context for camera and service workers. Use HTTPS for a remote host and the exact loopback address for the booth.

Tracking uses the browser GPU when a hardware WebGL renderer can warm up both MediaPipe models. It falls back to CPU after a tracking failure. The host diagnostics identify the active delegate. Sign classification stays on the ONNX WASM worker.

- [Recognition architecture, sign selection and evaluation](docs/RECOGNITION.md)
- [Earlier exhibition benchmarks and publication checks](docs/READINESS.md)
- [Release and offline verification](docs/VERIFICATION.md)
- [Booth operations and physical checks](docs/BOOTH.md)
- [Asset credits and licences](docs/ASSETS.md)
- [Firebase release](docs/DEPLOY.md)

