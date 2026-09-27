"use client"

const TAKA_SIGN = "৳"

/**
 * Renders a formatted amount with every taka sign optically aligned.
 *
 * Geist covers Latin only, so the taka sign falls back to a Bengali font that
 * draws it on a narrower advance than Geist's tabular figures. The sign then
 * collided with the first digit, which at large sizes read as a strikethrough
 * through the number. Each occurrence is wrapped in a real element so the `.taka`
 * rule can correct it, which a `::first-letter` rule could not do: it applies only
 * to the first letter of a *block* container, so on the inline `<output>` and
 * `<span>` amounts used by the invoice editor it silently did nothing.
 *
 * This lives in its own module because money is formatted in the editor, the
 * preview, the history table and the settlement cell. The editor was the last
 * holdout still calling `formatMoney` directly, which is why the glyph was only
 * broken there and looked fine everywhere else.
 */
export function MoneyText({ className, text }: { className?: string; text: string }) {
  return <span className={className ? `money ${className}` : "money"}>
    {text.split(TAKA_SIGN).map((part, index) => (
      <span key={index}>
        {index > 0 ? <span className="taka">{TAKA_SIGN}</span> : null}
        {part}
      </span>
    ))}
  </span>
}