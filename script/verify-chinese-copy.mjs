import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const HOST = process.env.COPY_VERIFY_HOST || "http://localhost:13000";
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(HOST, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".lang-switcher__toggle", { timeout: 15000 });
  await page.waitForTimeout(300);

  const localeState = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    translate: document.documentElement.getAttribute("translate"),
    google: document.querySelector('meta[name="google"]')?.getAttribute("content") || "",
    text: document.body.innerText,
  }));

  assert.equal(localeState.lang, "zh", "Chinese browsers should use the curated Chinese locale");
  assert.equal(localeState.translate, "no", "the app should opt out of browser machine translation");
  assert.equal(localeState.google, "notranslate", "Google Translate should leave app copy unchanged");

  for (const expected of ["阵型", "主客场", "主场", "客场", "AI 难度", "简单", "普通", "困难", "比赛时长"]) {
    assert.ok(localeState.text.includes(expected), `missing curated Chinese copy: ${expected}`);
  }
  for (const mistranslation of ["形成", "简单的", "普通的", "难的", "换腿部"]) {
    assert.ok(!localeState.text.includes(mistranslation), `browser mistranslation leaked into UI: ${mistranslation}`);
  }

  await page.goto(`${HOST}/match?red=argentina&blue=portugal&ai=1&side=home&time=6`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForSelector('[data-tip="换队伍"]', { timeout: 20000 });
  assert.equal(await page.locator('[data-tip="换队伍"]').first().getAttribute("data-tip"), "换队伍");

  console.log("[verify-chinese-copy] PASS: curated Chinese copy is active and protected from browser translation");
} finally {
  await browser.close();
}
