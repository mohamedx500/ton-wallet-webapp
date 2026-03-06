import React, { useEffect, useRef } from "react";
import { motion, useSpring, useTransform, useMotionValue } from "framer-motion";
import { cn } from "../../lib/utils";

interface AnimatedCounterProps {
    value: number;
    duration?: number;
    className?: string;
    prefix?: string;
    suffix?: string;
    decimals?: number;
}

export function AnimatedCounter({
    value,
    duration = 1,
    className,
    prefix = "",
    suffix = "",
    decimals = 2,
}: AnimatedCounterProps) {
    const motionValue = useMotionValue(0);
    const springValue = useSpring(motionValue, {
        damping: 30,
        stiffness: 100,
        duration: duration * 1000,
    });
    const displayValue = useTransform(springValue, (latest) =>
        latest.toFixed(decimals)
    );
    const [display, setDisplay] = React.useState("0.00");

    useEffect(() => {
        motionValue.set(value);
    }, [value, motionValue]);

    useEffect(() => {
        const unsubscribe = displayValue.on("change", (v) => {
            setDisplay(v);
        });
        return unsubscribe;
    }, [displayValue]);

    return (
        <motion.span
            className={cn("tabular-nums", className)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            {prefix}{display}{suffix}
        </motion.span>
    );
}

// Animated number with flip effect
interface FlipNumberProps {
    value: string;
    className?: string;
}

export function FlipNumber({ value, className }: FlipNumberProps) {
    const prevValue = useRef(value);
    const [isFlipping, setIsFlipping] = React.useState(false);

    useEffect(() => {
        if (prevValue.current !== value) {
            setIsFlipping(true);
            const timer = setTimeout(() => setIsFlipping(false), 300);
            prevValue.current = value;
            return () => clearTimeout(timer);
        }
    }, [value]);

    return (
        <motion.span
            className={cn("inline-block", className)}
            animate={isFlipping ? { rotateX: [0, -90, 0], scale: [1, 0.9, 1] } : {}}
            transition={{ duration: 0.3 }}
        >
            {value}
        </motion.span>
    );
}

// Balance display with animated counter and currency
interface BalanceDisplayProps {
    amount: number;
    currency?: string;
    className?: string;
    size?: "sm" | "md" | "lg" | "xl";
}

export function BalanceDisplay({
    amount,
    currency = "USD",
    className,
    size = "lg",
}: BalanceDisplayProps) {
    const sizes = {
        sm: "text-xl",
        md: "text-2xl",
        lg: "text-4xl",
        xl: "text-5xl",
    };

    return (
        <div className={cn("flex items-baseline justify-center gap-2", className)}>
            <span className={cn(sizes[size], "font-bold")}>$</span>
            <AnimatedCounter
                value={amount}
                className={cn(sizes[size], "font-bold")}
                decimals={2}
            />
            <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-sm opacity-70 ml-1"
            >
                {currency}
            </motion.span>
        </div>
    );
}

// Percentage change indicator
interface PercentageChangeProps {
    value: number;
    className?: string;
}

export function PercentageChange({ value, className }: PercentageChangeProps) {
    const isPositive = value >= 0;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm font-medium",
                isPositive
                    ? "bg-success-500/10 text-success-500"
                    : "bg-danger-500/10 text-danger-500",
                className
            )}
        >
            <motion.span
                animate={{ rotate: isPositive ? 0 : 180 }}
                transition={{ duration: 0.3 }}
            >
                ↑
            </motion.span>
            <span>{Math.abs(value).toFixed(2)}%</span>
        </motion.div>
    );
}
