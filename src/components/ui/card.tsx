import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "glass" | "glow" | "gradient";
    hoverable?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
    ({ className, variant = "default", hoverable = false, children, ...props }, ref) => {
        const variants = {
            default: "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800",
            glass: "bg-white/10 dark:bg-gray-900/50 backdrop-blur-xl border border-white/20 dark:border-gray-700/50",
            glow: "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-glow",
            gradient: "bg-gradient-to-br from-primary-500/10 to-accent-500/10 border border-primary-500/20",
        };

        const hoverClass = hoverable
            ? "hover:shadow-xl hover:-translate-y-1 hover:border-primary-500/50 cursor-pointer"
            : "";

        return (
            <div
                ref={ref}
                className={cn(
                    "rounded-2xl p-4 transition-all duration-300",
                    variants[variant],
                    hoverClass,
                    className
                )}
                {...props}
            >
                {children}
            </div>
        );
    }
);
Card.displayName = "Card";

// Motion Card for animations
const MotionCard = motion(Card);

// Glowing Card with animated border
const GlowingCard = React.forwardRef<HTMLDivElement, CardProps>(
    ({ className, children, ...props }, ref) => {
        return (
            <div className="relative group">
                {/* Animated gradient border */}
                <div className="absolute -inset-0.5 bg-gradient-to-r from-primary-500 via-accent-500 to-primary-500 rounded-2xl blur opacity-30 group-hover:opacity-60 transition duration-500 animate-gradient bg-[length:200%_200%]" />
                <div
                    ref={ref}
                    className={cn(
                        "relative bg-white dark:bg-gray-900 rounded-2xl p-4 transition-all duration-300",
                        className
                    )}
                    {...props}
                >
                    {children}
                </div>
            </div>
        );
    }
);
GlowingCard.displayName = "GlowingCard";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn("flex flex-col space-y-1.5 pb-4", className)} {...props} />
    )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h3 ref={ref} className={cn("text-lg font-bold leading-none tracking-tight", className)} {...props} />
    )
);
CardTitle.displayName = "CardTitle";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn("pt-0", className)} {...props} />
    )
);
CardContent.displayName = "CardContent";

export { Card, MotionCard, GlowingCard, CardHeader, CardTitle, CardContent };
