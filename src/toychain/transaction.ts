import { createHash } from 'crypto';
import { deriveAddress, signPayload, verifyPayload } from './crypto.js';

export interface TransactionData {
  from: string;
  to: string;
  amount: number;
  fee?: number;
  nonce?: number;
}

export class Transaction implements TransactionData {
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  signature?: string; // base64
  publicKeyPem?: string;

  fee: number;
  nonce: number;

  constructor(from: string, to: string, amount: number, fee = 1, nonce = 0) {
    this.from = from;
    this.to = to;
    this.amount = amount;
    this.timestamp = Date.now();
    this.fee = fee;
    this.nonce = nonce;
  }

  hash(): string {
    const h = createHash('sha256');
    h.update(this.signingPayload());
    return h.digest('hex');
  }

  signingPayload(): string {
    return `${this.from}|${this.to}|${this.amount}|${this.fee}|${this.nonce}|${this.timestamp}`;
  }

  sign(privateKeyPem: string, publicKeyPem: string): void {
    // Set from to derived address if not a coinbase tx
    if (this.from !== 'COINBASE') {
      const addr = deriveAddress(publicKeyPem);
      if (this.from && this.from !== addr) {
        throw new Error('from address does not match provided public key');
      }
      this.from = addr;
    }
    this.publicKeyPem = publicKeyPem;
    const payload = Buffer.from(this.signingPayload());
    this.signature = signPayload(privateKeyPem, payload);
  }

  isCoinbase(): boolean {
    return this.from === 'COINBASE';
  }

  verify(): boolean {
    if (this.isCoinbase()) return true;
    if (!this.signature || !this.publicKeyPem) return false;
    const expectedFrom = deriveAddress(this.publicKeyPem);
    if (expectedFrom !== this.from) return false;
    return verifyPayload(this.publicKeyPem, Buffer.from(this.signingPayload()), this.signature);
  }
}
