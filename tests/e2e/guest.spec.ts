import { existsSync } from "node:fs"
import { chromium, expect, test, type Page } from "@playwright/test"

const chromiumInstalled = existsSync(chromium.executablePath())

// At or above this width the invoice form and preview render side by side.
// Below it the form collapses into a stepped flow with a fixed bottom action bar.
const SIDE_BY_SIDE_MIN_WIDTH = 1280

type InvoiceStep = "Details" | "From" | "Bill to" | "Items" | "Notes" | "Preview"

function usesSteppedFlow(page: Page) {
  const viewport = page.viewportSize()
  return Boolean(viewport && viewport.width < SIDE_BY_SIDE_MIN_WIDTH)
}

async function openStep(page: Page, step: InvoiceStep) {
  if (!usesSteppedFlow(page)) return

  const stepper = page.getByRole("navigation", { name: "Invoice steps" })
  const stepButton = stepper.getByRole("button", { name: step, exact: false })
  if ((await stepButton.getAttribute("aria-current")) !== "step") await stepButton.click()
  await expect(stepButton).toHaveAttribute("aria-current", "step")
}

function previewPanel(page: Page) {
  return page.getByRole("region", { name: "Invoice preview" })
}

test.describe("guest invoice generator", () => {
  test.skip(!chromiumInstalled, "Skipped: install the Playwright Chromium browser with `npx playwright install chromium`.")

  test("renders the guest homepage and export affordances", async ({ page }) => {
    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await page.goto("/")

    await expect(page.getByRole("heading", { level: 1, name: "Create a polished invoice in minutes." })).toBeVisible()
    await expect(page.getByText("Guest mode · nothing is saved yet")).toBeVisible()
    if (usesSteppedFlow(page)) {
      await expect(page.getByRole("navigation", { name: "Invoice steps" })).toBeVisible()
    }

    await openStep(page, "From")
    await expect(page.getByRole("button", { name: "Sign in to use saved profile" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Load saved profile" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Save as profile" })).toHaveCount(0)
    await expect(page.getByText("Sign in to upload and reuse a company logo.")).toBeVisible()

    await openStep(page, "Bill to")
    await expect(page.getByRole("button", { name: "Sign in to use saved customers" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Load saved customers" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Save customer" })).toHaveCount(0)

    await openStep(page, "Items")
    await expect(page.getByRole("button", { name: "Sign in to reuse items" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Load saved items" })).toHaveCount(0)

    await openStep(page, "Notes")
    await expect(page.getByRole("button", { name: "Sign in to reuse notes" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Load saved notes" })).toHaveCount(0)

    await openStep(page, "Preview")
    await expect(previewPanel(page).getByRole("button", { name: "Download PDF" })).toBeVisible()
    await expect(previewPanel(page).getByRole("button", { name: "Download DOCX" })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test("does not expose saved-profile or logo controls to guests", async ({ page }) => {
    await page.goto("/")

    await openStep(page, "From")
    await expect(page.getByRole("button", { name: "Sign in to use saved profile" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Upload logo" })).toHaveCount(0)

    await openStep(page, "Bill to")
    await expect(page.getByRole("button", { name: "Sign in to use saved customers" })).toBeVisible()
  })

  test("does not persist guest invoice state after reload", async ({ page }) => {
    await page.goto("/")

    await openStep(page, "From")
    await page.locator("#seller-company-name").fill("Temporary Seller")
    await expect(page.locator("#seller-company-name")).toHaveValue("Temporary Seller")

    await openStep(page, "Bill to")
    await page.locator("#buyer-company-name").fill("Temporary Buyer")
    await expect(page.locator("#buyer-company-name")).toHaveValue("Temporary Buyer")

    await page.reload()

    await openStep(page, "From")
    await expect(page.locator("#seller-company-name")).toHaveValue("")
    await openStep(page, "Bill to")
    await expect(page.locator("#buyer-company-name")).toHaveValue("")
    await expect(page.getByText("Guest mode · nothing is saved yet")).toBeVisible()
  })

  test("toggles quantity presentation without changing the editor field", async ({ page }) => {
    await page.goto("/")

    await openStep(page, "Preview")
    const preview = page.locator(".invoice-paper")
    await expect(preview.getByText("Qty", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Customize" }).click()
    const quantityDisplay = page.getByRole("checkbox", { name: "Show quantity column" })
    await quantityDisplay.evaluate((element) => (element as HTMLInputElement).click())
    await expect(quantityDisplay).not.toBeChecked()

    await openStep(page, "Items")
    await expect(page.getByRole("spinbutton", { name: "Quantity" }).first()).toBeVisible()

    await openStep(page, "Preview")
    await expect(preview.getByText("Qty", { exact: true })).toHaveCount(0)
  })

  test("adds focused item cards and recovers from an empty list", async ({ page }) => {
    await page.goto("/")
    await openStep(page, "Items")

    const addItemButton = page.locator('button:visible').filter({ hasText: /^Add item$/ }).first()
    if (await addItemButton.count()) await addItemButton.click()
    else await page.getByRole("button", { name: "Add another item", exact: true }).click()
    const secondDescription = page.locator("#description-2")
    await expect(secondDescription).toBeFocused()
    await secondDescription.fill("Design")
    await page.locator("#description-1").fill("Consulting")

    await page.getByRole("button", { name: "Remove item 1" }).click()
    await page.getByRole("button", { name: "Remove item 1" }).click()
    await expect(page.getByText("Your ledger is ready", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Add your first item" }).click()
    await expect(page.locator("#description-3")).toBeFocused()
    await expect(page.locator("#description-3").locator("xpath=ancestor::ol[1]/li")).toHaveCount(1)
  })

  test("shows per-item discounts without an original column in the preview", async ({ page }) => {
    await page.goto("/")
    const preview = page.locator(".invoice-paper")

    await openStep(page, "Items")
    await page.locator('input[aria-label="Item 1 description"]:visible, input[id^="description-"]:visible').first().fill("Consulting")
    await page.locator('input[aria-label="Unit price"]:visible, input[id^="price-"]:visible').first().fill("1000")
    await page.getByRole("button", { name: "Add discount item 1" }).click()
    await page.locator("#discount-type-1:visible").selectOption("fixed")
    await page.locator('input[aria-label="Discount value item 1"]:visible').fill("100")

    await openStep(page, "Preview")
    await expect(preview.getByText("Original", { exact: true })).toHaveCount(0)
    await expect(preview.getByText("Discount", { exact: true })).toBeVisible()
    await expect(preview.getByText("Amount", { exact: true })).toBeVisible()
    await expect(preview.getByText("৳1,000", { exact: true })).toHaveCount(2)
    await expect(preview.getByText("− ৳100", { exact: true })).toHaveCount(2)
    await expect(preview.getByText("৳900", { exact: true })).toHaveCount(2)
    await expect(preview.getByText("Total discount", { exact: true })).toBeVisible()
    await expect(page.locator("#discount-reason")).toHaveCount(0)
  })

  test("requires authentication for reusable libraries", async ({ page }) => {
    const itemsResponse = await page.request.get("/api/items")
    const notesResponse = await page.request.get("/api/note-templates")
    expect(itemsResponse.status()).toBe(401)
    expect(notesResponse.status()).toBe(401)
  })

  test("returns a safe health response", async ({ page }) => {
    const response = await page.request.get("/api/health")
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ status: "ok" })
    expect(response.headers()["x-request-id"]).toBeTruthy()
  })

  test("downloads PDF and DOCX exports for a completed guest invoice", async ({ page }) => {
    test.setTimeout(120_000)
    page.on("pageerror", (error) => console.log(`[browser pageerror] ${error.message}`))
    page.on("console", (message) => { if (message.type() === "error") console.log(`[browser console] ${message.text()}`) })
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await openStep(page, "From")
    await page.locator("#seller-company-name").fill("Seller Co")
    await page.locator("#seller-name").fill("Seller")

    await openStep(page, "Bill to")
    await page.locator("#buyer-company-name").fill("Buyer Co")
    await page.locator("#buyer-name").fill("Buyer")
    await page.locator("#buyer-phone").fill("01800000000")

    await openStep(page, "Items")
    const descriptionInput = page.locator('input[aria-label="Item 1 description"]:visible, input[id^="description-"]:visible').first()
    const unitPriceInput = page.locator('input[aria-label="Unit price"]:visible, input[id^="price-"]:visible').first()
    await descriptionInput.fill("Consulting")
    await unitPriceInput.fill("1250")

    await openStep(page, "Preview")
    await expect(page.locator("#seller-company-name")).toHaveValue("Seller Co")
    await expect(page.locator("#seller-name")).toHaveValue("Seller")
    await expect(page.locator("#buyer-company-name")).toHaveValue("Buyer Co")
    await expect(page.locator("#buyer-name")).toHaveValue("Buyer")
    await expect(page.locator("#buyer-phone")).toHaveValue("01800000000")
    // One shared card editor serves every viewport, so these state assertions
    // are independent of the active desktop/mobile step.
    await expect(page.locator("#description-1")).toHaveValue("Consulting")
    await expect(page.locator("#price-1")).toHaveValue("1250")

    const pdfButton = previewPanel(page).getByRole("button", { name: "Download PDF" })
    const docxButton = previewPanel(page).getByRole("button", { name: "Download DOCX" })

    await expect(pdfButton).toBeEnabled()
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      pdfButton.click(),
    ])
    expect(pdfDownload.suggestedFilename()).toBe("invoice-draft.pdf")

    await expect(docxButton).toBeEnabled()
    const [docxDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      docxButton.click(),
    ])
    expect(docxDownload.suggestedFilename()).toBe("invoice-draft.docx")
  })
})
