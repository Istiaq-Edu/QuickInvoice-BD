"use client"

import { Menu } from "@base-ui/react/menu"
import { Download, FileText, MoreHorizontal, Pencil, Repeat2, Trash2, Wallet } from "lucide-react"
import { cn } from "cn"

export type RowAction = {
  /** Set while the row's request is in flight; renders the control inert. */
  disabled?: boolean
  destructive?: boolean
  href?: string
  icon: typeof Pencil
  label: string
  onSelect?: () => void
  /** "primary" renders as a filled button, the rest live behind the overflow menu. */
  primary?: boolean
  target?: string
}

const triggerClass =
  "inline-flex min-h-10 items-center gap-1 rounded-lg border border-transparent px-2 text-xs font-semibold text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
const primaryClass =
  "inline-flex min-h-10 items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
const itemClass =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-foreground/80 outline-none transition-colors data-highlighted:bg-muted data-highlighted:text-foreground"

/**
 * A row's actions, kept to at most two visible buttons.
 *
 * Eight inline buttons in a 190px column wrapped into an unreadable block that
 * spilled across the neighbouring Status cell. The two a seller reaches for stay
 * visible; everything else moves into a menu, which is also the pattern used by
 * FreshBooks, QuickBooks and Stripe for the same reason.
 */
export function RowActions({ actions, label }: { actions: RowAction[]; label: string }) {
  const primary = actions.filter((action) => action.primary)
  const rest = actions.filter((action) => !action.primary)

  const renderItem = (action: RowAction, className: string) => {
    const Icon = action.icon
    if (action.href) {
      return <Menu.Item className={className} disabled={action.disabled} key={action.label} render={<a href={action.disabled ? undefined : action.href} rel={action.target === "_blank" ? "noreferrer" : undefined} target={action.target} />}>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        {action.label}
      </Menu.Item>
    }
    return <Menu.Item className={cn(className, action.destructive && "text-destructive data-highlighted:bg-destructive/8 data-highlighted:text-destructive")} disabled={action.disabled} key={action.label} onClick={action.onSelect}>
      <Icon className={cn("size-4 shrink-0 text-muted-foreground", action.destructive && "text-destructive")} />
      {action.label}
    </Menu.Item>
  }

  return <div className="flex flex-wrap items-center justify-end gap-1.5">
    {primary.map((action) => {
      const Icon = action.icon
      const className = cn(primaryClass, action.disabled && "pointer-events-none opacity-50")
      if (action.href) {
        return <a aria-disabled={action.disabled || undefined} className={className} href={action.disabled ? undefined : action.href} key={action.label} rel={action.target === "_blank" ? "noreferrer" : undefined} target={action.target}>
          <Icon className="size-3.5" />
          {action.label}
        </a>
      }
      return <button className={className} disabled={action.disabled} key={action.label} onClick={action.onSelect} type="button">
        <Icon className="size-3.5" />
        {action.label}
      </button>
    })}

    {rest.length > 0 && <Menu.Root>
      <Menu.Trigger aria-label={`More actions for ${label}`} className={triggerClass}>
        <MoreHorizontal className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" className="z-50 outline-none" sideOffset={6}>
          <Menu.Popup className="w-56 rounded-xl border border-border bg-background p-1 shadow-lg">
            {rest.map((action) => renderItem(action, itemClass))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>}
  </div>
}

export const rowActionIcons = { Download, FileText, Pencil, Repeat2, Trash2, Wallet }
