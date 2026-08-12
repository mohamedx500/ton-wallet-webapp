/**
 * TEP-74 jetton reads
 * ============================================================================
 *
 * On-chain reads for the jetton standard. Deliberately reads from the chain
 * rather than an indexer: a balance check that gates a transfer must not be
 * satisfied by a cached or third-party number.
 *
 * TEP-74 defines these get methods:
 *
 *   jetton master  get_wallet_address(slice owner)   → slice wallet
 *   jetton wallet  get_wallet_data()                 → (int balance,
 *                                                       slice owner,
 *                                                       slice jetton_master,
 *                                                       cell wallet_code)
 *
 * @see https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md
 */

import { Address, beginCell } from '@ton/core';

import { isSameAddress } from './address';
import type { ChainAccess } from './chain';
import { CoreError } from './errors';

/** A jetton wallet did not match the owner/master it was resolved for. */
export class JettonWalletMismatchError extends CoreError {
    public constructor(details: Record<string, string>) {
        super(
            'JETTON_WALLET_MISMATCH',
            'The jetton wallet on chain does not belong to the expected owner and token.',
            details,
        );
    }
}

/** Result of reading a jetton wallet's state. */
export interface JettonWalletData {
    /** Balance in indivisible units (apply the token's decimals to display). */
    readonly balance: bigint;
    /** Account that controls the wallet. */
    readonly owner: Address;
    /** Jetton master (minter) this wallet belongs to. */
    readonly master: Address;
}

/**
 * Derive the address of `owner`'s jetton wallet for `master`.
 *
 * The address is computed *by the master contract*, not guessed locally, so it
 * is correct for non-standard jetton implementations too (custom wallet code,
 * governance jettons like USDT on TON, etc.).
 */
export async function getJettonWalletAddress(
    chain: ChainAccess,
    master: Address,
    owner: Address,
): Promise<Address> {
    const { stack } = await chain.runGetMethod(master, 'get_wallet_address', [
        { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
    ]);
    return stack.readAddress();
}

/**
 * Read a jetton wallet's state.
 *
 * @param expect When supplied, the owner and master returned by the contract are
 *        verified against these. A mismatch means the address being read is not
 *        the wallet it was believed to be — treated as an error rather than
 *        reporting a balance that belongs to somebody else.
 */
export async function getJettonWalletData(
    chain: ChainAccess,
    wallet: Address,
    expect?: { readonly owner?: Address; readonly master?: Address },
): Promise<JettonWalletData> {
    const { stack } = await chain.runGetMethod(wallet, 'get_wallet_data');
    const balance = stack.readBigNumber();
    const owner = stack.readAddress();
    const master = stack.readAddress();

    if (expect?.owner !== undefined && !isSameAddress(owner, expect.owner)) {
        throw new JettonWalletMismatchError({
            wallet: wallet.toString(),
            expectedOwner: expect.owner.toString(),
            actualOwner: owner.toString(),
        });
    }
    if (expect?.master !== undefined && !isSameAddress(master, expect.master)) {
        throw new JettonWalletMismatchError({
            wallet: wallet.toString(),
            expectedMaster: expect.master.toString(),
            actualMaster: master.toString(),
        });
    }

    return { balance, owner, master };
}

/**
 * Balance of `owner` in the jetton minted by `master`, in indivisible units.
 *
 * Returns `0n` when the jetton wallet has never been deployed — that is the
 * correct reading of "this account holds none of this token", and it is the
 * common case for a token the user has never received.
 */
export async function getJettonBalance(chain: ChainAccess, master: Address, owner: Address): Promise<bigint> {
    const wallet = await getJettonWalletAddress(chain, master, owner);
    if (!(await chain.isDeployed(wallet))) {
        return 0n;
    }
    const data = await getJettonWalletData(chain, wallet, { owner, master });
    return data.balance;
}

/**
 * Reads the balance of any asset the wallet can hold.
 *
 * Injected into the swap engine so balance checks can be faked in tests and
 * satisfied from a warm cache in the UI, without either of those choices being
 * baked into the engine.
 */
export interface BalanceReader {
    /** Native TON balance, in nanotons. */
    getNativeBalance(owner: Address): Promise<bigint>;
    /** Jetton balance in indivisible units; `0n` if the wallet is undeployed. */
    getJettonBalance(owner: Address, master: Address): Promise<bigint>;
}

/** `BalanceReader` that reads directly from the chain on every call. */
export class ChainBalanceReader implements BalanceReader {
    private readonly chain: ChainAccess;

    public constructor(chain: ChainAccess) {
        this.chain = chain;
    }

    public getNativeBalance(owner: Address): Promise<bigint> {
        return this.chain.getBalance(owner);
    }

    public getJettonBalance(owner: Address, master: Address): Promise<bigint> {
        return getJettonBalance(this.chain, master, owner);
    }
}
