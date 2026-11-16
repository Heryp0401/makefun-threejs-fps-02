# smoke-test.py — headless Playwright (Firefox) smoke test for FOUNDRY.
# Loads each staged shot, waits for the sim to run, reports the live game
# state and console errors, and writes the screenshots into screenshots/.
# Run:  node serve.ts  (in another shell)  then  python3 smoke-test.py
import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

SHOTS = [
    ("1-start.jpg", "?shot=start&seed=1"),
    ("2-play.jpg", "?shot=play&seed=1"),
    ("3-end.jpg", "?shot=end&seed=1"),
]
BASE = "http://localhost:8080/game/index.html"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots")

STATE_JS = """() => {
    const g = window.__game;
    if (!g) return {ok: false};
    const s = g.sim;
    return {
        ok: true,
        phase: s.match.phase,
        round: s.match.round,
        score: [s.match.score.CT, s.match.score.T],
        playerAlive: s.player.alive,
        playerHealth: Math.round(s.player.health),
        botsAlive: s.bots.filter(b => b.alive).length,
        botsTotal: s.bots.length,
        bomb: s.bomb.state,
        events: s.events.length,
    };
}"""

WEBGL_JS = """() => {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
}"""


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as pw:
        # Chromium (Playwright build) with SwiftShader software WebGL:
        # headless Firefox on this VM has no GL driver at all.
        browser = await pw.chromium.launch(
            headless=True,
            args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        )
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        webgl = None
        for name, query in SHOTS:
            await page.goto(BASE + query, wait_until="load")
            await page.wait_for_timeout(3000)
            if webgl is None:
                webgl = await page.evaluate(WEBGL_JS)
            state = await page.evaluate(STATE_JS)
            print(name, json.dumps(state))
            await page.screenshot(path=os.path.join(OUT, name), type="jpeg", quality=82)
            size = os.path.getsize(os.path.join(OUT, name))
            print(f"  -> {size} bytes (limit 262144)")
        print("WEBGL2:", webgl)
        print("CONSOLE ERRORS:", json.dumps(errors) if errors else "none")
        await browser.close()


asyncio.run(main())
