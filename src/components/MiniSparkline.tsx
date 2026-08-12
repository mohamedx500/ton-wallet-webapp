/**
 * Tiny SVG sparkline for token rows. Renders nothing when data is missing.
 * Stroke + soft gradient fill; no charting library.
 */

import React, { useId } from 'react';
import { cn } from '../lib/utils';

interface MiniSparklineProps {
    points?: readonly number[] | null;
    positive?: boolean;
    className?: string;
    width?: number;
    height?: number;
}

export function MiniSparkline({
    points,
    positive = true,
    className,
    width = 56,
    height = 20,
}: MiniSparklineProps) {
    const gradId = useId().replace(/:/g, '');
    if (!points || points.length < 2) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
        if (!Number.isFinite(p)) continue;
        if (p < min) min = p;
        if (p > max) max = p;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

    const range = max - min || 1;
    const padX = 1;
    const padY = 2;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const step = innerW / (points.length - 1);

    const coords = points.map((p, i) => {
        const x = padX + i * step;
        const y = padY + innerH - ((p - min) / range) * innerH;
        return { x, y };
    });

    const linePath = coords
        .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
        .join(' ');

    const last = coords[coords.length - 1];
    const first = coords[0];
    const areaPath = `${linePath} L${last.x.toFixed(1)},${(height - padY).toFixed(1)} L${first.x.toFixed(1)},${(height - padY).toFixed(1)} Z`;

    const stroke = positive ? 'rgb(16 185 129)' : 'rgb(239 68 68)';
    const fillTop = positive ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)';
    const fillBottom = positive ? 'rgba(16, 185, 129, 0)' : 'rgba(239, 68, 68, 0)';

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className={cn('shrink-0', className)}
            aria-hidden
        >
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={fillTop} />
                    <stop offset="100%" stopColor={fillBottom} />
                </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${gradId})`} />
            <path
                d={linePath}
                fill="none"
                stroke={stroke}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export default MiniSparkline;
