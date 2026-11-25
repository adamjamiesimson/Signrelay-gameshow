# Firebase Hosting release

The independent deployment uses Firebase project **signrelay-gameshow**, site **signrelay-gameshow**, and target **gameshow**. The deployment script accepts only those IDs and requires a matching `.firebaserc` target. `firebase.json` serves **dist** directly, with no SPA rewrite, and explicitly sets the MIME type for ONNX and MediaPipe model files. The original SignRelay is a separate application.

Open **Windows PowerShell** inside the dedicated GameShow checkout, where `firebase.json` and `package.json` are located. The release was prepared with Node.js 24 and Firebase CLI 15.37.0.

```powershell
pnpm.cmd dlx firebase-tools@15.37.0 login:list
# Run login if the list is empty.
pnpm.cmd dlx firebase-tools@15.37.0 login
pnpm.cmd dlx firebase-tools@15.37.0 hosting:sites:get signrelay-gameshow --project signrelay-gameshow
# Apply the local mapping only if missing.
pnpm.cmd dlx firebase-tools@15.37.0 target:apply hosting gameshow signrelay-gameshow --project signrelay-gameshow
pnpm.cmd install --frozen-lockfile
pnpm.cmd assets
pnpm.cmd build
pnpm.cmd test
pnpm.cmd test:browser
pnpm.cmd --package=firebase-tools@15.37.0 dlx -c 'node scripts/deploy.mjs signrelay-gameshow signrelay-gameshow'
```

To recheck a release without deploying, run `node scripts/deploy.mjs signrelay-gameshow signrelay-gameshow --verify-only` against the corresponding local build. It polls the hosted manifest with a cache-busting query, requests the uncompressed CDN variant, checks status and content type before parsing, and verifies the hashes of the page, worker, all models, and all ten videos. A persistent HTML response should be investigated in the active release and redirect or rewrite settings.

For tabs already open on the older fixed-score release, finish the game and reload once. The worker verifies the full new cache before activation and leaves the current page open. This release checks for later updates on **New Game** and refreshes when registration is empty. Verify the build ID under **Host controls → Readiness and diagnostics**. [GameShow site](https://signrelay-gameshow.web.app/) · [Firebase Hosting configuration](https://firebase.google.com/docs/hosting/full-config)
