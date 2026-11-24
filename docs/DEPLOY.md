# Firebase release

The GameShow build uses Hosting target **gameshow** and its own local **.firebaserc** mapping. The deploy script rejects both the original SignRelay project ID and its site ID. Use a separate Firebase project for GameShow. The kiosk at **127.0.0.1:8787** works independently of this release.

Open Windows PowerShell in the dedicated GameShow source folder, where **firebase.json** and **package.json** are located. Use Node.js 22 or newer and pnpm 11.25.0. Sign in with the Google account that will own the separate project. If the suggested project ID is reserved, choose a different independent project ID. If Firebase reports that **signrelay-gameshow** is reserved, use **signrelay-gameshow-uae** as the site ID.

```powershell
npx.cmd --yes firebase-tools@latest login
npx.cmd --yes firebase-tools@latest projects:list
$project = 'signrelay-gameshow-2026'
$site = 'signrelay-gameshow'
# Run once if you do not already have an independent Firebase project.
npx.cmd --yes firebase-tools@latest projects:create $project --display-name 'SignRelay GameShow'
npx.cmd --yes firebase-tools@latest hosting:sites:list --project $project
# Omit site creation if the chosen site is already listed for this project.
npx.cmd --yes firebase-tools@latest hosting:sites:create $site --project $project
npx.cmd --yes firebase-tools@latest target:apply hosting gameshow $site --project $project
pnpm.cmd install --frozen-lockfile
pnpm.cmd assets
pnpm.cmd build
pnpm.cmd test
pnpm.cmd test:browser
npm.cmd exec --yes --package=firebase-tools@latest -- node scripts/deploy.mjs $project $site
```

If the site already exists and belongs to the authorized project, omit the create command. Inspect the **gameshow** mapping in **.firebaserc** before publishing. The script checks the destination against that exact project and site, checks the complete production build, deploys only **hosting:gameshow**, and compares the served release manifest to the local one.

After deployment, use a fresh regular Chrome profile to open the new URL. Wait for **Offline Ready**, permit the camera, and test a complete game. Disconnect networking and reload. Verify that lesson playback, model loading, registration and camera still work. If operating the show locally and using the hosted site for visibility, expect separate browser storage at each address.

At the readiness check, Firebase CLI reported no signed-in account and the preferred site returned HTTP 404. A site’s availability is established by the authenticated create or list command. [Firebase CLI](https://firebase.google.com/docs/cli) · [Hosting deploy targets](https://firebase.google.com/docs/hosting/multisites)

