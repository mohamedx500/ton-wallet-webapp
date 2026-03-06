import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    icon?: React.ReactNode;
    error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, icon, error, ...props }, ref) => {
        const [isFocused, setIsFocused] = React.useState(false);

        return (
            <div className="relative">
                {icon && (
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                        {icon}
                    </div>
                )}
                <motion.div
                    className={cn(
                        "absolute inset-0 rounded-xl opacity-0 pointer-events-none",
                        isFocused && "opacity-100"
                    )}
                    style={{
                        background: "linear-gradient(90deg, rgba(59,130,246,0.2), rgba(139,92,246,0.2))",
                    }}
                    animate={{ opacity: isFocused ? 0.5 : 0 }}
                    transition={{ duration: 0.2 }}
                />
                <input
                    type={type}
                    className={cn(
                        "relative flex h-12 w-full rounded-xl border bg-white dark:bg-gray-900 px-4 py-2 text-sm transition-all duration-200",
                        "border-gray-200 dark:border-gray-700",
                        "placeholder:text-gray-400 dark:placeholder:text-gray-500",
                        "focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        icon && "pl-12",
                        error && "border-danger-500 focus:ring-danger-500/50",
                        className
                    )}
                    ref={ref}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    {...props}
                />
                {error && (
                    <motion.p
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-danger-500 text-xs mt-1 ml-1"
                    >
                        {error}
                    </motion.p>
                )}
            </div>
        );
    }
);
Input.displayName = "Input";

// Textarea variant
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    error?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, error, ...props }, ref) => {
        return (
            <div>
                <textarea
                    className={cn(
                        "flex min-h-[100px] w-full rounded-xl border bg-white dark:bg-gray-900 px-4 py-3 text-sm transition-all duration-200",
                        "border-gray-200 dark:border-gray-700",
                        "placeholder:text-gray-400 dark:placeholder:text-gray-500",
                        "focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500",
                        "disabled:cursor-not-allowed disabled:opacity-50 resize-none",
                        error && "border-danger-500",
                        className
                    )}
                    ref={ref}
                    {...props}
                />
                {error && (
                    <motion.p
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-danger-500 text-xs mt-1 ml-1"
                    >
                        {error}
                    </motion.p>
                )}
            </div>
        );
    }
);
Textarea.displayName = "Textarea";

export { Input, Textarea };
