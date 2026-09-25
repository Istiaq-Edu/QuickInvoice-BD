import type { ReactNode } from "react"

type WorkspacePageHeaderProps = {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
}

export function WorkspacePageHeader({ eyebrow, title, description, actions }: WorkspacePageHeaderProps) {
  return (
    <header className="workspace-page-header">
      <div className="min-w-0">
        <p className="eyebrow flex items-center gap-2">
          <span aria-hidden="true" className="h-px w-5 bg-primary/45" />
          {eyebrow}
        </p>
        <h1 className="mt-3 font-heading text-[2.5rem] font-medium leading-none tracking-[-0.035em] text-foreground">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}
