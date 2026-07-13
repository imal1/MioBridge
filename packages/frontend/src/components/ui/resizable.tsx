import type * as React from "react"
import { Icon } from "@iconify/react"
import { Group, Panel, Separator as ResizeSeparator } from "react-resizable-panels"

import { cn } from "@/lib/utils"

const ResizablePanelGroup = ({
  className,
  direction = "horizontal",
  ...props
}: Omit<React.ComponentProps<typeof Group>, "orientation"> & {
  direction?: "horizontal" | "vertical"
}) => (
  <Group
    orientation={direction}
    data-panel-group-direction={direction}
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      "max-md:!h-auto max-md:!min-h-0 max-md:!flex-col max-md:!overflow-visible max-md:gap-4",
      "[&>[data-panel]]:max-md:!w-full [&>[data-panel]]:max-md:!max-w-none [&>[data-panel]]:max-md:!flex-none [&>[data-panel]]:max-md:!overflow-visible",
      "[&>[data-separator]]:max-md:!hidden",
      className,
    )}
    {...props}
  />
)

const ResizablePanel = Panel

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizeSeparator> & {
  withHandle?: boolean
}) => (
  <ResizeSeparator
    className={cn(
      "relative flex w-3 items-center justify-center bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 data-[panel-group-direction=vertical]:h-3 data-[panel-group-direction=vertical]:w-full",
      className,
    )}
    {...props}
  >
    {withHandle ? (
      <div className="z-10 flex h-8 w-2 items-center justify-center rounded-full bg-[var(--surface-container-high)]">
        <Icon icon="ph:dots-six-vertical-bold" className="h-2.5 w-2.5" />
      </div>
    ) : null}
  </ResizeSeparator>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
