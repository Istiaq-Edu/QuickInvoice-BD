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
await page.getByRole("button", { name: "Add another item", exact: true }).click();
const secondDesc = page.locator('input[aria-label="Item 2 description"]');
await secondDesc.fill("Website design — homepage");
await page.locator("#price-2").fill("5000");
await page.getByRole("button", { name: "Add discount item 2" }).click();
await page.locator("#discount-type-2").selectOption("percentage");
await page.locator('input[aria-label="Discount value item 2"]').fill("10");
await page.waitForTimeout(300);
await items.scrollIntoViewIfNeeded();
await items.screenshot({ path: "shots/items-filled-desktop.png" });
for (const [label, viewport] of [
  ["desktop-1280", { width: 1280, height: 800 }],
  ["laptop-1024", { width: 1024, height: 768 }],
]) {
  const responsivePage = await browser.newPage({ viewport });
  await responsivePage.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45000 });
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
await m.locator("#price-1").fill("5000");
await m.getByRole("button", { name: "Add discount item 1" }).click();
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
