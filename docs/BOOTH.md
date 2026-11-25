# GameShow booth guide

## Start the offline kiosk

1. Install Node.js 22 or newer and Chrome on the booth laptop. Extract the full kiosk ZIP to a local folder. Open **Windows PowerShell** in that folder and run `node scripts/serve.mjs 8787`. Leave PowerShell open.
2. Open the kiosk address in desktop Chrome. If another kiosk is using port 8787, stop its server before starting the new one. Close all previous GameShow tabs. [Offline kiosk](http://127.0.0.1:8787/)
3. Press **Alt+H** or select the gear. Under **Readiness and diagnostics**, check **Model Ready**, **Offline Ready**, and **Threshold 0.60**. Wait for the build ID shown in the release handoff. Press **Esc** to return to registration. Use the header fullscreen control or **F11** for the booth display.
4. Disconnect Wi-Fi and Ethernet once during rehearsal. Reload the kiosk and check a lesson, the webcam, and one complete challenge. Reconnect if you need the hosted site. The offline ZIP needs no dependencies or internet after extraction.

## Start each group

1. Enter names or nicknames. Leave unused fields blank. Use **Add player field** for larger groups and **Start Game** when ready.
2. The current player takes the camera position, spins, watches the demonstration, and selects **Ready**. The 20-second clock starts after the webcam and workers are ready. Select **Next Player** after the result to hand off the laptop. The next person chooses when to start their challenge.
3. After everyone has played five turns, select **See final results**. The podium stays visible until **New Game**. Use **New Game** for the next group. Refreshing or closing the tab clears names, scores and progress.

## Host recovery

- Open the gear or press **Alt+H**. **Pause** stops the timer and camera. **Resume** continues the current turn. **Restart turn** returns to its demonstration with 20 seconds. **Skip challenge** lets the same player spin again.
- Use **Confirm correct** only after seeing a genuinely correct target sign. **Correct a score** lets you update an earlier result for any player. **Restart game** keeps the roster and clears its scores. **Export current scores** saves a CSV only when requested.
- If the camera disconnects, reconnect it and check the camera selector. Try **Retry camera and models**. If necessary, enable **Host judging only** and judge each sign during its timed challenge. Keep **Relaxed 0.60** for automatic recognition unless the host has a specific reason to adjust it.

## Live rehearsal

Use the booth laptop, webcam, screen and lighting. Have two people play all ten turns, then swap host duties. Try slower and left-handed performances, idle hands, and a wrong sign. Note automatic recognition, host awards, timeouts and any false awards separately. Open diagnostics during a turn and note frame rate and overlay age. Disconnect and reconnect the webcam once. Test a manual award, score correction, and the offline reload before opening. Leave the kiosk running with periodic rounds for a longer soak if setup time permits.
