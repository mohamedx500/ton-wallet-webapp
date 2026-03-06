import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

interface BackgroundGradientProps {
    children?: React.ReactNode;
    className?: string;
    containerClassName?: string;
    animate?: boolean;
}

export function BackgroundGradient({
    children,
    className,
    containerClassName,
    animate = true,
}: BackgroundGradientProps) {
    return (
        <div className={cn("relative group", containerClassName)}>
            <motion.div
                initial={{ opacity: 0.5 }}
                animate={animate ? {
                    opacity: [0.5, 0.8, 0.5],
                    scale: [1, 1.02, 1],
                } : {}}
                transition={{
                    duration: 5,
                    repeat: Infinity,
                    repeatType: "reverse",
                }}
                className={cn(
                    "absolute inset-0 rounded-3xl bg-gradient-to-r from-primary-500 via-accent-500 to-primary-500 opacity-50 blur-xl",
                    className
                )}
            />
            <div className="relative">{children}</div>
        </div>
    );
}

// Animated gradient orbs for background
interface GradientOrbsProps {
    className?: string;
}

export function GradientOrbs({ className }: GradientOrbsProps) {
    return (
        <div className={cn("absolute inset-0 overflow-hidden pointer-events-none", className)}>
            <motion.div
                className="absolute w-96 h-96 rounded-full bg-gradient-to-r from-primary-500/30 to-accent-500/30 blur-3xl"
                animate={{
                    x: [0, 100, 50, 0],
                    y: [0, 50, 100, 0],
                    scale: [1, 1.2, 0.9, 1],
                }}
                transition={{
                    duration: 20,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
                style={{ top: "-10%", left: "-10%" }}
            />
            <motion.div
                className="absolute w-80 h-80 rounded-full bg-gradient-to-r from-accent-500/20 to-success-500/20 blur-3xl"
                animate={{
                    x: [0, -80, -40, 0],
                    y: [0, 80, 40, 0],
                    scale: [1, 0.9, 1.1, 1],
                }}
                transition={{
                    duration: 15,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
                style={{ bottom: "-5%", right: "-5%" }}
            />
            <motion.div
                className="absolute w-64 h-64 rounded-full bg-gradient-to-r from-primary-400/20 to-primary-600/20 blur-2xl"
                animate={{
                    x: [0, 60, -30, 0],
                    y: [0, -40, 60, 0],
                }}
                transition={{
                    duration: 18,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
                style={{ top: "30%", right: "20%" }}
            />
        </div>
    );
}

// Grid background pattern
export function GridBackground({ className }: { className?: string }) {
    return (
        <div className={cn("absolute inset-0 pointer-events-none", className)}>
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f0a_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f0a_1px,transparent_1px)] bg-[size:24px_24px]" />
            <div className="absolute inset-0 bg-gradient-to-t from-white dark:from-gray-950 via-transparent to-transparent" />
        </div>
    );
}

// Spotlight effect that follows mouse
interface SpotlightProps {
    className?: string;
    fill?: string;
}

export function Spotlight({ className, fill = "white" }: SpotlightProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = React.useState({ x: 0, y: 0 });
    const [opacity, setOpacity] = React.useState(0);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!divRef.current) return;
            const rect = divRef.current.getBoundingClientRect();
            setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        };

        const handleMouseEnter = () => setOpacity(1);
        const handleMouseLeave = () => setOpacity(0);

        const div = divRef.current;
        if (div) {
            div.addEventListener("mousemove", handleMouseMove);
            div.addEventListener("mouseenter", handleMouseEnter);
            div.addEventListener("mouseleave", handleMouseLeave);
        }

        return () => {
            if (div) {
                div.removeEventListener("mousemove", handleMouseMove);
                div.removeEventListener("mouseenter", handleMouseEnter);
                div.removeEventListener("mouseleave", handleMouseLeave);
            }
        };
    }, []);

    return (
        <div
            ref={divRef}
            className={cn("absolute inset-0 overflow-hidden", className)}
        >
            <motion.div
                className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-300"
                style={{
                    opacity,
                    background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, rgba(59,130,246,0.15), transparent 40%)`,
                }}
            />
        </div>
    );
}
