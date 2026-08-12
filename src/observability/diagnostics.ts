import { CoreError } from '../core/errors';

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export type BlockchainOperation =
    | 'transaction'
    | 'rpc'
    | 'quote'
    | 'payload_build'
    | 'signing'
    | 'submission'
    | 'confirmation';

export type DiagnosticStage =
    | 'started'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'pending'
    | 'timeout';

export type DiagnosticAttribute = string | number | boolean | null;
export type DiagnosticAttributes = Readonly<Record<string, DiagnosticAttribute>>;

export interface DiagnosticEvent {
    readonly schemaVersion: 1;
    readonly timestamp: string;
    readonly level: DiagnosticLevel;
    readonly operation: BlockchainOperation;
    readonly stage: DiagnosticStage;
    readonly correlationId: string;
    readonly durationMs?: number;
    readonly error?: DiagnosticFailure;
    readonly attributes: DiagnosticAttributes;
}

export interface DiagnosticFailure {
    readonly type: string;
    readonly code: string;
    readonly category: FailureCategory;
    readonly retryable: boolean;
}

export type FailureCategory =
    | 'validation'
    | 'security'
    | 'authentication'
    | 'authorization'
    | 'user_rejected'
    | 'network'
    | 'rate_limit'
    | 'timeout'
    | 'provider'
    | 'contract'
    | 'unknown';

export interface DiagnosticSink {
    emit(event: DiagnosticEvent): void;
}

export interface DiagnosticsOptions {
    readonly sink?: DiagnosticSink;
    readonly clock?: () => number;
    readonly correlationIds?: CorrelationIdSource;
}

export interface CorrelationIdSource {
    next(): string;
}

export interface OperationContext {
    readonly operation: BlockchainOperation;
    readonly correlationId: string;
    readonly startedAtMs: number;
    readonly attributes: DiagnosticAttributes;
}

const SENSITIVE_KEY = /(?:mnemonic|seed|private.?key|secret|password|passphrase|session|auth|authorization|cookie|token|signature|signed|payload|body|boc|cell|proof|keypair)/i;
const SENSITIVE_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:mnemonic|seed|private.?key|secret|password|passphrase|session)\s*[:=])/i;
const MAX_STRING_LENGTH = 160;

export class CryptoCorrelationIdSource implements CorrelationIdSource {
    public next(): string {
        const cryptoSource = globalThis.crypto;
        if (cryptoSource === undefined || typeof cryptoSource.getRandomValues !== 'function') {
            throw new Error('Secure randomness is required for diagnostic correlation IDs.');
        }
        const bytes = cryptoSource.getRandomValues(new Uint8Array(12));
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
}

export class NoopDiagnosticSink implements DiagnosticSink {
    public emit(_event: DiagnosticEvent): void {
        // Diagnostics are opt-in. Production chooses a reviewed sink explicitly.
    }
}

export class MemoryDiagnosticSink implements DiagnosticSink {
    private readonly captured: DiagnosticEvent[] = [];

    public emit(event: DiagnosticEvent): void {
        this.captured.push(event);
    }

    public events(): readonly DiagnosticEvent[] {
        return [...this.captured];
    }

    public clear(): void {
        this.captured.length = 0;
    }
}

export class BlockchainDiagnostics {
    private readonly sink: DiagnosticSink;
    private readonly clock: () => number;
    private readonly correlationIds: CorrelationIdSource;

    public constructor(options: DiagnosticsOptions = {}) {
        this.sink = options.sink ?? new NoopDiagnosticSink();
        this.clock = options.clock ?? Date.now;
        this.correlationIds = options.correlationIds ?? new CryptoCorrelationIdSource();
    }

    public start(
        operation: BlockchainOperation,
        attributes: Record<string, unknown> = {},
        correlationId = this.correlationIds.next(),
    ): OperationContext {
        const startedAtMs = this.clock();
        const sanitized = sanitizeAttributes(attributes);
        this.emit({
            level: 'info',
            operation,
            stage: 'started',
            correlationId,
            attributes: sanitized,
            nowMs: startedAtMs,
        });
        return { operation, correlationId, startedAtMs, attributes: sanitized };
    }

    public pending(context: OperationContext, attributes: Record<string, unknown> = {}): void {
        this.emitFromContext(context, 'info', 'pending', attributes);
    }

    public succeed(context: OperationContext, attributes: Record<string, unknown> = {}): void {
        this.emitFromContext(context, 'info', 'succeeded', attributes);
    }

    public cancel(context: OperationContext, attributes: Record<string, unknown> = {}): void {
        this.emitFromContext(context, 'warn', 'cancelled', attributes);
    }

    public timeout(context: OperationContext, error?: unknown, attributes: Record<string, unknown> = {}): void {
        this.emitFromContext(context, 'warn', 'timeout', attributes, error);
    }

    public fail(context: OperationContext, error: unknown, attributes: Record<string, unknown> = {}): void {
        this.emitFromContext(context, 'error', 'failed', attributes, error);
    }

    public async measure<T>(
        operation: BlockchainOperation,
        attributes: Record<string, unknown>,
        work: (context: OperationContext) => Promise<T>,
    ): Promise<T> {
        const context = this.start(operation, attributes);
        try {
            const result = await work(context);
            this.succeed(context);
            return result;
        } catch (error) {
            this.fail(context, error);
            throw error;
        }
    }

    private emitFromContext(
        context: OperationContext,
        level: DiagnosticLevel,
        stage: DiagnosticStage,
        attributes: Record<string, unknown>,
        error?: unknown,
    ): void {
        const nowMs = this.clock();
        this.emit({
            level,
            operation: context.operation,
            stage,
            correlationId: context.correlationId,
            durationMs: Math.max(0, nowMs - context.startedAtMs),
            attributes: { ...context.attributes, ...sanitizeAttributes(attributes) },
            ...(error === undefined ? {} : { error: normalizeFailure(error) }),
            nowMs,
        });
    }

    private emit(input: {
        readonly level: DiagnosticLevel;
        readonly operation: BlockchainOperation;
        readonly stage: DiagnosticStage;
        readonly correlationId: string;
        readonly durationMs?: number;
        readonly error?: DiagnosticFailure;
        readonly attributes: DiagnosticAttributes;
        readonly nowMs: number;
    }): void {
        const event: DiagnosticEvent = {
            schemaVersion: 1,
            timestamp: new Date(input.nowMs).toISOString(),
            level: input.level,
            operation: input.operation,
            stage: input.stage,
            correlationId: input.correlationId,
            ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
            ...(input.error === undefined ? {} : { error: input.error }),
            attributes: input.attributes,
        };
        this.sink.emit(Object.freeze(event));
    }
}

export function sanitizeAttributes(input: Readonly<Record<string, unknown>>): DiagnosticAttributes {
    const safe: Record<string, DiagnosticAttribute> = {};
    for (const [key, value] of Object.entries(input)) {
        if (SENSITIVE_KEY.test(key)) {
            continue;
        }
        const sanitized = sanitizeAttributeValue(value);
        if (sanitized !== undefined) {
            safe[key] = sanitized;
        }
    }
    return Object.freeze(safe);
}

function sanitizeAttributeValue(value: unknown): DiagnosticAttribute | undefined {
    if (value === null || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value !== 'string') {
        // Nested objects and arrays are deliberately refused. A recursive generic
        // serializer is too easy to use on vendor responses or key material.
        return undefined;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || SENSITIVE_VALUE.test(trimmed)) {
        return undefined;
    }
    return trimmed.length <= MAX_STRING_LENGTH ? trimmed : `${trimmed.slice(0, MAX_STRING_LENGTH)}…`;
}

export function normalizeFailure(error: unknown): DiagnosticFailure {
    if (isStructuredError(error)) {
        return {
            type: safeErrorType(error),
            code: error.code,
            category: categoryFromCode(error.code),
            retryable: 'retryable' in error && error.retryable === true,
        };
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
        return { type: 'AbortError', code: 'ABORTED', category: 'timeout', retryable: true };
    }
    if (error instanceof Error) {
        return {
            type: safeErrorType(error),
            code: codeFromErrorName(error.name),
            category: categoryFromError(error),
            retryable: isRetryableError(error),
        };
    }
    return { type: 'UnknownError', code: 'UNKNOWN', category: 'unknown', retryable: false };
}

function isStructuredError(error: unknown): error is Error & { readonly code: string; readonly retryable?: boolean } {
    return (error instanceof CoreError || error instanceof Error) &&
        'code' in error &&
        typeof error.code === 'string' &&
        !SENSITIVE_VALUE.test(error.code);
}

function safeErrorType(error: Error): string {
    const name = error.name.trim();
    return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'Error';
}

function codeFromErrorName(name: string): string {
    const normalized = name.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    return normalized.length === 0 ? 'ERROR' : normalized.slice(0, 64);
}

function categoryFromCode(code: string): FailureCategory {
    const upper = code.toUpperCase();
    if (upper.includes('REJECT')) return 'user_rejected';
    if (upper.includes('AUTH')) return 'authentication';
    if (upper.includes('UNTRUSTED') || upper.includes('MALFORMED')) return 'security';
    if (upper.includes('INVALID') || upper.includes('INSUFFICIENT')) return 'validation';
    if (upper.includes('TIMEOUT') || upper.includes('EXPIRED')) return 'timeout';
    if (upper.includes('RATE')) return 'rate_limit';
    if (upper.includes('RPC') || upper.includes('NETWORK')) return 'network';
    if (upper.includes('REVERT') || upper.includes('CONTRACT')) return 'contract';
    if (upper.includes('PROVIDER') || upper.includes('QUOTE')) return 'provider';
    return 'unknown';
}

function categoryFromError(error: Error): FailureCategory {
    const name = error.name.toLowerCase();
    if (name.includes('timeout') || name.includes('abort')) return 'timeout';
    if (name.includes('network') || name.includes('fetch')) return 'network';
    return 'unknown';
}

function isRetryableError(error: Error): boolean {
    const category = categoryFromError(error);
    return category === 'network' || category === 'timeout' || category === 'rate_limit';
}
