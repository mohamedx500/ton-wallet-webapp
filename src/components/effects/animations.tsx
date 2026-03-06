import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../../lib/utils";

// Staggered list animation container
interface StaggerContainerProps {
    children: React.ReactNode;
    className?: string;
    staggerDelay?: number;
}

export function StaggerContainer({ children, className, staggerDelay = 0.05 }: StaggerContainerProps) {
    return (
        <motion.div
            className={className}
            initial="hidden"
            animate="visible"
            variants={{
                hidden: { opacity: 0 },
                visible: {
                    opacity: 1,
                    transition: {
                        staggerChildren: staggerDelay,
                    },
                },
            }}
        >
            {children}
        </motion.div>
    );
}

// Staggered list item
interface StaggerItemProps {
    children: React.ReactNode;
    className?: string;
}

export function StaggerItem({ children, className }: StaggerItemProps) {
    return (
        <motion.div
            className={className}
            variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0 },
            }}
            transition={{ duration: 0.3, ease: "easeOut" }}
        >
            {children}
        </motion.div>
    );
}

// Fade in animation wrapper
interface FadeInProps {
    children: React.ReactNode;
    className?: string;
    delay?: number;
    direction?: "up" | "down" | "left" | "right" | "none";
}

export function FadeIn({ children, className, delay = 0, direction = "up" }: FadeInProps) {
    const directions = {
        up: { y: 20 },
        down: { y: -20 },
        left: { x: 20 },
        right: { x: -20 },
        none: {},
    };

    return (
        <motion.div
            className={className}
            initial={{ opacity: 0, ...directions[direction] }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.4, delay, ease: "easeOut" }}
        >
            {children}
        </motion.div>
    );
}

// Scale in animation
interface ScaleInProps {
    children: React.ReactNode;
    className?: string;
    delay?: number;
}

export function ScaleIn({ children, className, delay = 0 }: ScaleInProps) {
    return (
        <motion.div
            className={className}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay, type: "spring", stiffness: 200 }}
        >
            {children}
        </motion.div>
    );
}

// Slide animation for page transitions
interface SlideTransitionProps {
    children: React.ReactNode;
    className?: string;
    direction?: "left" | "right";
    isVisible?: boolean;
}

export function SlideTransition({ children, className, direction = "right", isVisible = true }: SlideTransitionProps) {
    return (
        <AnimatePresence mode="wait">
            {isVisible && (
                <motion.div
                    className={className}
                    initial={{ opacity: 0, x: direction === "right" ? 50 : -50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: direction === "right" ? -50 : 50 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                    {children}
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// Pulse animation for loading states
interface PulseProps {
    className?: string;
    size?: "sm" | "md" | "lg";
}

export function Pulse({ className, size = "md" }: PulseProps) {
    const sizes = {
        sm: "w-4 h-4",
        md: "w-8 h-8",
        lg: "w-12 h-12",
    };

    return (
        <div className={cn("relative", sizes[size], className)}>
            <motion.div
                className="absolute inset-0 rounded-full bg-primary-500"
                animate={{
                    scale: [1, 1.5, 1],
                    opacity: [0.5, 0, 0.5],
                }}
                transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
            />
            <div className="absolute inset-0 rounded-full bg-primary-500" />
        </div>
    );
}

// Shimmer loading skeleton
interface ShimmerProps {
    className?: string;
}

export function Shimmer({ className }: ShimmerProps) {
    return (
        <div
            className={cn(
                "relative overflow-hidden bg-gray-200 dark:bg-gray-800 rounded-lg",
                className
            )}
        >
            <motion.div
                className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent"
                animate={{ translateX: ["100%", "-100%"] }}
                transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "linear",
                }}
            />
        </div>
    );
}

// Success checkmark animation
export function SuccessCheckmark({ className }: { className?: string }) {
    return (
        <motion.div
            className={cn("flex items-center justify-center", className)}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
        >
            <motion.svg
                className="w-16 h-16 text-success-500"
                viewBox="0 0 52 52"
                initial="hidden"
                animate="visible"
            >
                <motion.circle
                    cx="26"
                    cy="26"
                    r="25"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.5 }}
                />
                <motion.path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14 27l7 7 17-17"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.3, delay: 0.5 }}
                />
            </motion.svg>
        </motion.div>
    );
}
