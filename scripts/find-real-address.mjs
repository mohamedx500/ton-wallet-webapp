#!/usr/bin/env node
import { mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto';
import { WalletContractV3R1, WalletContractV3R2, WalletContractV4, WalletContractV5R1 } from '@ton/ton';

const DEFAULT_SUBWALLET_ID = 698983191;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

function normalizeMnemonic(input) {
  return input
    .trim()
    .split(/\s+/)
    .map((w) =>
      w
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim()
    )
    .filter(Boolean);
}

function short(address) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function toAddress(version, publicKey, walletId) {
  switch (version) {
    case 'v3r1':
      return WalletContractV3R1.create({ publicKey, workchain: 0, walletId }).address;
    case 'v3r2':
      return WalletContractV3R2.create({ publicKey, workchain: 0, walletId }).address;
    case 'v4r2':
      return WalletContractV4.create({ publicKey, workchain: 0, walletId }).address;
    case 'v5r1':
      return WalletContractV5R1.create({ publicKey, workchain: 0, walletId }).address;
    default:
      throw new Error(`Unsupported version: ${version}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const max = Number(args.max ?? 200);
  const prefix = (args.prefix ?? '').trim();
  const suffix = (args.suffix ?? '').trim();
  const passphrase = String(args.passphrase ?? process.env.MNEMONIC_PASSPHRASE ?? '');
  const mnemonicInput = args.mnemonic ?? process.env.MNEMONIC ?? '';

  if (!mnemonicInput) {
    console.error('Missing mnemonic. Use --mnemonic "..." or MNEMONIC env var.');
    process.exit(1);
  }

  const mnemonic = normalizeMnemonic(mnemonicInput);
  if (mnemonic.length !== 24) {
    console.error(`Invalid mnemonic word count: ${mnemonic.length} (expected 24)`);
    process.exit(1);
  }

  const isValid = await mnemonicValidate(mnemonic);
  if (!isValid) {
    console.warn('Warning: mnemonic checksum is invalid. Continuing derivation anyway.');
  }

  const { publicKey } = await mnemonicToPrivateKey(mnemonic, passphrase);

  const walletIds = new Set([DEFAULT_SUBWALLET_ID, 0]);
  for (let i = 0; i <= max; i++) {
    walletIds.add(i);
    walletIds.add(DEFAULT_SUBWALLET_ID + i);
    if (DEFAULT_SUBWALLET_ID - i >= 0) {
      walletIds.add(DEFAULT_SUBWALLET_ID - i);
    }
  }

  const versions = ['v3r1', 'v3r2', 'v4r2', 'v5r1'];
  const rows = [];

  for (const version of versions) {
    for (const walletId of walletIds) {
      try {
        const addr = toAddress(version, publicKey, walletId).toString({
          bounceable: false,
          testOnly: false,
        });

        const matchesPrefix = !prefix || addr.startsWith(prefix);
        const matchesSuffix = !suffix || addr.endsWith(suffix);

        if (matchesPrefix && matchesSuffix) {
          rows.push({ version, walletId, address: addr, short: short(addr) });
        }
      } catch {
        // ignore unsupported configs
      }
    }
  }

  console.log('Search filters:', {
    prefix: prefix || '(none)',
    suffix: suffix || '(none)',
    passphrase: passphrase ? '(provided)' : '(empty)',
    scannedPerVersion: walletIds.size,
  });

  if (rows.length === 0) {
    console.log('No matches found. Increase --max or provide different prefix/suffix.');
    process.exit(2);
  }

  rows.sort((a, b) => {
    if (a.version !== b.version) return a.version.localeCompare(b.version);
    return a.walletId - b.walletId;
  });

  console.table(rows.map((r) => ({
    version: r.version,
    walletId: r.walletId,
    short: r.short,
    address: r.address,
  })));

  console.log('Top candidate:', rows[0]);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
