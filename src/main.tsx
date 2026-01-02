import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

import { WalletProvider } from './context/WalletContext';
import { NetworkProvider } from './context/NetworkContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <NetworkProvider>
            <WalletProvider>
                <App />
            </WalletProvider>
        </NetworkProvider>
    </React.StrictMode>,
);
