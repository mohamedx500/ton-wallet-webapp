/// <reference types="vitest" />
/**
 * Vite + Vitest configuration.
 *
 * This is the only Vite config. A second `vite.config.js` used to sit beside it
 * and *won*: Vite resolves `vite.config.js` before `vite.config.ts`, so the React
 * plugin, the `@` alias and `base: './'` declared here were all silently inert —
 * which is why the committed `dist/index.html` references absolute `/assets/…`
 * paths and the dev server came up on 5180 while the README documents 5173. The
 * stale JavaScript copy has been removed.
 */

import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

function tonConnectManifestProxyRewrite(requestPath: string): string {
    const queryIndex = requestPath.indexOf('?');
    if (queryIndex === -1) return requestPath;
    const manifestUrl = new URLSearchParams(requestPath.slice(queryIndex + 1)).get('url');
    if (!manifestUrl) return requestPath;
    return `/tonconnect-proxy/${manifestUrl}`;
}

const tonConnectManifestProxy = {
    target: 'https://walletbot.me',
    changeOrigin: true,
    rewrite: tonConnectManifestProxyRewrite,
} as const;

export default defineConfig({
    plugins: [
        react(),
        nodePolyfills({
            include: ['buffer', 'process', 'util', 'stream'],
            globals: {
                Buffer: true,
                global: true,
                process: true,
            },
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        sourcemap: false,
        chunkSizeWarningLimit: 1000,
    },
    esbuild: {
        drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    },
    // Relative, so the built bundle works when served from a subdirectory.
    base: './',
    server: {
        proxy: {
            '/api/tonconnect-manifest': tonConnectManifestProxy,
        },
    },
    preview: {
        proxy: {
            '/api/tonconnect-manifest': tonConnectManifestProxy,
        },
    },
    test: {
        // `node`, not `jsdom`: the critical paths under test — payload
        // construction, allow-list enforcement, slippage arithmetic — are pure
        // and must not depend on a DOM being present to pass.
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        testTimeout: 10_000,
    },
});
