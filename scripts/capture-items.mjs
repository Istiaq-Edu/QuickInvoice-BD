import { chromium } from "@playwright/test";

const BASE = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:3000";

const capturePanel = async (page, panel, path) => {
  await panel.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top, behavior: "instant" });
  });
  await page.waitForTimeout(100);
  const box = await panel.boundingBox();
  if (!box) throw new Error(`Could not measure panel for ${path}`);
  await page.screenshot({ path, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
};

const hideDevTools = async (page) => {
  await page.locator("nextjs-portal").evaluateAll((portals) => portals.forEach((portal) => portal.remove()));
};

const hideCaptureChrome = async (page) => {
  await page.locator("header.glass-header, nav[aria-label='Invoice steps']").evaluateAll((elements) => {
    elements.forEach((element) => {
      if (element instanceof HTMLElement) element.style.visibility = "hidden";
    });
  });
  await page.locator(".fixed.inset-x-0.bottom-0.z-40").evaluate((element) => {
    if (element instanceof HTMLElement) element.remove();
  });
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(500);
await hideDevTools(page);
// Scroll the items panel into view and screenshot just it.
const items = page.locator("fieldset .surface", { hasText: "What are you charging for?" });
await items.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await items.screenshot({ path: "shots/items-desktop.png" });
// Add a second item with a discount to see multi-card flow.
// Addressed by id rather than aria-label: the description field's accessible name
// now comes from its wrapping <label>, so the old aria-label selector finds
// nothing and this script silently captured the empty state.
await page.getByRole("button", { name: "Add another item", exact: true }).click();
const secondDesc = page.locator('input[id^="description-"]').nth(1);
await secondDesc.fill("Website design — homepage");
// Quantity too: a new line starts blank, so without it the captured amounts are
// all zero and the shot stops showing what a filled line actually looks like.
await page.locator('input[id^="quantity-"]').nth(1).fill("1");
await page.locator('input[id^="price-"]').nth(1).fill("5000");
// A line's discount is on the row itself now, so it is a select and a value
// rather than two clicks through the row's menu.
await page.locator('select[id^="discount-type-"]').nth(1).selectOption("percentage");
await page.locator('input[aria-label^="Discount value item"]').nth(1).fill("10");
await page.waitForTimeout(300);
await items.scrollIntoViewIfNeeded();
await items.screenshot({ path: "shots/items-filled-desktop.png" });
for (const [label, viewport] of [
  ["desktop-1280", { width: 1280, height: 800 }],
  ["laptop-1024", { width: 1024, height: 768 }],
]) {
  const responsivePage = await browser.newPage({ viewport });
  await responsivePage.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45000 });
  // Below 1280px the editor collapses into a stepped flow, so the Items panel is
  // display:none until its step is selected. Without this the panel never became
  // visible and the capture timed out waiting for it to be stable.
  if (viewport.width < 1280) {
    await responsivePage.getByRole("navigation", { name: "Invoice steps" }).getByRole("button", { name: "Items" }).click();
    await responsivePage.waitForTimeout(300);
  }
  const responsiveItems = responsivePage.locator("fieldset .surface", { hasText: "What are you charging for?" });
  await responsiveItems.scrollIntoViewIfNeeded();
  await responsivePage.waitForTimeout(200);
  await hideDevTools(responsivePage);
  await responsiveItems.screenshot({ path: `shots/items-${label}.png` });
  await responsivePage.close();
}

await page.close();

// Mobile: jump straight to Items step, clip to the Items panel so card
// widths are measured at the real 390px column width.
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45000 });
await m.waitForTimeout(400);
await hideDevTools(m);
const stepper = m.getByRole("navigation", { name: "Invoice steps" });
await stepper.getByRole("button", { name: "Items" }).click();
await m.waitForTimeout(300);
await hideCaptureChrome(m);
const mItems = m.locator("fieldset .surface", { hasText: "What are you charging for?" });
await mItems.scrollIntoViewIfNeeded();
await m.waitForTimeout(200);
await capturePanel(m, mItems, "shots/items-mobile.png");
await m.locator("#description-1").fill("Website design — homepage");
await m.locator("#quantity-1").fill("1");
await m.locator("#price-1").fill("5000");
// Same as desktop: the type first, then the value. The value field is disabled
// while the type is "No discount", so filling before selecting would throw.
await m.locator('select[id^="discount-type-"]').first().selectOption("percentage");
await m.locator('input[aria-label="Discount value item 1"]').fill("10");
await m.waitForTimeout(250);
await capturePanel(m, mItems, "shots/items-filled-mobile.png");
const narrow = await browser.newPage({ viewport: { width: 320, height: 844 } });
await narrow.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45000 });
await narrow.waitForTimeout(400);
await hideDevTools(narrow);
await narrow.getByRole("navigation", { name: "Invoice steps" }).getByRole("button", { name: "Items" }).click();
await narrow.waitForTimeout(300);
await hideCaptureChrome(narrow);
const narrowItems = narrow.locator("fieldset .surface", { hasText: "What are you charging for?" });
await narrowItems.scrollIntoViewIfNeeded();
await narrow.waitForTimeout(200);
await capturePanel(narrow, narrowItems, "shots/items-mobile-320.png");
await narrow.close();

await browser.close();
console.log("items shots done");
