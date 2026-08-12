import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

import { WalletProvider } from './context/WalletContext';
import { NetworkProvider } from './context/NetworkContext';
import { MultiSendProvider } from './context/MultiSendContext';
import { ToastProvider } from './components/Toast';
import { StrictSwapProvider } from './StrictSwapProvider';
import { initDevToolsGuard } from './utils/devtoolsGuard';

// Activate production DevTools protections (no-op in dev mode)
initDevToolsGuard();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <NetworkProvider>
            <WalletProvider>
                <StrictSwapProvider>
                    <MultiSendProvider>
                        <ToastProvider>
                            <App />
                        </ToastProvider>
                    </MultiSendProvider>
                </StrictSwapProvider>
            </WalletProvider>
        </NetworkProvider>
    </React.StrictMode>,
);
