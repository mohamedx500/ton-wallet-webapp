import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

import { WalletProvider } from './context/WalletContext';
import { NetworkProvider } from './context/NetworkContext';
import { MultiSendProvider } from './context/MultiSendContext';
import { initDevToolsGuard } from './utils/devtoolsGuard';

// Activate production DevTools protections (no-op in dev mode)
initDevToolsGuard();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <NetworkProvider>
            <WalletProvider>
                <MultiSendProvider>
                    <App />
                </MultiSendProvider>
            </WalletProvider>
        </NetworkProvider>
    </React.StrictMode>,
);
