import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const HOST = process.env.PAD_VERIFY_HOST || "http://localhost:13000";
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
  const captured = [];
  await phonePage.exposeFunction("__capturePadFrame", (message) => captured.push(message));
  await phonePage.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    function CapturedWebSocket(...args) {
      const socket = new NativeWebSocket(...args);
      const send = socket.send.bind(socket);
      socket.send = (data) => {
        try {
          window.__capturePadFrame(typeof data === "string" ? JSON.parse(data) : null);
        } catch {}
        return send(data);
      };
      return socket;
    }
    CapturedWebSocket.prototype = NativeWebSocket.prototype;
    window.WebSocket = CapturedWebSocket;
  });

  await phonePage.goto(`${HOST}/pad?room=${roomCode}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await phonePage.waitForSelector(".pad-stick", { timeout: 15000 });
  await hostPage.locator(".lb-btn--go").click();
  await phonePage.waitForFunction(() => document.querySelector(".pad-state")?.textContent?.includes("LIVE"), {
    timeout: 10000,
  });

  const stickBox = await phonePage.locator(".pad-stick").boundingBox();
  assert.ok(stickBox, "joystick must be visible");
  const centerX = stickBox.x + stickBox.width / 2;
  const centerY = stickBox.y + stickBox.height / 2;
  const dragDistance = stickBox.width * 0.4;
  const client = await phoneContext.newCDPSession(phonePage);

  async function readDirection(name, cssX, cssY, expectedX, expectedY, pointerId) {
    const startIndex = captured.length;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: centerX, y: centerY, id: pointerId }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: centerX + cssX * dragDistance, y: centerY + cssY * dragDistance, id: pointerId }],
    });
    await phonePage.waitForTimeout(160);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await phonePage.waitForTimeout(80);

    const frame = captured.slice(startIndex)
      .filter((message) => message?.t === "input")
      .map((message) => message.d)
      .filter((input) => Math.hypot(input.vx || 0, input.vy || 0) > 0.3)
      .at(-1);

    assert.ok(frame, `${name}: expected a moving input frame`);
    assert.ok((frame.vx || 0) * expectedX + (frame.vy || 0) * expectedY > 0.7,
      `${name}: expected (${expectedX}, ${expectedY}), received (${frame.vx.toFixed(2)}, ${frame.vy.toFixed(2)})`);
  }

  await readDirection("physical right", 0, 1, 1, 0, 1);
  await readDirection("physical left", 0, -1, -1, 0, 2);
  await readDirection("physical down", -1, 0, 0, 1, 3);
  await readDirection("physical up", 1, 0, 0, -1, 4);

  console.log("[verify-pad-direction] PASS: all four physical directions map correctly");
} finally {
  await browser.close();
}
