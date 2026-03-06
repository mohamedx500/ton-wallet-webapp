import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

const Switch = React.forwardRef<
    React.ElementRef<typeof SwitchPrimitives.Root>,
    React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
    <SwitchPrimitives.Root
        className={cn(
            "peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-primary-500 data-[state=checked]:to-primary-600",
            "data-[state=unchecked]:bg-gray-200 dark:data-[state=unchecked]:bg-gray-700",
            className
        )}
        {...props}
        ref={ref}
    >
        <SwitchPrimitives.Thumb
            className={cn(
                "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200",
                "data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5"
            )}
        />
    </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

// Animated Switch with icon indicators
interface AnimatedSwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
    onIcon?: React.ReactNode;
    offIcon?: React.ReactNode;
}

const AnimatedSwitch = React.forwardRef<
    React.ElementRef<typeof SwitchPrimitives.Root>,
    AnimatedSwitchProps
>(({ className, onIcon, offIcon, ...props }, ref) => {
    const [isChecked, setIsChecked] = React.useState(props.checked || props.defaultChecked || false);

    return (
        <SwitchPrimitives.Root
            className={cn(
                "peer relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-all duration-300",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                "disabled:cursor-not-allowed disabled:opacity-50",
                isChecked
                    ? "bg-gradient-to-r from-primary-500 to-accent-500 shadow-glow"
                    : "bg-gray-200 dark:bg-gray-700",
                className
            )}
            {...props}
            ref={ref}
            onCheckedChange={(checked) => {
                setIsChecked(checked);
                props.onCheckedChange?.(checked);
            }}
        >
            <motion.div
                className="absolute inset-0 flex items-center justify-between px-1.5"
                initial={false}
            >
                <motion.span
                    animate={{ opacity: isChecked ? 0 : 1, scale: isChecked ? 0.5 : 1 }}
                    className="text-gray-400 text-xs"
                >
                    {offIcon}
                </motion.span>
                <motion.span
                    animate={{ opacity: isChecked ? 1 : 0, scale: isChecked ? 1 : 0.5 }}
                    className="text-white text-xs"
                >
                    {onIcon}
                </motion.span>
            </motion.div>
            <motion.div
                className="block h-6 w-6 rounded-full bg-white shadow-lg"
                animate={{
                    x: isChecked ? 26 : 2,
                }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
        </SwitchPrimitives.Root>
    );
});
AnimatedSwitch.displayName = "AnimatedSwitch";

export { Switch, AnimatedSwitch };
