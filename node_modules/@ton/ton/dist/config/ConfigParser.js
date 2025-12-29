"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configParseMasterAddress = configParseMasterAddress;
exports.parseValidatorSet = parseValidatorSet;
exports.parseBridge = parseBridge;
exports.configParseMasterAddressRequired = configParseMasterAddressRequired;
exports.configParse5 = configParse5;
exports.configParse13 = configParse13;
exports.configParse15 = configParse15;
exports.configParse16 = configParse16;
exports.configParse17 = configParse17;
exports.configParse18 = configParse18;
exports.configParse8 = configParse8;
exports.configParse40 = configParse40;
exports.configParseWorkchainDescriptor = configParseWorkchainDescriptor;
exports.configParse12 = configParse12;
exports.configParseValidatorSet = configParseValidatorSet;
exports.configParseBridge = configParseBridge;
exports.configParseGasLimitsPrices = configParseGasLimitsPrices;
exports.configParseMsgPrices = configParseMsgPrices;
exports.configParse28 = configParse28;
exports.configParse29 = configParse29;
exports.parseProposalSetup = parseProposalSetup;
exports.parseVotingSetup = parseVotingSetup;
exports.loadConfigParamById = loadConfigParamById;
exports.loadConfigParamsAsSlice = loadConfigParamsAsSlice;
exports.parseFullConfig = parseFullConfig;
const core_1 = require("@ton/core");
function configParseMasterAddress(slice) {
    if (slice) {
        return new core_1.Address(-1, slice.loadBuffer(32));
    }
    else {
        return null;
    }
}
function readPublicKey(slice) {
    // 8e81278a
    if (slice.loadUint(32) !== 0x8e81278a) {
        throw Error('Invalid config');
    }
    return slice.loadBuffer(32);
}
const ValidatorDescriptionDictValue = {
    serialize(src, builder) {
        throw Error("not implemented");
    },
    parse(src) {
        const header = src.loadUint(8);
        if (header === 0x53) {
            return {
                publicKey: readPublicKey(src),
                weight: src.loadUintBig(64),
                adnlAddress: null
            };
        }
        else if (header === 0x73) {
            return {
                publicKey: readPublicKey(src),
                weight: src.loadUintBig(64),
                adnlAddress: src.loadBuffer(32)
            };
        }
        else {
            throw Error('Invalid config');
        }
    }
};
function parseValidatorSet(slice) {
    const header = slice.loadUint(8);
    if (header === 0x11) {
        const timeSince = slice.loadUint(32);
        const timeUntil = slice.loadUint(32);
        const total = slice.loadUint(16);
        const main = slice.loadUint(16);
        const list = slice.loadDictDirect(core_1.Dictionary.Keys.Uint(16), ValidatorDescriptionDictValue);
        return {
            timeSince,
            timeUntil,
            total,
            main,
            totalWeight: null,
            list
        };
    }
    else if (header === 0x12) {
        const timeSince = slice.loadUint(32);
        const timeUntil = slice.loadUint(32);
        const total = slice.loadUint(16);
        const main = slice.loadUint(16);
        const totalWeight = slice.loadUintBig(64);
        const list = slice.loadDict(core_1.Dictionary.Keys.Uint(16), ValidatorDescriptionDictValue);
        return {
            timeSince,
            timeUntil,
            total,
            main,
            totalWeight,
            list
        };
    }
}
function parseBridge(slice) {
    const bridgeAddress = new core_1.Address(-1, slice.loadBuffer(32));
    const oracleMultisigAddress = new core_1.Address(-1, slice.loadBuffer(32));
    const oraclesDict = slice.loadDict(core_1.Dictionary.Keys.Buffer(32), core_1.Dictionary.Values.Buffer(32));
    const oracles = new Map();
    for (const [local, remote] of oraclesDict) {
        oracles.set(new core_1.Address(-1, local).toString(), remote);
    }
    const externalChainAddress = slice.loadBuffer(32);
    return {
        bridgeAddress,
        oracleMultisigAddress,
        oracles,
        externalChainAddress
    };
}
function configParseMasterAddressRequired(slice) {
    if (!slice) {
        throw Error('Invalid config');
    }
    return configParseMasterAddress(slice);
}
function configParse5(slice) {
    if (!slice) {
        throw Error('Invalid config');
    }
    const magic = slice.loadUint(8);
    if (magic === 0x01) {
        const blackholeAddr = slice.loadBit() ? new core_1.Address(-1, slice.loadBuffer(32)) : null;
        const feeBurnNominator = slice.loadUint(32);
        const feeBurnDenominator = slice.loadUint(32);
        return {
            blackholeAddr,
            feeBurnNominator,
            feeBurnDenominator
        };
    }
    throw new Error('Invalid config');
}
function configParse13(slice) {
    if (!slice) {
        throw Error('Invalid config');
    }
    const magic = slice.loadUint(8);
    if (magic === 0x1a) {
        const deposit = slice.loadCoins();
        const bitPrice = slice.loadCoins();
        const cellPrice = slice.loadCoins();
        return {
            deposit,
            bitPrice,
            cellPrice
        };
    }
    throw new Error('Invalid config');
}
function configParse15(slice) {
    if (!slice) {
        throw Error('Invalid config');
    }
    const validatorsElectedFor = slice.loadUint(32);
    const electorsStartBefore = slice.loadUint(32);
    const electorsEndBefore = slice.loadUint(32);
    const stakeHeldFor = slice.loadUint(32);
    return {
        validatorsElectedFor,
        electorsStartBefore,
        electorsEndBefore,
        stakeHeldFor
    };
}
function configParse16(slice) {
    if (!slice) {
        throw Error('Invalid config');
    }
    const maxValidators = slice.loadUint(16);
    const maxMainValidators = slice.loadUint(16);
    const minValidators = slice.loadUint(16);
    return {
        maxValidators,
        maxMainValidators,
        minValidators
    };
}
function configParse17(slice) {
    if (!slice) {
        throw Error('Invalid config');
    }
    const minStake = slice.loadCoins();
    const maxStake = slice.loadCoins();
    const minTotalStake = slice.loadCoins();
    const maxStakeFactor = slice.loadUint(32);
    return {
        minStake,
        maxStake,
        minTotalStake,
        maxStakeFactor
    };
}
const StoragePricesDictValue = {
    serialize(src, builder) {
        throw Error("not implemented");
    },
    parse(src) {
        const header = src.loadUint(8);
        if (header !== 0xcc) {
            throw Error('Invalid config');
        }
        const utime_since = src.loadUint(32);
        const bit_price_ps = src.loadUintBig(64);
        const cell_price_ps = src.loadUintBig(64);
        const mc_bit_price_ps = src.loadUintBig(64);
        const mc_cell_price_ps = src.loadUintBig(64);
        return {
            utime_since,
            bit_price_ps,
            cell_price_ps,
            mc_bit_price_ps,
            mc_cell_price_ps
        };
    }
};
function configParse18(slice) {
    if (!slice) {
        throw Error('Invalid config');
    }
    return slice.loadDictDirect(core_1.Dictionary.Keys.Buffer(4), StoragePricesDictValue).values();
}
function configParse8(slice) {
    if (!slice) {
        return {
            version: 0,
            capabilities: 0n
        };
    }
    const version = slice.loadUint(32);
    const capabilities = slice.loadUintBig(64);
    return {
        version,
        capabilities
    };
}
function configParse40(slice) {
    if (!slice) {
        return null;
    }
    const header = slice.loadUint(8);
    if (header !== 1) {
        throw Error('Invalid config');
    }
    const defaultFlatFine = slice.loadCoins();
    const defaultProportionaFine = slice.loadCoins();
    const severityFlatMult = slice.loadUint(16);
    const severityProportionalMult = slice.loadUint(16);
    const unfunishableInterval = slice.loadUint(16);
    const longInterval = slice.loadUint(16);
    const longFlatMult = slice.loadUint(16);
    const longProportionalMult = slice.loadUint(16);
    const mediumInterval = slice.loadUint(16);
    const mediumFlatMult = slice.loadUint(16);
    const mediumProportionalMult = slice.loadUint(16);
    return {
        defaultFlatFine,
        defaultProportionaFine,
        severityFlatMult,
        severityProportionalMult,
        unfunishableInterval,
        longInterval,
        longFlatMult,
        longProportionalMult,
        mediumInterval,
        mediumFlatMult,
        mediumProportionalMult
    };
}
function configParseWorkchainDescriptor(slice) {
    const constructorTag = slice.loadUint(8);
    if (!(constructorTag == 0xA6 || constructorTag == 0xA7)) {
        throw Error('Invalid config');
    }
    const enabledSince = slice.loadUint(32);
    const actialMinSplit = slice.loadUint(8);
    const min_split = slice.loadUint(8);
    const max_split = slice.loadUint(8);
    const basic = slice.loadBit();
    const active = slice.loadBit();
    const accept_msgs = slice.loadBit();
    const flags = slice.loadUint(13);
    const zerostateRootHash = slice.loadBuffer(32);
    const zerostateFileHash = slice.loadBuffer(32);
    const version = slice.loadUint(32);
    // Only basic format supported
    if (!slice.loadUint(4)) {
        throw Error('Invalid config');
    }
    const vmVersion = slice.loadInt(32);
    const vmMode = slice.loadUintBig(64);
    let extension = undefined;
    if (constructorTag == 0xA7) {
        const splitMergeTimings = parseWorkchainSplitMergeTimings(slice);
        const stateSplitDepth = slice.loadUint(8);
        if (stateSplitDepth > 63) {
            throw RangeError(`Invalid persistent_state_split_depth: ${stateSplitDepth} expected <= 63`);
        }
        extension = {
            split_merge_timings: splitMergeTimings,
            persistent_state_split_depth: stateSplitDepth
        };
    }
    return {
        enabledSince,
        actialMinSplit,
        min_split,
        max_split,
        basic,
        active,
        accept_msgs,
        flags,
        zerostateRootHash,
        zerostateFileHash,
        version,
        format: {
            vmVersion,
            vmMode
        },
        workchain_v2: extension
    };
}
function parseWorkchainSplitMergeTimings(slice) {
    if (slice.loadUint(4) !== 0) {
        throw Error(`Invalid WcSplitMergeTimings tag expected 0!`);
    }
    return {
        split_merge_delay: slice.loadUint(32),
        split_merge_interval: slice.loadUint(32),
        min_split_merge_interval: slice.loadUint(32),
        max_split_merge_delay: slice.loadUint(32)
    };
}
const WorkchainDescriptorDictValue = {
    serialize(src, builder) {
        throw Error("not implemented");
    },
    parse(src) {
        return configParseWorkchainDescriptor(src);
    }
};
function configParse12(slice) {
    if (!slice) {
        throw Error('Invalid config');
    }
    const wd = slice.loadDict(core_1.Dictionary.Keys.Uint(32), WorkchainDescriptorDictValue);
    if (wd) {
        return wd;
    }
    throw Error('No workchains exist');
}
function configParseValidatorSet(slice) {
    if (!slice) {
        return null;
    }
    return parseValidatorSet(slice);
}
function configParseBridge(slice) {
    if (!slice) {
        return null;
    }
    return parseBridge(slice);
}
function parseGasLimitsInternal(slice) {
    const tag = slice.loadUint(8);
    if (tag === 0xde) {
        const gasPrice = slice.loadUintBig(64);
        const gasLimit = slice.loadUintBig(64);
        const specialGasLimit = slice.loadUintBig(64);
        const gasCredit = slice.loadUintBig(64);
        const blockGasLimit = slice.loadUintBig(64);
        const freezeDueLimit = slice.loadUintBig(64);
        const deleteDueLimit = slice.loadUintBig(64);
        return {
            gasPrice,
            gasLimit,
            specialGasLimit,
            gasCredit,
            blockGasLimit,
            freezeDueLimit,
            deleteDueLimit
        };
    }
    else if (tag === 0xdd) {
        const gasPrice = slice.loadUintBig(64);
        const gasLimit = slice.loadUintBig(64);
        const gasCredit = slice.loadUintBig(64);
        const blockGasLimit = slice.loadUintBig(64);
        const freezeDueLimit = slice.loadUintBig(64);
        const deleteDueLimit = slice.loadUintBig(64);
        return {
            gasPrice,
            gasLimit,
            gasCredit,
            blockGasLimit,
            freezeDueLimit,
            deleteDueLimit
        };
    }
    else {
        throw Error('Invalid config');
    }
}
function configParseGasLimitsPrices(slice) {
    if (!slice) {
        throw Error('Invalid config');
    }
    const tag = slice.loadUint(8);
    if (tag === 0xd1) {
        const flatLimit = slice.loadUintBig(64);
        const flatGasPrice = slice.loadUintBig(64);
        const other = parseGasLimitsInternal(slice);
        return {
            flatLimit,
            flatGasPrice,
            other
        };
    }
    else {
        throw Error('Invalid config');
    }
}
function configParseMsgPrices(slice) {
    if (!slice) {
        throw new Error('Invalid config');
    }
    const magic = slice.loadUint(8);
    if (magic !== 0xea) {
        throw new Error('Invalid msg prices param');
    }
    return {
        lumpPrice: slice.loadUintBig(64),
        bitPrice: slice.loadUintBig(64),
        cellPrice: slice.loadUintBig(64),
        ihrPriceFactor: slice.loadUint(32),
        firstFrac: slice.loadUint(16),
        nextFrac: slice.loadUint(16)
    };
}
// catchain_config#c1 mc_catchain_lifetime:uint32 shard_catchain_lifetime:uint32 
//   shard_validators_lifetime:uint32 shard_validators_num:uint32 = CatchainConfig;
// catchain_config_new#c2 flags:(## 7) { flags = 0 } shuffle_mc_validators:Bool
//   mc_catchain_lifetime:uint32 shard_catchain_lifetime:uint32
//   shard_validators_lifetime:uint32 shard_validators_num:uint32 = CatchainConfig;
function configParse28(slice) {
    if (!slice) {
        throw new Error('Invalid config');
    }
    const magic = slice.loadUint(8);
    if (magic === 0xc1) {
        const masterCatchainLifetime = slice.loadUint(32);
        const shardCatchainLifetime = slice.loadUint(32);
        const shardValidatorsLifetime = slice.loadUint(32);
        const shardValidatorsCount = slice.loadUint(32);
        return {
            masterCatchainLifetime,
            shardCatchainLifetime,
            shardValidatorsLifetime,
            shardValidatorsCount
        };
    }
    if (magic === 0xc2) {
        const flags = slice.loadUint(7);
        const suffleMasterValidators = slice.loadBit();
        const masterCatchainLifetime = slice.loadUint(32);
        const shardCatchainLifetime = slice.loadUint(32);
        const shardValidatorsLifetime = slice.loadUint(32);
        const shardValidatorsCount = slice.loadUint(32);
        return {
            flags,
            suffleMasterValidators,
            masterCatchainLifetime,
            shardCatchainLifetime,
            shardValidatorsLifetime,
            shardValidatorsCount
        };
    }
    throw new Error('Invalid config');
}
// consensus_config#d6 round_candidates:# { round_candidates >= 1 }
//   next_candidate_delay_ms:uint32 consensus_timeout_ms:uint32
//   fast_attempts:uint32 attempt_duration:uint32 catchain_max_deps:uint32
//   max_block_bytes:uint32 max_collated_bytes:uint32 = ConsensusConfig;
// consensus_config_new#d7 flags:(## 7) { flags = 0 } new_catchain_ids:Bool
//   round_candidates:(## 8) { round_candidates >= 1 }
//   next_candidate_delay_ms:uint32 consensus_timeout_ms:uint32
//   fast_attempts:uint32 attempt_duration:uint32 catchain_max_deps:uint32
//   max_block_bytes:uint32 max_collated_bytes:uint32 = ConsensusConfig;
// consensus_config_v3#d8 flags:(## 7) { flags = 0 } new_catchain_ids:Bool
//   round_candidates:(## 8) { round_candidates >= 1 }
//   next_candidate_delay_ms:uint32 consensus_timeout_ms:uint32
//   fast_attempts:uint32 attempt_duration:uint32 catchain_max_deps:uint32
//   max_block_bytes:uint32 max_collated_bytes:uint32 
//   proto_version:uint16 = ConsensusConfig;
function configParse29(slice) {
    if (!slice) {
        throw new Error('Invalid config');
    }
    const magic = slice.loadUint(8);
    if (magic === 0xd6) {
        const roundCandidates = slice.loadUint(32);
        const nextCandidateDelay = slice.loadUint(32);
        const consensusTimeout = slice.loadUint(32);
        const fastAttempts = slice.loadUint(32);
        const attemptDuration = slice.loadUint(32);
        const catchainMaxDeps = slice.loadUint(32);
        const maxBlockBytes = slice.loadUint(32);
        const maxColaltedBytes = slice.loadUint(32);
        return {
            roundCandidates,
            nextCandidateDelay,
            consensusTimeout,
            fastAttempts,
            attemptDuration,
            catchainMaxDeps,
            maxBlockBytes,
            maxColaltedBytes
        };
    }
    else if (magic === 0xd7) {
        const flags = slice.loadUint(7);
        const newCatchainIds = slice.loadBit();
        const roundCandidates = slice.loadUint(8);
        const nextCandidateDelay = slice.loadUint(32);
        const consensusTimeout = slice.loadUint(32);
        const fastAttempts = slice.loadUint(32);
        const attemptDuration = slice.loadUint(32);
        const catchainMaxDeps = slice.loadUint(32);
        const maxBlockBytes = slice.loadUint(32);
        const maxColaltedBytes = slice.loadUint(32);
        return {
            flags,
            newCatchainIds,
            roundCandidates,
            nextCandidateDelay,
            consensusTimeout,
            fastAttempts,
            attemptDuration,
            catchainMaxDeps,
            maxBlockBytes,
            maxColaltedBytes
        };
    }
    else if (magic === 0xd8) {
        const flags = slice.loadUint(7);
        const newCatchainIds = slice.loadBit();
        const roundCandidates = slice.loadUint(8);
        const nextCandidateDelay = slice.loadUint(32);
        const consensusTimeout = slice.loadUint(32);
        const fastAttempts = slice.loadUint(32);
        const attemptDuration = slice.loadUint(32);
        const catchainMaxDeps = slice.loadUint(32);
        const maxBlockBytes = slice.loadUint(32);
        const maxColaltedBytes = slice.loadUint(32);
        const protoVersion = slice.loadUint(16);
        return {
            flags,
            newCatchainIds,
            roundCandidates,
            nextCandidateDelay,
            consensusTimeout,
            fastAttempts,
            attemptDuration,
            catchainMaxDeps,
            maxBlockBytes,
            maxColaltedBytes,
            protoVersion
        };
    }
    else if (magic === 0xd9) {
        const flags = slice.loadUint(7);
        const newCatchainIds = slice.loadBit();
        const roundCandidates = slice.loadUint(8);
        const nextCandidateDelay = slice.loadUint(32);
        const consensusTimeout = slice.loadUint(32);
        const fastAttempts = slice.loadUint(32);
        const attemptDuration = slice.loadUint(32);
        const catchainMaxDeps = slice.loadUint(32);
        const maxBlockBytes = slice.loadUint(32);
        const maxColaltedBytes = slice.loadUint(32);
        const protoVersion = slice.loadUint(16);
        const catchainMaxBlocksCoeff = slice.loadUint(32);
        return {
            flags,
            newCatchainIds,
            roundCandidates,
            nextCandidateDelay,
            consensusTimeout,
            fastAttempts,
            attemptDuration,
            catchainMaxDeps,
            maxBlockBytes,
            maxColaltedBytes,
            protoVersion,
            catchainMaxBlocksCoeff
        };
    }
    throw new Error('Invalid config');
}
// cfg_vote_cfg#36 min_tot_rounds:uint8 max_tot_rounds:uint8 min_wins:uint8 max_losses:uint8 min_store_sec:uint32 max_store_sec:uint32 bit_price:uint32 cell_price:uint32 = ConfigProposalSetup;
function parseProposalSetup(slice) {
    const magic = slice.loadUint(8);
    if (magic !== 0x36) {
        throw new Error('Invalid config');
    }
    const minTotalRounds = slice.loadUint(8);
    const maxTotalRounds = slice.loadUint(8);
    const minWins = slice.loadUint(8);
    const maxLoses = slice.loadUint(8);
    const minStoreSec = slice.loadUint(32);
    const maxStoreSec = slice.loadUint(32);
    const bitPrice = slice.loadUint(32);
    const cellPrice = slice.loadUint(32);
    return { minTotalRounds, maxTotalRounds, minWins, maxLoses, minStoreSec, maxStoreSec, bitPrice, cellPrice };
}
// cfg_vote_setup#91 normal_params:^ConfigProposalSetup critical_params:^ConfigProposalSetup = ConfigVotingSetup;
function parseVotingSetup(slice) {
    if (!slice) {
        throw new Error('Invalid config');
    }
    const magic = slice.loadUint(8);
    if (magic !== 0x91) {
        throw new Error('Invalid config');
    }
    const normalParams = parseProposalSetup(slice.loadRef().beginParse());
    const criticalParams = parseProposalSetup(slice.loadRef().beginParse());
    return { normalParams, criticalParams };
}
function loadConfigParams(configBase64) {
    const comfigMap = core_1.Cell.fromBase64(configBase64).beginParse().loadDictDirect(core_1.Dictionary.Keys.Int(32), core_1.Dictionary.Values.Cell());
    return comfigMap;
}
function loadConfigParamById(configBase64, id) {
    return loadConfigParams(configBase64).get(id);
}
function loadConfigParamsAsSlice(configBase64) {
    const pramsAsCells = loadConfigParams(configBase64);
    const params = new Map();
    for (const [key, value] of pramsAsCells) {
        params.set(key, value.beginParse());
    }
    return params;
}
function parseFullConfig(configs) {
    return {
        configAddress: configParseMasterAddressRequired(configs.get(0)),
        electorAddress: configParseMasterAddressRequired(configs.get(1)),
        minterAddress: configParseMasterAddress(configs.get(2)),
        feeCollectorAddress: configParseMasterAddress(configs.get(3)),
        dnsRootAddress: configParseMasterAddress(configs.get(4)),
        burningConfig: configParse5(configs.get(5)),
        globalVersion: configParse8(configs.get(8)),
        workchains: configParse12(configs.get(12)),
        voting: parseVotingSetup(configs.get(11)),
        validators: {
            ...configParse15(configs.get(15)),
            ...configParse16(configs.get(16)),
            ...configParse17(configs.get(17))
        },
        storagePrices: configParse18(configs.get(18)),
        gasPrices: {
            masterchain: configParseGasLimitsPrices(configs.get(20)),
            workchain: configParseGasLimitsPrices(configs.get(21)),
        },
        msgPrices: {
            masterchain: configParseMsgPrices(configs.get(24)),
            workchain: configParseMsgPrices(configs.get(25)),
        },
        validatorSets: {
            prevValidators: configParseValidatorSet(configs.get(32)),
            prevTempValidators: configParseValidatorSet(configs.get(33)),
            currentValidators: configParseValidatorSet(configs.get(34)),
            currentTempValidators: configParseValidatorSet(configs.get(35)),
            nextValidators: configParseValidatorSet(configs.get(36)),
            nextTempValidators: configParseValidatorSet(configs.get(37))
        },
        validatorsPunish: configParse40(configs.get(40)),
        bridges: {
            ethereum: configParseBridge(configs.get(71)),
            binance: configParseBridge(configs.get(72)),
            polygon: configParseBridge(configs.get(73))
        },
        catchain: configParse28(configs.get(28)),
        consensus: configParse29(configs.get(29))
        // TODO: mint_new_price:Grams mint_add_price:Grams = ConfigParam 6;
        // TODO: to_mint:ExtraCurrencyCollection = ConfigParam 7
        // TODO: mandatory_params:(Hashmap 32 True) = ConfigParam 9
        // TODO: critical_params:(Hashmap 32 True) = ConfigParam 10
        // TODO: BlockCreateFees = ConfigParam 14
    };
}
