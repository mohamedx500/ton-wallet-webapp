import { WalletExecutionError } from './errors';
import type {
    ConfirmationOptions,
    SubmissionReference,
    TransactionConfirmation,
    TransactionConfirmer,
} from './types';
import type { NetworkId } from '../core/chain';

/**
 * Delegates confirmation to the standard or Highload V3 confirmer based on the
 * persisted submission reference. Recovery flows may resume either wallet kind.
 */
export class RoutingTransactionConfirmer implements TransactionConfirmer {
    public readonly network: NetworkId;
    private readonly standard: TransactionConfirmer;
    private readonly highload: TransactionConfirmer;

    public constructor(standard: TransactionConfirmer, highload: TransactionConfirmer) {
        if (standard.network !== highload.network) {
            throw new WalletExecutionError(
                'UNSUPPORTED_WALLET',
                'Standard and Highload confirmers must be bound to the same network.',
            );
        }
        this.network = standard.network;
        this.standard = standard;
        this.highload = highload;
    }

    public confirm(
        reference: SubmissionReference,
        options: ConfirmationOptions = {},
    ): Promise<TransactionConfirmation> {
        if (reference.walletVersion === 'highload-v3') {
            return this.highload.confirm(reference, options);
        }
        return this.standard.confirm(reference, options);
    }
}
