type BrandLogoProps = {
  size?: "header" | "auth"
  className?: string
}

export function BrandLogo({ size = "header", className = "" }: BrandLogoProps) {
  const authLogo = size === "auth"

  return (
    <span
      aria-label="QuickInvoice BD"
      className={`inline-flex shrink-0 items-baseline font-sans tracking-[-0.035em] text-foreground ${authLogo ? "gap-2 text-3xl sm:text-4xl" : "gap-1.5 text-xl"} ${className}`}
    >
      <span className="font-heading font-semibold">QuickInvoice</span>
      <span className={authLogo ? "text-[0.42em] font-semibold tracking-[0.12em] text-primary" : "text-[0.52em] font-semibold tracking-[0.12em] text-primary"}>BD</span>
    </span>
  )
}
