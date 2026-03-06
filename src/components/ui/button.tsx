import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
    {
        variants: {
            variant: {
                default:
                    "bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:from-primary-600 hover:to-primary-700",
                secondary:
                    "bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-lg shadow-accent-500/25 hover:shadow-accent-500/40",
                success:
                    "bg-gradient-to-r from-success-500 to-success-600 text-white shadow-lg shadow-success-500/25 hover:shadow-success-500/40",
                danger:
                    "bg-gradient-to-r from-danger-500 to-danger-600 text-white shadow-lg shadow-danger-500/25 hover:shadow-danger-500/40",
                outline:
                    "border-2 border-primary-500 text-primary-500 hover:bg-primary-500 hover:text-white",
                ghost:
                    "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300",
                glass:
                    "bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20",
            },
            size: {
                default: "h-11 px-6 py-2",
                sm: "h-9 px-4 text-xs",
                lg: "h-14 px-8 text-base",
                icon: "h-11 w-11",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean;
    isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, isLoading, children, ...props }, ref) => {
        const Comp = asChild ? Slot : "button";
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                disabled={isLoading || props.disabled}
                {...props}
            >
                {isLoading ? (
                    <motion.div
                        className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                ) : children}
            </Comp>
        );
    }
);
Button.displayName = "Button";

// Animated Button with Framer Motion
const MotionButton = motion(Button);

export { Button, MotionButton, buttonVariants };
