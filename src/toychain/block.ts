import { createHash } from 'crypto';
import { Transaction } from './transaction.js';

export class Block {
  index: number;
  timestamp: number;
  transactions: Transaction[];
  previousHash: string;
  nonce: number;
  hash: string;
  merkleRoot: string;

  constructor(index: number, previousHash: string, transactions: Transaction[], timestamp = Date.now()) {
    this.index = index;
    this.previousHash = previousHash;
    this.transactions = transactions;
    this.timestamp = timestamp;
    this.nonce = 0;
    this.merkleRoot = this.computeMerkleRoot();
    this.hash = this.computeHash();
  }

  computeHash(): string {
    const h = createHash('sha256');
    h.update(`${this.index}|${this.previousHash}|${this.timestamp}|${this.nonce}|${this.merkleRoot}`);
    return h.digest('hex');
  }

  computeMerkleRoot(): string {
    if (this.transactions.length === 0) return '0'.repeat(64);
    let layer = this.transactions.map((t) => t.hash());
    while (layer.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = layer[i + 1] || left; // duplicate last if odd
        const h = createHash('sha256');
        h.update(left + right);
        next.push(h.digest('hex'));
      }
      layer = next;
    }
    return layer[0];
  }

  mine(difficulty: number): void {
    const target = '0'.repeat(difficulty);
    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.computeHash();
    }
  }
}
