import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const HOST = process.env.PAD_VERIFY_HOST || "http://localhost:13000";
const OUT_DIR = path.resolve("verify-out");
mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const hostPage = await hostContext.newPage();
  await hostPage.goto(`${HOST}/lobby?red=argentina&blue=portugal&side=home&ai=0&time=6`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  const roomCode = await hostPage.waitForFunction(() => {
    const element = document.querySelector(".lb-code b");
    const text = (element?.textContent || "").trim();
    return /^[A-Z0-9]{4}$/.test(text) ? text : null;
  }, { timeout: 20000 }).then((handle) => handle.jsonValue());

  const phoneContext = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/138.0.0.0 Mobile Safari/537.36",
  });
  const phonePage = await phoneContext.newPage();
  await phonePage.goto(`${HOST}/pad?room=${roomCode}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await phonePage.waitForSelector(".pad-pad", { timeout: 15000 });
  await hostPage.locator(".lb-btn--go").click();
  await phonePage.waitForFunction(() => document.querySelector(".pad-state")?.textContent?.includes("LIVE"), {
    timeout: 10000,
  });

  const layout = await phonePage.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect && { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const buttons = Object.fromEntries(["lob", "pass", "tackle", "shoot", "sprint"].map((key) => [key, box(`.pad-btn--${key}`)]));
    const center = buttons.sprint;
    const gaps = [
      buttons.lob.bottom < center.top ? center.top - buttons.lob.bottom : buttons.lob.top - center.bottom,
      buttons.shoot.top > center.bottom ? buttons.shoot.top - center.bottom : center.top - buttons.shoot.bottom,
      buttons.pass.right < center.left ? center.left - buttons.pass.right : buttons.pass.left - center.right,
      buttons.tackle.left > center.right ? buttons.tackle.left - center.right : center.left - buttons.tackle.right,
    ];
    return { stick: box(".pad-stick"), pad: box(".pad-pad"), buttons, minOuter: Math.min(...[buttons.lob, buttons.pass, buttons.tackle, buttons.shoot].map((button) => button.width)), minGap: Math.min(...gaps) };
  });

  await phonePage.screenshot({ path: path.join(OUT_DIR, "pad-touch-targets.png") });
  assert.ok(layout.pad.width >= 218, `action group should be wider, received ${layout.pad.width.toFixed(1)}px`);
  assert.ok(layout.minOuter >= 68, `outer buttons should be at least 68px, received ${layout.minOuter.toFixed(1)}px`);
  assert.ok(layout.minGap >= 7, `center sprint button needs at least 7px clearance, received ${layout.minGap.toFixed(1)}px`);
  assert.ok(layout.stick.width >= 155, `joystick should be at least 155px, received ${layout.stick.width.toFixed(1)}px`);
  assert.ok(layout.stick.left >= 38 && layout.stick.top >= 72, `joystick should move toward the centre, received left=${layout.stick.left.toFixed(1)}px top=${layout.stick.top.toFixed(1)}px`);
  console.log(`[verify-pad-touch-targets] PASS: stick=${layout.stick.width.toFixed(1)}px pad=${layout.pad.width.toFixed(1)}px outer=${layout.minOuter.toFixed(1)}px gap=${layout.minGap.toFixed(1)}px`);
} finally {
  await browser.close();
}
