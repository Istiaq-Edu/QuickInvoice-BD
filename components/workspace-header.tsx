import Link from "next/link"
import { ArrowLeft, Menu, Plus, Trash2 } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { SignOutButton } from "@/components/sign-out-button"
import { buttonVariants } from "@/components/ui/button"

export function WorkspaceHeader({ backHref, showTrash = true }: { backHref: string; showTrash?: boolean }) {
  const links = [
    { href: "/customers", label: "Customers" },
    { href: "/account/settings", label: "Seller profile" },
    ...(showTrash ? [{ href: "/invoices/trash", label: "Trash", icon: <Trash2 data-icon="inline-start" /> }] : []),
  ]

  return <header className="border-b border-slate-200/80 bg-white">
    <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
      <Link className="flex min-h-10 min-w-0 items-center gap-2 text-sm font-semibold" href={backHref}><ArrowLeft size={16} /><BrandLogo /></Link>
      <nav className="hidden items-center gap-2 md:flex" aria-label="Workspace navigation">
        {links.map((link) => <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={link.href} key={link.href}>{link.icon}{link.label}</Link>)}
        <Link className={buttonVariants()} href="/"><Plus data-icon="inline-start" />New invoice</Link>
        <SignOutButton />
      </nav>
      <details className="relative md:hidden">
        <summary className={`${buttonVariants({ variant: "outline", size: "sm" })} min-h-10 cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><Menu data-icon="inline-start" />Menu</summary>
        <div className="absolute right-0 z-20 mt-2 flex min-w-52 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {links.map((link) => <Link className={`${buttonVariants({ variant: "ghost" })} min-h-10 justify-start`} href={link.href} key={link.href}>{link.icon}{link.label}</Link>)}
          <Link className={`${buttonVariants()} min-h-10 justify-start`} href="/"><Plus data-icon="inline-start" />New invoice</Link>
          <SignOutButton />
        </div>
      </details>
    </div>
  </header>
}
