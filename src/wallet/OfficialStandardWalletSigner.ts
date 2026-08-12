import { SendMode, internal } from '@ton/core';
import type { MessageRelaxed } from '@ton/core';
import { WalletContractV3R1, WalletContractV3R2, WalletContractV4, WalletContractV5R1 } from '@ton/ton';

import { parseAddress } from '../core/address';
import { WalletExecutionError } from './errors';
import type {
    ReplayProtection,
    SignedWalletEnvelope,
    StandardWalletContractVersion,
    StandardWalletDescriptor,
    WalletDescriptor,
    WalletExecutionRequest,
    WalletSigner,
} from './types';
import { assertWalletExecutionRequest } from './validation';

const WORKCHAIN = 0;
const MAINNET_GLOBAL_ID = -239;
const TESTNET_GLOBAL_ID = -3;
const DEFAULT_STANDARD_WALLET_ID = 698983191;
const DEFAULT_V5_SUBWALLET_NUMBER = 0;
const STANDARD_SEND_MODE = SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS;

export interface StandardWalletSigningAuthority {
    readonly publicKey: Buffer;
    sign(message: import('@ton/core').Cell): Promise<Buffer>;
}

export interface OfficialStandardWalletSignerOptions {
    readonly authority: StandardWalletSigningAuthority;
    /** Injected Unix clock in seconds. */
    readonly clock?: () => number;
}

/** Fail closed before replay acquisition when decrypted authority does not own the descriptor. */
export function assertStandardWalletAuthority(
    wallet: StandardWalletDescriptor,
    network: WalletExecutionRequest['network'],
    authority: StandardWalletSigningAuthority,
): void {
    try {
        const contract = createOfficialStandardWallet(wallet, network, authority.publicKey);
        assertDescriptorAddress(wallet, contract.address.toRawString());
    } catch (cause) {
        if (cause instanceof WalletExecutionError) throw cause;
        throw new WalletExecutionError(
            'INVALID_WALLET_REQUEST',
            'The wallet descriptor does not match the decrypted signing authority.',
            { cause },
        );
    }
}

/**
 * Standard-wallet signer backed only by official `@ton/ton` transfer builders.
 *
 * This class has no RPC client and no broadcaster. The caller must obtain a
 * verified seqno separately and pass it as replay protection. Private signing
 * authority stays behind `StandardWalletSigningAuthority`; it is never returned
 * in the signed envelope.
 */
export class OfficialStandardWalletSigner implements WalletSigner {
    private readonly authority: StandardWalletSigningAuthority;
    private readonly clock: () => number;

    public constructor(options: OfficialStandardWalletSignerOptions) {
        this.authority = options.authority;
        this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
    }

    public supports(wallet: WalletDescriptor): boolean {
        return wallet.kind === 'standard';
    }

    public async sign(
        request: WalletExecutionRequest,
        replayProtection: ReplayProtection,
    ): Promise<SignedWalletEnvelope> {
        const nowUnix = this.clock();
        assertWalletExecutionRequest(request, {
            nowUnix,
            maxFutureSeconds: Math.max(1, request.validUntilUnix - nowUnix),
        });

        if (request.wallet.kind !== 'standard') {
            throw new WalletExecutionError('UNSUPPORTED_WALLET', 'This signer supports standard wallets only.');
        }
        if (replayProtection.kind !== 'seqno') {
            throw new WalletExecutionError(
                'INVALID_WALLET_REQUEST',
                'A standard wallet requires verified seqno replay protection.',
            );
        }
        if (!Number.isSafeInteger(replayProtection.seqno) || replayProtection.seqno < 0) {
            throw new WalletExecutionError('INVALID_WALLET_REQUEST', 'The wallet seqno is invalid.');
        }

        const messages = request.messages.map((message) =>
            internal({
                to: parseAddress(message.to),
                value: message.value,
                ...(message.body === undefined ? {} : { body: message.body }),
                bounce: message.bounce,
            }),
        );

        try {
            const contract = createOfficialStandardWallet(
                request.wallet,
                request.network,
                this.authority.publicKey,
            );
            assertDescriptorAddress(request.wallet, contract.address.toRawString());

            const signedBody = await createOfficialTransfer(
                contract,
                request.wallet.version,
                messages,
                replayProtection.seqno,
                request.validUntilUnix,
                this.authority,
            );

            return Object.freeze({
                network: request.network,
                walletAddress: request.wallet.address,
                walletVersion: request.wallet.version,
                correlationId: request.correlationId,
                validUntilUnix: request.validUntilUnix,
                replayProtection,
                signedBody,
                ...(replayProtection.seqno === 0 ? { stateInit: contract.init } : {}),
            });
        } catch (cause) {
            if (cause instanceof WalletExecutionError) {
                throw cause;
            }
            throw new WalletExecutionError('SIGNING_FAILED', 'The wallet could not sign this transaction.', { cause });
        }
    }
}

type OfficialStandardWallet =
    | WalletContractV3R1
    | WalletContractV3R2
    | WalletContractV4
    | WalletContractV5R1;

function createOfficialStandardWallet(
    wallet: StandardWalletDescriptor,
    network: WalletExecutionRequest['network'],
    publicKey: Buffer,
): OfficialStandardWallet {
    switch (wallet.version) {
        case 'v3r1':
            return WalletContractV3R1.create({
                publicKey,
                workchain: WORKCHAIN,
                walletId: wallet.subwalletId ?? DEFAULT_STANDARD_WALLET_ID,
            });
        case 'v3r2':
            return WalletContractV3R2.create({
                publicKey,
                workchain: WORKCHAIN,
                walletId: wallet.subwalletId ?? DEFAULT_STANDARD_WALLET_ID,
            });
        case 'v4r2':
            return WalletContractV4.create({
                publicKey,
                workchain: WORKCHAIN,
                walletId: wallet.subwalletId ?? DEFAULT_STANDARD_WALLET_ID,
            });
        case 'v5r1':
            return WalletContractV5R1.create({
                publicKey,
                walletId: {
                    networkGlobalId: network === 'mainnet' ? MAINNET_GLOBAL_ID : TESTNET_GLOBAL_ID,
                    context: {
                        walletVersion: 'v5r1',
                        workchain: WORKCHAIN,
                        subwalletNumber: wallet.subwalletId ?? DEFAULT_V5_SUBWALLET_NUMBER,
                    },
                },
            });
    }
}

async function createOfficialTransfer(
    contract: OfficialStandardWallet,
    version: StandardWalletContractVersion,
    messages: MessageRelaxed[],
    seqno: number,
    validUntilUnix: number,
    authority: StandardWalletSigningAuthority,
) {
    const common = {
        seqno,
        timeout: validUntilUnix,
        messages,
        signer: authority.sign.bind(authority),
    } as const;

    switch (version) {
        case 'v3r1':
            if (!(contract instanceof WalletContractV3R1)) return mismatchedContract(version);
            return contract.createTransfer({ ...common, sendMode: SendMode.PAY_GAS_SEPARATELY });
        case 'v3r2':
            if (!(contract instanceof WalletContractV3R2)) return mismatchedContract(version);
            return contract.createTransfer({ ...common, sendMode: SendMode.PAY_GAS_SEPARATELY });
        case 'v4r2':
            if (!(contract instanceof WalletContractV4)) return mismatchedContract(version);
            return contract.createTransfer({ ...common, sendMode: STANDARD_SEND_MODE });
        case 'v5r1':
            if (!(contract instanceof WalletContractV5R1)) return mismatchedContract(version);
            return contract.createTransfer({
                ...common,
                authType: 'external',
                sendMode: STANDARD_SEND_MODE,
            });
    }
}

function assertDescriptorAddress(wallet: StandardWalletDescriptor, derivedRawAddress: string): void {
    if (!parseAddress(wallet.address).equals(parseAddress(derivedRawAddress))) {
        throw new WalletExecutionError(
            'INVALID_WALLET_REQUEST',
            'The wallet descriptor does not match the configured public key and wallet contract.',
        );
    }
}

function mismatchedContract(version: StandardWalletContractVersion): never {
    throw new WalletExecutionError('SIGNING_FAILED', `The official ${version} wallet builder was not selected correctly.`);
}
