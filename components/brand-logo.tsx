import Image from "next/image"

type BrandLogoProps = {
  size?: "header" | "auth"
  className?: string
}

export function BrandLogo({ size = "header", className = "" }: BrandLogoProps) {
  const authLogo = size === "auth"

  return (
    <div className={`relative shrink-0 overflow-hidden ${authLogo ? "h-[100px] w-[250px]" : "h-14 w-[175px] sm:w-[190px]"} ${className}`}>
      <Image
        src="/quickinvoice-bd-logo.png"
        alt="QuickInvoice-BD"
        width={authLogo ? 210 : 125}
        height={authLogo ? 210 : 125}
        priority
        className="absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
      />
    </div>
  )
}
