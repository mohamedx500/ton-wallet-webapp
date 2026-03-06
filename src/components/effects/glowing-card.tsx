import React from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { cn } from "../../lib/utils";

interface GlowingCardProps {
    children: React.ReactNode;
    className?: string;
    glowColor?: string;
}

export function GlowingCard({ children, className, glowColor = "primary" }: GlowingCardProps) {
    const x = useMotionValue(0);
    const y = useMotionValue(0);

    const mouseXSpring = useSpring(x);
    const mouseYSpring = useSpring(y);

    const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["8deg", "-8deg"]);
    const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-8deg", "8deg"]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const xPct = mouseX / width - 0.5;
        const yPct = mouseY / height - 0.5;
        x.set(xPct);
        y.set(yPct);
    };

    const handleMouseLeave = () => {
        x.set(0);
        y.set(0);
    };

    const glowColors = {
        primary: "from-primary-500/50 via-accent-500/50 to-primary-500/50",
        success: "from-success-500/50 via-success-400/50 to-success-500/50",
        accent: "from-accent-500/50 via-primary-500/50 to-accent-500/50",
    };

    return (
        <motion.div
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{
                rotateX,
                rotateY,
                transformStyle: "preserve-3d",
            }}
            className={cn("relative", className)}
        >
            {/* Animated glow border */}
            <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-r opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm animate-gradient bg-[length:200%_200%]"
                style={{
                    background: `linear-gradient(90deg, var(--tw-gradient-stops))`,
                }}
            />
            <motion.div
                className={cn(
                    "absolute -inset-0.5 rounded-2xl bg-gradient-to-r blur opacity-40 group-hover:opacity-75 transition-all duration-500",
                    glowColors[glowColor as keyof typeof glowColors] || glowColors.primary
                )}
                animate={{
                    backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                }}
                transition={{
                    duration: 5,
                    repeat: Infinity,
                    ease: "linear",
                }}
                style={{
                    backgroundSize: "200% 200%",
                }}
            />
            <div
                className="relative bg-white dark:bg-gray-900 rounded-2xl p-4 h-full"
                style={{ transform: "translateZ(20px)" }}
            >
                {children}
            </div>
        </motion.div>
    );
}

// Hover Card with 3D tilt effect
interface TiltCardProps {
    children: React.ReactNode;
    className?: string;
}

export function TiltCard({ children, className }: TiltCardProps) {
    const ref = React.useRef<HTMLDivElement>(null);
    const [rotations, setRotations] = React.useState({ x: 0, y: 0 });

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = (y - centerY) / 10;
        const rotateY = (centerX - x) / 10;
        setRotations({ x: rotateX, y: rotateY });
    };

    const handleMouseLeave = () => {
        setRotations({ x: 0, y: 0 });
    };

    return (
        <motion.div
            ref={ref}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            animate={{
                rotateX: rotations.x,
                rotateY: rotations.y,
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={cn("relative", className)}
            style={{ transformStyle: "preserve-3d", perspective: "1000px" }}
        >
            {children}
        </motion.div>
    );
}

// Token Card with glow on hover
interface TokenCardProps {
    icon: React.ReactNode;
    name: string;
    symbol: string;
    balance: string;
    value: string;
    onClick?: () => void;
    darkMode?: boolean;
}

export function TokenCard({ icon, name, symbol, balance, value, onClick, darkMode }: TokenCardProps) {
    return (
        <motion.div
            onClick={onClick}
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
                "group relative flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all duration-300",
                darkMode
                    ? "bg-gray-900/80 hover:bg-gray-800/90 border border-gray-800 hover:border-primary-500/50"
                    : "bg-white hover:bg-gray-50 border border-gray-100 hover:border-primary-500/30 shadow-sm hover:shadow-lg"
            )}
        >
            {/* Subtle glow on hover */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary-500/0 via-primary-500/5 to-primary-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            <div className="relative flex items-center gap-3">
                <div className={cn(
                    "w-11 h-11 rounded-full flex items-center justify-center text-xl overflow-hidden",
                    darkMode ? "bg-gray-800" : "bg-gray-100"
                )}>
                    {icon}
                </div>
                <div>
                    <p className={cn("font-semibold", darkMode ? "text-white" : "text-gray-900")}>{name}</p>
                    <p className={cn("text-sm", darkMode ? "text-gray-500" : "text-gray-500")}>{symbol}</p>
                </div>
            </div>
            <div className="relative text-right">
                <p className={cn("font-bold", darkMode ? "text-white" : "text-gray-900")}>{balance}</p>
                <p className={cn("text-sm", darkMode ? "text-gray-500" : "text-gray-500")}>{value}</p>
            </div>
        </motion.div>
    );
}
