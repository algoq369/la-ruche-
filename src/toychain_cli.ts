import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Blockchain } from './toychain/blockchain.js';
import { Transaction } from './toychain/transaction.js';
import { generateKeyPair, deriveAddress } from './toychain/crypto.js';
import { merkleProof, verifyMerkleProof } from './toychain/merkle.js';
import WebSocket from 'ws';

function usage() {
  console.log(`ToyChain CLI

Commands:
  genkey [file]                 Generate a keypair JSON (default: wallet.json)
  address <pubkey_pem_file>     Print derived address from a PEM public key file
  add-tx --to <addr> --amount <n> --wallet <wallet.json>
                                Create and add a signed tx from your wallet address
                                Options: --fee <n> (default 1), --peers <ws1,ws2>
  mine --miner <addr>           Mine pending transactions, reward to <addr>
                                Options: --peers <ws1,ws2>
  balance --address <addr>      Show balance for address
  validate                      Check chain validity
  print-chain                   Pretty-print blocks and txs summary
  proof --block <i> --tx <j>    Output Merkle proof for tx j in block i and verify it

Options:
  --data <file>                 Chain state file (default: toychain.data.json)
`);
}

interface Args { [k: string]: string | boolean | undefined; }

function parseArgs(argv: string[]): { cmd: string | undefined; args: Args } {
  const [,, cmd, ...rest] = argv;
  const args: Args = {};
  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (a?.startsWith('--')) {
      const key = a.slice(2);
      const val = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : 'true';
      args[key] = val;
      i += val === 'true' ? 1 : 2;
    } else {
      // positional appended as _N
      const idx = Object.keys(args).filter((k) => k.startsWith('_')).length;
      args[`_${idx}`] = a;
      i++;
    }
  }
  return { cmd, args };
}

function getDataPath(args: Args): string {
  return resolve(process.cwd(), (args['data'] as string) || 'toychain.data.json');
}

function peersFromArgs(args: Args): string[] {
  const csv = (args['peers'] as string) || '';
  return csv ? csv.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

async function broadcast(peers: string[], message: unknown) {
  await Promise.all(peers.map((url) => new Promise<void>((res) => {
    try {
      const ws = new WebSocket(url);
      ws.on('open', () => {
        ws.send(JSON.stringify(message));
        ws.close();
        res();
      });
      ws.on('error', () => res());
    } catch {
      res();
    }
  })));
}

async function main() {
  const { cmd, args } = parseArgs(process.argv);
  const dataPath = getDataPath(args);

  switch (cmd) {
    case 'genkey': {
      const out = (args['_0'] as string) || 'wallet.json';
      const kp = generateKeyPair();
      writeFileSync(out, JSON.stringify(kp, null, 2));
      console.log('Wrote', out);
      console.log('Address:', kp.address);
      break;
    }
    case 'address': {
      const pubPath = args['_0'] as string;
      if (!pubPath) return usage();
      const pem = readFileSync(pubPath, 'utf8');
      console.log(deriveAddress(pem));
      break;
    }
    case 'add-tx': {
      const to = (args['to'] as string) || '';
      const amount = Number(args['amount'] || '0');
      const walletFile = (args['wallet'] as string) || 'wallet.json';
      const fee = Number(args['fee'] || '1');
      if (!to || !amount || amount <= 0) {
        console.error('Usage: add-tx --to <addr> --amount <n> --wallet <wallet.json> [--fee <n>] [--peers <ws1,ws2>]');
        process.exit(1);
      }
      if (!existsSync(walletFile)) {
        console.error('Wallet file not found:', walletFile);
        process.exit(1);
      }
      const wallet = JSON.parse(readFileSync(walletFile, 'utf8'));
      const fromAddr = wallet.address;
      const chain = new Blockchain(3, 50, dataPath);
      const nonce = chain.getNonce(fromAddr);
      const tx = new Transaction(fromAddr, to, amount, fee, nonce);
      tx.sign(wallet.privateKeyPem, wallet.publicKeyPem);
      chain.addTransaction(tx);
      chain.saveToDisk();
      console.log('Transaction added. Pending count:', chain.pending.length);
      const peers = peersFromArgs(args);
      if (peers.length) await broadcast(peers, { type: 'tx', tx });
      break;
    }
    case 'mine': {
      const miner = (args['miner'] as string) || '';
      if (!miner) {
        console.error('Usage: mine --miner <addr>');
        process.exit(1);
      }
      const chain = new Blockchain(3, 50, dataPath);
      if (chain.pending.length === 0) {
        console.log('No pending transactions. Mining only coinbase.');
      }
      const block = chain.minePendingTransactions(miner);
      console.log('Mined block', block.index, block.hash);
      const peers = peersFromArgs(args);
      if (peers.length) await broadcast(peers, { type: 'block', block });
      break;
    }
    case 'balance': {
      const addr = (args['address'] as string) || '';
      if (!addr) {
        console.error('Usage: balance --address <addr>');
        process.exit(1);
      }
      const chain = new Blockchain(3, 50, dataPath);
      console.log(chain.getBalanceOf(addr));
      break;
    }
    case 'validate': {
      const chain = new Blockchain(3, 50, dataPath);
      console.log('Chain valid?', chain.isValid());
      break;
    }
    case 'print-chain': {
      const chain = new Blockchain(3, 50, dataPath);
      for (const b of chain.chain) {
        console.log(`#${b.index} ${b.hash.slice(0,16)}.. prev=${b.previousHash.slice(0,8)}.. txs=${b.transactions.length} merkle=${b.merkleRoot.slice(0,16)}..`);
      }
      break;
    }
    case 'proof': {
      const bi = Number(args['block'] || '-1');
      const ti = Number(args['tx'] || '-1');
      if (bi < 0 || ti < 0) {
        console.error('Usage: proof --block <i> --tx <j>');
        process.exit(1);
      }
      const chain = new Blockchain(3, 50, dataPath);
      if (bi >= chain.chain.length) {
        console.error('Invalid block index');
        process.exit(1);
      }
      const block = chain.chain[bi];
      if (ti >= block.transactions.length) {
        console.error('Invalid tx index');
        process.exit(1);
      }
      const hashes = block.transactions.map((t) => t.hash());
      const proof = merkleProof(hashes, ti);
      const leaf = hashes[ti];
      const ok = verifyMerkleProof(leaf, proof, block.merkleRoot);
      console.log(JSON.stringify({ leaf, proof, root: block.merkleRoot, ok }, null, 2));
      break;
    }
    default:
      usage();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
