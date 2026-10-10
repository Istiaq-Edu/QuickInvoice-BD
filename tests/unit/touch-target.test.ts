import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Guards the touch hit area.
 *
 * WCAG 2.2 SC 2.5.5 (AAA) asks for 44x44. Every control in the line-item row is
 * deliberately smaller than that: the row actions are 32x32 and the discount
 * controls are 32px tall, because 44px of paint would crowd the row and, at the
 * 320px floor the app supports, push the ledger grid off screen. The hit area is
 * therefore grown with a transparent pseudo-element instead of with paint, and
 * that only holds together while three things stay true:
 *
 *   1. `.touch-hit` sets the 44px floor on both axes.
 *   2. The control itself is `position: relative`, or the pseudo-element anchors
 *      to the wrong containing block and the hit area lands somewhere unrelated.
 *   3. The rule stays inside `@media (pointer: coarse)`, or a mouse-driven
 *      desktop grows overlapping dead zones between adjacent buttons.
 *
 * Each assertion below maps to one of those. They read the source rather than a
 * rendered page because the failure mode is a stylesheet edit, and a unit test
 * that needs a browser to notice it will not run on every commit.
 */

const root = join(__dirname, "..", "..")
const cssRaw = readFileSync(join(root, "app", "globals.css"), "utf8")
/**
 * Comments are stripped before any parsing.
 *
 * The prose around `.touch-hit` names the query it is supposed to live in, and a
 * parser that reads comments happily collects the sentence about
 * `(pointer: coarse)` as though it were the media condition — which makes a rule
 * rewritten to `(min-width: 0px)` still look coarse-pointer-scoped. The mutation
 * this guards against is exactly a query rewrite, so comments must go first.
 */
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "")
const page = readFileSync(join(root, "app", "page.tsx"), "utf8")

/** The text of the coarse-pointer media block, brace-matched.
 *
 * Matched by regex rather than by the literal string, because a guard that only
 * recognises one exact spelling stops working the moment the query is rewritten
 * — `(pointer: coarse), (hover: none)` is the same intent, and `(min-width: 0px)`
 * is not. The mutation this has to survive is swapping the query out for one
 * that matches every device, so the test asserts on the *condition*, and the
 * assertion below rejects any block whose condition is not coarse-pointer.
 */
function coarseBlock(source: string): { condition: string; body: string } | null {
  const match = /@media\s*([^{]*?)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = match.exec(source))) {
    const condition = m[1].trim()
    if (!/\bpointer\s*:\s*coarse\b/.test(condition)) continue
    const open = match.lastIndex - 1
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++
      else if (source[i] === "}") {
        depth--
        if (depth === 0) return { condition, body: source.slice(open + 1, i) }
      }
    }
  }
  return null
}

/** True when a `.touch-hit` rule with the 44px floor is reachable outside a
 * coarse-pointer media query.
 *
 * Enumerates every `@media` block with its condition and reports the scope of
 * each block that carries a `.touch-hit` sizing rule. Stripping media blocks
 * with a regex and then looking for leftovers is not enough: a block whose query
 * was rewritten to `(min-width: 0px)` is still a media block, so the strip
 * removes the evidence along with the block. The condition has to be read, not
 * merely the rule's presence.
 */
function touchHitScopes(source: string): string[] {
  const scopes: string[] = []
  const opener = /@media\s*([^{]*?)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = opener.exec(source))) {
    const condition = m[1].trim()
    const open = opener.lastIndex - 1
    // Walk to the matching close brace.
    let depth = 0
    let end = source.length
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++
      else if (source[i] === "}") {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    const body = source.slice(open + 1, end)
    if (/\.touch-hit[^{]*\{[\s\S]*?44px/.test(body)) scopes.push(condition)
    opener.lastIndex = end
  }
  // Rules outside any media query at all.
  const stripped = source.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
  if (/\.touch-hit[^{]*\{[\s\S]*?44px/.test(stripped)) scopes.push("<unconditional>")
  return scopes
}

describe("touch hit area", () => {
  it("defines a .touch-hit utility", () => {
    expect(css).toContain(".touch-hit")
  })

  it("keeps the enlarged hit area inside a coarse-pointer media query", () => {
    const block = coarseBlock(css)
    expect(block).not.toBeNull()
    // The condition must actually be coarse-pointer, not merely "a media query".
    expect(block!.condition).toMatch(/\bpointer\s*:\s*coarse\b/)
    // The pseudo-element that enlarges the target must only exist for touch.
    expect(block!.body).toContain("::after")
    expect(block!.body).toContain("44px")
  })

  it("does not set the 44px floor outside the coarse-pointer query", () => {
    // This is the mutation an earlier version of this test missed: rewriting the
    // query to something that matches every device leaves the rule textually
    // intact, so the condition itself has to be inspected.
    const scopes = touchHitScopes(css)
    expect(scopes.length).toBeGreaterThan(0)
    for (const scope of scopes) {
      expect(scope).toMatch(/\bpointer\s*:\s*coarse\b/)
    }
  })

  it("anchors the pseudo-element with an explicitly positioned control", () => {
    const block = coarseBlock(css)!.body
    // Without `position: relative` on the control, the ::after resolves against
    // the nearest positioned ancestor instead of the button.
    expect(block).toMatch(/\.touch-hit\s*\{[^}]*position:\s*relative/)
    expect(block).toMatch(/\.touch-hit::after\s*\{[^}]*position:\s*absolute/)
  })

  it("grows the target to at least 44px on both axes", () => {
    const block = coarseBlock(css)!.body
    // Pinning the number, not just its presence: a shrink to 40px would keep the
    // rule's shape and quietly drop below the SC 2.5.5 floor.
    expect(block).toMatch(/width:\s*max\(\s*100%\s*,\s*44px\s*\)/)
    expect(block).toMatch(/height:\s*max\(\s*100%\s*,\s*44px\s*\)/)
    expect(block).toMatch(/width:\s*max\(\s*100%\s*,\s*44px\s*\)/)
  })

  it("applies .touch-hit to the small row controls in page.tsx", () => {
    // The shared row-action token, the discount field token, and the stepper chip.
    const occurrences = (page.match(/touch-hit/g) ?? []).length
    expect(occurrences).toBeGreaterThanOrEqual(3)
    expect(page).toMatch(/rowActionButton\s*=\s*"touch-hit/)
    expect(page).toMatch(/const compactField\s*=\s*"touch-hit/)
  })
})
