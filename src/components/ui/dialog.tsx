import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
        ref={ref}
        className={cn(
            "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
            className
        )}
        {...props}
    />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
    showClose?: boolean;
}

const DialogContent = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Content>,
    DialogContentProps
>(({ className, children, showClose = true, ...props }, ref) => (
    <DialogPortal>
        <DialogOverlay asChild>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
            />
        </DialogOverlay>
        <DialogPrimitive.Content
            ref={ref}
            className={cn(
                "fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%]",
                className
            )}
            {...props}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ type: "spring", duration: 0.3 }}
                className="relative bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-800 p-6 max-h-[90vh] overflow-y-auto"
            >
                {children}
                {showClose && (
                    <DialogPrimitive.Close className="absolute right-4 top-4 rounded-full p-2 opacity-70 transition-all hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none">
                        <X className="h-5 w-5" />
                        <span className="sr-only">Close</span>
                    </DialogPrimitive.Close>
                )}
            </motion.div>
        </DialogPrimitive.Content>
    </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("flex flex-col space-y-2 text-center sm:text-left mb-4", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogTitle = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        className={cn("text-xl font-bold leading-none tracking-tight", className)}
        {...props}
    />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        className={cn("text-sm text-gray-500 dark:text-gray-400", className)}
        {...props}
    />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

// Bottom Sheet variant for mobile
const BottomSheet = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Content>,
    DialogContentProps
>(({ className, children, showClose = true, ...props }, ref) => (
    <DialogPortal>
        <DialogOverlay asChild>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            />
        </DialogOverlay>
        <DialogPrimitive.Content
            ref={ref}
            className={cn(
                "fixed bottom-0 left-0 right-0 z-50",
                className
            )}
            {...props}
        >
            <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="relative bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl border-t border-gray-200 dark:border-gray-800 p-6 pb-8 max-h-[90vh] overflow-y-auto"
            >
                {/* Handle bar */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full" />
                <div className="mt-4">
                    {children}
                </div>
                {showClose && (
                    <DialogPrimitive.Close className="absolute right-4 top-4 rounded-full p-2 opacity-70 transition-all hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-800">
                        <X className="h-5 w-5" />
                    </DialogPrimitive.Close>
                )}
            </motion.div>
        </DialogPrimitive.Content>
    </DialogPortal>
));
BottomSheet.displayName = "BottomSheet";

export {
    Dialog,
    DialogPortal,
    DialogOverlay,
    DialogTrigger,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    BottomSheet,
};
