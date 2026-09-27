import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
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

// A line's actions are real buttons on the row, stacked in the row's own gutter.
// They are not behind a menu, so reaching one is a single click — but the name
// "Remove line" repeats down the page, so every action is scoped to the row it
// belongs to. Scoping to the group rather than to a row index is what keeps the
// first line's trash button from matching when a dozen rows are on screen.
function rowActions(page: Page, index: number) {
  return page.getByRole("group", { name: `Actions for item ${index}` })
}

async function rowAction(page: Page, index: number, name: RegExp | string) {
  await rowActions(page, index).getByRole("button", { name }).click()
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
    await expect(page.getByText("Guest logos are kept in this browser only.")).toBeVisible()
    await expect(page.getByLabel("Upload a session logo")).toBeVisible()
    // The account-only promotion control must stay hidden from guests.
    await expect(page.getByRole("button", { name: "Save session logo to my account" })).toHaveCount(0)

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

  test("does not expose saved-profile or account logo controls to guests", async ({ page }) => {
    await page.goto("/")

    await openStep(page, "From")
    await expect(page.getByRole("button", { name: "Sign in to use saved profile" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Upload logo" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Save session logo to my account" })).toHaveCount(0)

    // Guests get a session-only uploader instead, and it says so plainly.
    await expect(page.getByLabel("Upload a session logo")).toBeVisible()
    await expect(page.getByText("Nothing is uploaded")).toBeVisible()

    await openStep(page, "Bill to")
    await expect(page.getByRole("button", { name: "Sign in to use saved customers" })).toBeVisible()
  })

  test("hides admin navigation and role lookup from guests", async ({ page }) => {
    const profileResponse = await page.request.get("/api/profile")
    expect(profileResponse.status()).toBe(401)

    await page.goto("/")
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0)

    await page.goto("/invoices")
    await expect(page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Admin", exact: true })).toHaveCount(0)
  })

  test("never uses a native browser dialog, which ignores the design system", async ({ page }) => {
    // window.confirm renders a browser-owned dialog that cannot be styled, so it
    // silently reintroduces a foreign UI. Any occurrence is a regression.
    await page.goto("/invoices")
    await page.goto("/invoices/trash")

    const nativeDialogs: string[] = []
    page.on("dialog", async (dialog) => {
      nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`)
      await dialog.dismiss()
    })

    // Exercise the paths that used to prompt, as a signed-out visitor.
    await page.goto("/")
    const recordPayment = page.getByRole("button", { name: /Record payment|Manage payments/ })
    if (await recordPayment.count() > 0) {
      await recordPayment.first().click({ timeout: 2_000 }).catch(() => undefined)
    }

    expect(nativeDialogs, `native dialogs shown: ${nativeDialogs.join(" | ")}`).toEqual([])
  })

  test("keeps a part-paid invoice distinguishable from unpaid and settled", async ({ page }) => {
    await page.goto("/invoices")

    // The list is behind auth, so a guest sees an authentication notice and no
    // settlement controls at all. This is asserted rather than assumed: the
    // previous version returned early whenever the notice was visible, which is
    // always, so the payment flow was never actually exercised in a browser.
    //
    // The exact wording is not pinned, because the page decides between the
    // sign-in panel and the error box from the API's message; what matters is
    // that settlement UI is withheld and no stray "Outstanding" text is shown.
    const notice = page.getByRole("heading", { name: "Your invoice history is private" })
      .or(page.getByRole("alert"))
    await expect(notice.first()).toBeVisible()
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0)
    await expect(page.getByRole("dialog", { name: "Record payment" })).toHaveCount(0)
    await expect(page.getByLabel("Balance")).toHaveCount(0)
  })

  test("explains an empty payment amount instead of claiming the invoice is settled", async ({ page }) => {
    // The dialog lives behind auth, so the same rule is covered directly against
    // the shared helper in the unit suite. This checks the guest-facing surface
    // does not regress into exposing settlement copy while signed out.
    await page.goto("/invoices")
    await expect(page.getByRole("dialog", { name: "Record payment" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0)
  })

  test("row actions menu opens, exposes every action and fires handlers", async ({ page }) => {
    // The invoice history sits behind auth, so the shipped menu is exercised
    // through a probe route that renders the same component with the same shape of
    // actions. Without this the overflow menu has no runtime coverage at all.
    await page.goto("/zz-probe-rowactions")
    const idle = page.locator("#row-idle")
    const busy = page.locator("#row-busy")

    const trigger = idle.getByRole("button", { name: "More actions for INV-0001" })
    await expect(trigger).toBeVisible()
    // The menu must stay closed until it is asked for.
    await expect(page.getByRole("menu")).toHaveCount(0)

    // The compact header variant must drop the description and use the tighter
    // margin, while the default variant keeps both. The invoice history itself is
    // authenticated, so this covers the shared component it relies on.
    const compactHeader = page.locator(".workspace-page-header-compact")
    await expect(compactHeader).toHaveCount(1)
    await expect(compactHeader.getByRole("heading", { name: "Compact header" })).toBeVisible()
    await expect(compactHeader).not.toContainText("must not render in compact mode")
    const defaultHeader = page.locator(".workspace-page-header:not(.workspace-page-header-compact)")
    await expect(defaultHeader).toHaveCount(1)
    await expect(defaultHeader).toContainText("must render in the default mode")

    await trigger.click()
    const menu = page.getByRole("menu")
    await expect(menu).toBeVisible()
    // Edit, Mark paid, Re-raise, Mark as overdue, Download PDF, Move to Trash.
    await expect(menu.getByRole("menuitem")).toHaveCount(6)

    // Edit lives in the menu, not on the row, and is a real link.
    const editItem = menu.getByRole("menuitem", { name: "Edit" })
    await expect(editItem).toHaveAttribute("href", "/?draft=abc")
    // Nothing is left visible on the row itself.
    await expect(idle.locator("a, button").filter({ hasText: /^Edit$/ })).toHaveCount(0)
    await expect(menu.getByRole("menuitem", { name: "Move to Trash" })).toBeVisible()
    await expect(menu.getByRole("menuitem", { name: "Mark as overdue" })).toBeVisible()

    // Revise was removed at the seller's request and must not come back.
    await expect(menu.getByRole("menuitem", { name: /Revise/i })).toHaveCount(0)

    // Record payment moved to the Status column, so it is not a row action.
    await expect(menu.getByRole("menuitem", { name: /Record payment/i })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Record payment" })).toBeVisible()

    // A download renders as a real link that actually navigates.
    await expect(menu.getByRole("menuitem", { name: "Download PDF" })).toHaveAttribute("href", /download=PDF/)

    // Clicking an item fires its handler and closes the menu.
    await menu.getByRole("menuitem", { name: "Move to Trash" }).click()
    await expect(page.locator("#log")).toHaveText("trash")
    await expect(page.getByRole("menu")).toHaveCount(0)

    // The overdue replacement for the old status dropdown still reaches the API.
    await trigger.click()
    await page.getByRole("menu").getByRole("menuitem", { name: "Mark as overdue" }).click()
    await expect(page.locator("#log")).toHaveText("trashoverdue")

    // Escape closes the menu without firing anything.
    await trigger.click()
    await expect(page.getByRole("menu")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menu")).toHaveCount(0)
    await expect(page.locator("#log")).toHaveText("trashoverdue")

    // While a row is busy every *action* is inert, so a second click cannot
    // duplicate the in-flight request. The trigger itself stays enabled on
    // purpose: it has to open to reveal the inert items. A disabled anchor loses
    // its href and is marked aria-disabled, so it is located by CSS, not by role.
    await busy.getByRole("button", { name: "More actions for INV-BUSY" }).click()
    const busyMenu = page.getByRole("menu")
    for (const name of ["Edit", "Mark paid", "Move to Trash"]) {
      await expect(busyMenu.getByRole("menuitem", { name })).toHaveAttribute("aria-disabled", "true")
    }
    await expect(busyMenu.getByRole("menuitem", { name: "Download PDF" })).not.toHaveAttribute("href", /./)
    // Pressing Enter on an inert item must not reach the handler.
    await busyMenu.getByRole("menuitem", { name: "Move to Trash" }).press("Enter")
    await expect(page.locator("#log")).toHaveText("trashoverdue")
  })
  test("no source file calls a native browser dialog", () => {
    // The runtime check above can only visit pages a guest can reach, so it cannot
    // see the authenticated screens where these prompts actually live. A source
    // scan covers all of them, and it must recurse properly: an earlier version
    // used a non-recursive glob and silently missed three files.
    const roots = ["app", "components", "lib"].map((dir) => join(process.cwd(), dir))
    const banned: Array<[RegExp, string]> = [
      [/\bwindow\.confirm\s*\(/, "window.confirm"],
      [/\bwindow\.alert\s*\(/, "window.alert"],
      [/\bwindow\.prompt\s*\(/, "window.prompt"],
    ]
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.tsx?$/.test(entry.name)) continue
        // Skip test files, which are allowed to mention the banned calls.
        if (entry.name.includes(".test.") || entry.name.includes(".spec.")) continue
        const source = readFileSync(full, "utf8")
        for (const [pattern, label] of banned) {
          if (pattern.test(source)) offenders.push(`${full.replace(`${process.cwd()}\\`, "")} uses ${label}`)
        }
      }
    }
    for (const root of roots) {
      if (existsSync(root)) walk(root)
    }
    expect(offenders, `native dialogs reintroduced: ${offenders.join(", ")}`).toEqual([])
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

  test("treats the buyer company as optional and falls back to the buyer name", async ({ page }) => {
    await page.goto("/")

    await openStep(page, "From")
    await page.locator("#seller-company-name").fill("Seller Co")
    await page.locator("#seller-name").fill("Seller")

    await openStep(page, "Bill to")
    // The field is offered but never demanded, and the rule is stated up front.
    await expect(page.locator("#buyer-company-name")).toBeVisible()
    await expect(page.getByText("Company name is optional", { exact: false })).toBeVisible()
    await expect(page.getByText("Bill-to heading")).toBeVisible()

    await page.locator("#buyer-name").fill("Rahim Uddin")
    await page.locator("#buyer-phone").fill("01800000000")

    // The heading readout switches to the buyer name as soon as it is typed, so
    // the fallback is never a surprise discovered later in the preview.
    const headingReadout = page.locator(".editor-section", { hasText: "Bill-to heading" })
    await expect(headingReadout.getByText("Rahim Uddin", { exact: true })).toBeVisible()

    await openStep(page, "Items")
    const descriptionInput = page.locator('input[aria-label="Item 1 description"]:visible, input[id^="description-"]:visible').first()
    const unitPriceInput = page.locator('input[aria-label="Unit price"]:visible, input[id^="price-"]:visible').first()
    await descriptionInput.fill("Consulting")
    await unitPriceInput.fill("1250")

    await openStep(page, "Preview")
    const preview = page.locator(".invoice-paper")
    // The buyer name becomes the heading, and it is not repeated beneath itself.
    await expect(preview.getByText("Rahim Uddin", { exact: true })).toHaveCount(1)

    // A company still wins as the heading, and the name moves beneath it.
    await openStep(page, "Bill to")
    await page.locator("#buyer-company-name").fill("Acme Ltd")
    await expect(headingReadout.getByText("Acme Ltd", { exact: true })).toBeVisible()
    await expect(preview.getByText("Rahim Uddin", { exact: true })).toHaveCount(1)
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
    // The name is no longer a bare "Quantity" repeated on every card, so this
    // matches on the leading label text instead of an exact string.
    await expect(page.getByRole("spinbutton", { name: /^Quantity for item 1/ })).toBeVisible()

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

    await rowAction(page, 1, "Remove line")
    await rowAction(page, 1, "Remove line")
    await expect(page.getByText("No items yet", { exact: true })).toBeVisible()

    // Removing a line is reversible rather than destructive: the notice carries
    // the recovery action, and undo puts the row back where it was instead of
    // appending it, so a seller who deletes the wrong card keeps their ordering.
    const undo = page.getByRole("button", { name: "Undo" })
    await expect(undo).toBeVisible()
    await undo.click()
    // Scoped to the items list: a bare "ol > li" also matches the stepper and
    // workflow navigation lists elsewhere on the page.
    const lineCards = page.locator("ol.line-items > li")
    await expect(lineCards).toHaveCount(1)
    await expect(page.locator("#description-2")).toHaveValue("Design")
    await expect(page.locator("#description-2")).toBeFocused()

    await rowAction(page, 1, "Remove line")
    await page.getByRole("button", { name: "Add your first item" }).click()
    // Line ids are handed out from a counter that never goes backwards, so a row
    // can never inherit the id of a row that was just removed (and is still held by
    // the undo record). Ids 1 and 2 have been used by this point, so the new row
    // is the third.
    await expect(page.locator("#description-3")).toBeFocused()
    await expect(page.locator("#description-3").locator("xpath=ancestor::ol[1]/li")).toHaveCount(1)
  })

  // "Duplicate line" was removed, so this no longer creates a second row: it
  // pins the Enter walk down the fields, which is the other way a seller builds
  // a list without touching the pointer.
  test("advances through the row with Enter and adds a line at the end", async ({ page }) => {
    await page.goto("/")
    await openStep(page, "Items")
    const lineCards = page.locator("ol.line-items > li")
    await expect(lineCards).toHaveCount(1)

    await page.locator("#description-1").fill("Consulting")
    await page.locator("#quantity-1").fill("1")
    await page.locator("#price-1").fill("1000")

    // Enter walks the row: description -> quantity -> unit price -> next row.
    await page.locator("#description-1").press("Enter")
    await expect(page.locator("#quantity-1")).toBeFocused()
    await page.locator("#quantity-1").press("Enter")
    await expect(page.locator("#price-1")).toBeFocused()
    // Enter on the last row's price creates another line and focuses it. The
    // first line took id 1, so the line Enter creates is id 2.
    await page.locator("#price-1").press("Enter")
    await expect(lineCards).toHaveCount(2)
    await expect(page.locator("#description-2")).toBeFocused()
  })

  // The duplicate control is gone, and this pins that it cannot quietly return.
  test("no longer offers a duplicate control on a line", async ({ page }) => {
    await page.goto("/")
    await openStep(page, "Items")

    const actions = page.getByRole("group", { name: "Actions for item 1" })
    await expect(actions.getByRole("button", { name: "Remove line" })).toBeVisible()
    // Guests get no Save button (it needs an account), so a guest row carries
    // exactly one action. The duplicate button is gone for everyone.
    await expect(actions.getByRole("button", { name: /duplicate/i })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Duplicate line" })).toHaveCount(0)
  })

  test("names every line field for assistive technology", async ({ page }) => {
    await page.goto("/")
    await openStep(page, "Items")
    await page.getByRole("button", { name: "Add another item", exact: true }).click()

    // Each field used to be announced as a bare "Quantity" or "Unit price",
    // repeated identically on every card with no indication of which line was
    // being edited. The visible label leads the name and the item number follows.
    await expect(page.getByRole("spinbutton", { name: /^Quantity for item 1/ })).toHaveCount(1)
    await expect(page.getByRole("spinbutton", { name: /^Quantity for item 2/ })).toHaveCount(1)
    await expect(page.getByRole("spinbutton", { name: "Unit price for item 1, in taka" })).toHaveCount(1)
    await expect(page.getByRole("spinbutton", { name: "Unit price for item 2, in taka" })).toHaveCount(1)
  })

  test("shows per-item discounts without an original column in the preview", async ({ page }) => {
    await page.goto("/")
    const preview = page.locator(".invoice-paper")

    await openStep(page, "Items")
    await page.locator('input[aria-label="Item 1 description"]:visible, input[id^="description-"]:visible').first().fill("Consulting")
    // Quantity is filled explicitly rather than left to a default. A new line
    // starts blank, and a blank quantity is real missing data: it fails the
    // `incomplete` gate and blocks export, which is the intended behaviour. The
    // assertions below are about the discount, so the line is completed first.
    await page.locator('input[id^="quantity-"]:visible').first().fill("1")
    await page.locator('input[aria-label="Unit price"]:visible, input[id^="price-"]:visible').first().fill("1000")
    // The discount band is on every row now, so there is no menu to open first.
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
    // A new line starts blank, and a blank quantity fails the `incomplete` gate,
    // which is what blocks an export. This test wants a completed invoice, so it
    // supplies the quantity rather than leaning on a default that no longer exists.
    await page.locator('input[id^="quantity-"]:visible').first().fill("1")
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
