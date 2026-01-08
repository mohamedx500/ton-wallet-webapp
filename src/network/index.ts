/**
 * Network Module Exports
 */

export { RpcClient, RPC_ENDPOINTS, createRpcClient } from './RpcClient';
export type { RpcClientConfig, RpcProvider } from './RpcClient';

export { TonApiClient, createTonApiClient } from './TonApiClient';

// Resilient RPC Client with circuit breaker and failover
export {
    ResilientRpcClient,
    createResilientRpcClient,
    getResilientRpcClient,
} from './ResilientRpcClient';
export type {
    EndpointHealth,
    CircuitBreakerConfig,
    ResilientRpcConfig,
    RequestOptions,
    RpcMetrics,
} from './ResilientRpcClient';
