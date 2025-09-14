import { Block } from './block.js';
import { Transaction } from './transaction.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

export class Blockchain {
  chain: Block[];
  difficulty: number;
  miningReward: number;
  pending: Transaction[];
  storagePath: string | undefined;

  constructor(difficulty = 3, miningReward = 50, storagePath?: string) {
    this.difficulty = difficulty;
    this.miningReward = miningReward;
    this.chain = [this.createGenesisBlock()];
    this.pending = [];
    this.storagePath = storagePath;
    if (this.storagePath && existsSync(this.storagePath)) {
      this.loadFromDisk();
    }
  }

  private createGenesisBlock(): Block {
    return new Block(0, '0'.repeat(64), [], Date.UTC(2020, 0, 1));
  }

  get latestBlock(): Block {
    return this.chain[this.chain.length - 1];
  }

  addTransaction(tx: Transaction): void {
    if (tx.amount <= 0) throw new Error('amount must be positive');
    if (!tx.from || !tx.to) throw new Error('tx must include from and to');
    if (!tx.isCoinbase() && !tx.verify()) throw new Error('invalid signature');
    // balance check including pending (amount + fee)
    if (!tx.isCoinbase()) {
      const spendable = this.getBalanceOf(tx.from) - this.pending
        .filter((p) => p.from === tx.from)
        .reduce((s, p) => s + p.amount + (p.fee || 0), 0);
      if (spendable < tx.amount + (tx.fee || 0)) throw new Error('insufficient balance');
      // Nonce must equal next expected
      const expected = this.getNonce(tx.from);
      if (tx.nonce !== expected) throw new Error(`invalid nonce: expected ${expected}, got ${tx.nonce}`);
    }
    this.pending.push(tx);
  }

  minePendingTransactions(minerAddress: string): Block {
    // include a coinbase tx paying the miner the reward
    const totalFees = this.pending.filter((t) => !t.isCoinbase()).reduce((s, t) => s + (t.fee || 0), 0);
    const rewardTx = new Transaction('COINBASE', minerAddress, this.miningReward + totalFees);
    const blockTxs = [...this.pending, rewardTx];

    const block = new Block(this.latestBlock.index + 1, this.latestBlock.hash, blockTxs);
    block.mine(this.difficulty);

    this.chain.push(block);
    this.pending = [];
    this.saveToDisk();
    return block;
  }

  getBalanceOf(address: string): number {
    let balance = 0;
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.from === address) balance -= tx.amount + (tx.fee || 0);
        if (tx.to === address) balance += tx.amount;
      }
    }
    return balance;
  }

  getNonce(address: string): number {
    let n = 0;
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (!tx.isCoinbase() && tx.from === address) {
          if (tx.nonce === n) n++;
          // if history has gaps or reordering, count positionally
          else n++;
        }
      }
    }
    for (const tx of this.pending) {
      if (!tx.isCoinbase() && tx.from === address) {
        if (tx.nonce === n) n++;
        else n++;
      }
    }
    return n;
  }

  isValid(): boolean {
    // Track nonces and balances as we walk
    const nonces = new Map<string, number>();
    for (let i = 1; i < this.chain.length; i++) {
      const prev = this.chain[i - 1];
      const curr = this.chain[i];

      if (curr.previousHash !== prev.hash) return false;
      if (curr.merkleRoot !== curr.computeMerkleRoot()) return false;
      if (curr.hash !== curr.computeHash()) return false;
      if (!curr.hash.startsWith('0'.repeat(this.difficulty))) return false;
      // verify tx signatures
      for (const tx of curr.transactions) {
        if (!tx.isCoinbase()) {
          if (!tx.verify()) return false;
          const expected = nonces.get(tx.from) ?? this._historicalNonceBeforeBlock(tx.from, i);
          if (tx.nonce !== expected) return false;
          nonces.set(tx.from, expected + 1);
        }
      }
    }
    return true;
  }

  private _historicalNonceBeforeBlock(address: string, blockIndex: number): number {
    let n = 0;
    for (let i = 1; i < blockIndex; i++) {
      const b = this.chain[i];
      for (const tx of b.transactions) {
        if (!tx.isCoinbase() && tx.from === address) n++;
      }
    }
    return n;
  }

  saveToDisk(): void {
    if (!this.storagePath) return;
    const data = JSON.stringify({
      difficulty: this.difficulty,
      miningReward: this.miningReward,
      chain: this.chain.map((b) => ({
        index: b.index,
        timestamp: b.timestamp,
        previousHash: b.previousHash,
        nonce: b.nonce,
        hash: b.hash,
        merkleRoot: b.merkleRoot,
        transactions: b.transactions.map((t) => ({
          from: t.from,
          to: t.to,
          amount: t.amount,
          timestamp: t.timestamp,
          signature: t.signature,
          publicKeyPem: t.publicKeyPem,
        })),
      })),
      pending: this.pending.map((t) => ({
        from: t.from,
        to: t.to,
        amount: t.amount,
        timestamp: t.timestamp,
        signature: t.signature,
        publicKeyPem: t.publicKeyPem,
      })),
    }, null, 2);
    writeFileSync(this.storagePath, data);
  }

  loadFromDisk(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) return;
    const raw = readFileSync(this.storagePath, 'utf8');
    const obj = JSON.parse(raw);
    this.difficulty = obj.difficulty ?? this.difficulty;
    this.miningReward = obj.miningReward ?? this.miningReward;
    this.chain = obj.chain.map((b: any) => {
      const txs = b.transactions.map((t: any) => {
        const tx = new Transaction(t.from, t.to, t.amount);
        tx.timestamp = t.timestamp;
        tx.signature = t.signature;
        tx.publicKeyPem = t.publicKeyPem;
        return tx;
      });
      const block = new Block(b.index, b.previousHash, txs, b.timestamp);
      block.nonce = b.nonce;
      block.merkleRoot = b.merkleRoot;
      block.hash = b.hash;
      return block;
    });
    this.pending = obj.pending.map((t: any) => {
      const tx = new Transaction(t.from, t.to, t.amount);
      tx.timestamp = t.timestamp;
      tx.signature = t.signature;
      tx.publicKeyPem = t.publicKeyPem;
      return tx;
    });
  }
}
