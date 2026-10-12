import { expect, test } from "@playwright/test"

/**
 * Guards against dialogs that are taller than a short phone.
 *
 * The logo cropper capped itself at `94vh` while its content needed more, and
 * its panel had `overflow-hidden` with no scrollable ancestor above it. At
 * 320x568 that put Cancel at y=577 and "Use this crop" at y=529-569, both
 * outside the viewport -- the dialog could be neither confirmed nor dismissed.
 * It fits at 390x844, which is why the usual phone size never caught it.
 *
 * 320x568 is the point of the test: a phone narrower AND shorter than the 390x844
 * that most mobile checks use. A layout can be fine at 390 wide and still be
 * unusable here.
 */
const SHORT_PHONE = { width: 320, height: 568 }

// A 64x64 PNG. Deliberately not 1x1: the cropper needs a source large enough to
// produce a 64x64 output, and a 1x1 input makes it fall into its error path
// instead of rendering the controls this test needs to measure.
const LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWklEQVR42u3OMQEAAAgDoJnc6BpjDyRg" +
  "blXVvXsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAB4W5wAAWQ0k1AAAAAASUVORK5CYII=",
  "base64",
)

test.describe("short phone viewport", () => {
  test.use({ viewport: SHORT_PHONE })

  test("keeps the logo cropper's actions reachable", async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logo: null, settings: {} }) }))

    await page.goto("/", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1200)

    // A guest can pick a session logo, and that is what opens the cropper.
    await page.locator("#seller-logo-upload-guest").setInputFiles({ name: "probe-logo.png", mimeType: "image/png", buffer: LOGO_PNG })

    const confirm = page.getByRole("button", { name: /use this crop/i })
    const cancel = page.getByRole("button", { name: /^cancel$/i })
    await expect(confirm).toBeVisible({ timeout: 20_000 })

    // `toBeInViewport` is the assertion that matters: a control can exist, be
    // visible to the accessibility tree, and still sit below the fold of a
    // dialog that cannot scroll.
    await expect(confirm, "the cropper's confirm action is below the fold on a short phone").toBeInViewport()
    await expect(cancel, "the cropper's cancel action is below the fold on a short phone").toBeInViewport()

    // And it must actually be operable, not merely painted.
    await cancel.click()
    await expect(confirm).toHaveCount(0)
  })
})
