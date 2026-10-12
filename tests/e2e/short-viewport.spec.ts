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
  // The editor is a client component and the cropper does canvas work, so under
  // parallel load this needs more room than the default.
  test.describe.configure({ timeout: 90_000 })

  test("keeps the logo cropper's actions reachable", async ({ page }) => {
    // Runs once, in the desktop project. The viewport is set explicitly above, so
    // running it per project triples the work for identical results -- and this
    // spec drives the cropper, which is canvas-heavy enough that three parallel
    // copies pushed the whole suite into timeouts.
    test.skip(test.info().project.name !== "desktop", "covered by the desktop project; the viewport is set explicitly")

    await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logo: null, settings: {} }) }))

    await page.goto("/", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1200)

    // Wait for hydration before driving the UI. The editor renders on the server
    // first, and a click that arrives before React attaches its handlers does
    // nothing -- which is exactly how this failed under parallel load while
    // passing in isolation. The session check flipping means the first effects
    // have run, so the stepper is live.
    await page
      .waitForFunction(() => !/checking session/i.test(document.body.innerText), null, { timeout: 30_000 })
      .catch(() => undefined)

    // Below 1280px the editor is a stepped flow and the logo field lives in the
    // "From" step, so it is not rendered until that step is opened. Skipping this
    // made the test pass in the desktop project (where every step renders) and
    // fail in the mobile ones.
    const viewport = page.viewportSize()
    if (viewport && viewport.width < 1280) {
      const stepper = page.getByRole("navigation", { name: "Invoice steps" })
      const fromStep = stepper.getByRole("button", { name: "From", exact: false })
      if ((await fromStep.getAttribute("aria-current")) !== "step") await fromStep.click()
      await expect(fromStep).toHaveAttribute("aria-current", "step")
    }

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
