import type { ReactNode } from "react"

type WorkspacePageHeaderProps = {
  eyebrow: string
  title: string
  /** A data-heavy page can hide the description to reclaim vertical space. */
  compact?: boolean
  description?: string
  actions?: ReactNode
}

export function WorkspacePageHeader({ eyebrow, title, description, actions, compact }: WorkspacePageHeaderProps) {
  return (
    <header className={compact ? "workspace-page-header workspace-page-header-compact" : "workspace-page-header"}>
      <div className="min-w-0">
        <p className="eyebrow flex items-center gap-2">
          <span aria-hidden="true" className="h-px w-5 bg-primary/45" />
          {eyebrow}
        </p>
        <h1 className={compact ? "mt-1.5 font-heading text-2xl font-medium leading-tight tracking-[-0.02em] text-foreground" : "mt-3 font-heading text-[2.5rem] font-medium leading-none tracking-[-0.035em] text-foreground"}>
          {title}
        </h1>
        {description && !compact && (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}
