import Link from "next/link"
import { ArrowLeft, Menu, Plus, Trash2 } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { SignOutButton } from "@/components/sign-out-button"
import { buttonVariants } from "@/components/ui/button"

type WorkspaceSection = "invoices" | "customers" | "profile" | "trash"

export function WorkspaceHeader({
  backHref,
  active,
  showTrash = true,
}: {
  backHref: string
  active?: WorkspaceSection
  showTrash?: boolean
}) {
  const links = [
    { href: "/invoices", label: "Invoices", section: "invoices" as const },
    { href: "/customers", label: "Customers", section: "customers" as const },
    { href: "/account/settings", label: "Seller profile", section: "profile" as const },
    ...(showTrash ? [{ href: "/invoices/trash", label: "Trash", section: "trash" as const, icon: <Trash2 data-icon="inline-start" /> }] : []),
  ]

  return <header className="glass-header sticky top-0 z-40">
    <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
      <Link className="group flex min-h-10 min-w-0 items-center gap-3 text-sm font-semibold" href={backHref}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/90 bg-card/70 text-muted-foreground shadow-sm transition group-hover:border-primary/35 group-hover:bg-card group-hover:text-primary"><ArrowLeft size={15} /></span>
        <BrandLogo />
      </Link>

      <nav className="hidden items-center gap-2 lg:flex" aria-label="Workspace navigation">
        <div className="flex items-center gap-0.5 rounded-xl border border-border/70 bg-muted/45 p-1">
          {links.map((link) => <Link
            aria-current={active === link.section ? "page" : undefined}
            className={`${buttonVariants({ variant: "ghost", size: "sm" })} aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-sm`}
            href={link.href}
            key={link.href}
          >{link.icon}{link.label}</Link>)}
        </div>
        <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" />
        <Link className={buttonVariants({ size: "sm" })} href="/"><Plus data-icon="inline-start" />New invoice</Link>
        <SignOutButton />
      </nav>

      <details className="relative lg:hidden">
        <summary className={`${buttonVariants({ variant: "outline", size: "sm" })} min-h-10 cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><Menu data-icon="inline-start" />Menu</summary>
        <div className="absolute right-0 z-50 mt-2 flex min-w-56 flex-col gap-1 rounded-xl border border-border bg-popover p-2 shadow-2xl shadow-stone-950/20 animate-in fade-in-0 slide-in-from-top-2 duration-200">
          {links.map((link) => <Link className={`${buttonVariants({ variant: "ghost" })} min-h-10 justify-start`} href={link.href} key={link.href}>{link.icon}{link.label}</Link>)}
          <div className="my-1 h-px bg-border" />
          <Link className={`${buttonVariants()} min-h-10 justify-start`} href="/"><Plus data-icon="inline-start" />New invoice</Link>
          <SignOutButton />
        </div>
      </details>
    </div>
  </header>
}
