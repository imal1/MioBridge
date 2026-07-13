import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-[24px] border p-4 text-sm shadow-[var(--shadow-card)]",
  {
    variants: {
      variant: {
        default: "border-[var(--border)] bg-card text-card-foreground",
        destructive: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
        success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <motion.div
    ref={ref}
    role="alert"
    initial={{ opacity: 0, y: -6, scale: 0.99 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.62, ease: [0.32, 0.72, 0, 1] }}
    className={cn(alertVariants({ variant }), className)}
    {...(props as any)}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />
  ),
)
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm opacity-90", className)} {...props} />
  ),
)
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
