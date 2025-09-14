import http, { IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, statSync, createReadStream } from 'fs';
import { resolve, join, extname } from 'path';
import { Blockchain } from '../toychain/blockchain.js';
import { Transaction } from '../toychain/transaction.js';
import { generateKeyPair } from '../toychain/crypto.js';

// Config
const PORT = Number(process.env.PORT || '8080');
const DATA = process.env.DATA || 'toychain.data.json';
const WEB_ROOT = resolve(process.cwd(), 'web/la-ruche');

const chain = new Blockchain(3, 50, DATA);

type Wallet = { privateKeyPem: string; publicKeyPem: string; address: string };

function sendJson(res: ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function notFound(res: ServerResponse) { res.writeHead(404); res.end('Not found'); }

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolveBody) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      try { resolveBody(JSON.parse(buf.toString('utf8') || '{}')); }
      catch { resolveBody({}); }
    });
  });
}

function mime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  if (!req.url) return false;
  // Serve index for root and any non-/api route
  if (req.url === '/' || (!req.url.startsWith('/api/') && !extname(req.url))) {
    const index = join(WEB_ROOT, 'index.html');
    if (existsSync(index)) {
      const body = readFileSync(index);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
      res.end(body);
      return true;
    }
    return false;
  }

  // Serve actual static files
  const path = join(WEB_ROOT, decodeURIComponent(req.url.replace(/^\//, '')));
  if (existsSync(path) && statSync(path).isFile()) {
    res.writeHead(200, { 'Content-Type': mime(path) });
    createReadStream(path).pipe(res);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return notFound(res);
    // Static
    if (!req.url.startsWith('/api/')) {
      if (serveStatic(req, res)) return; else return notFound(res);
    }

    // API
    if (req.method === 'GET' && req.url === '/api/health') {
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && req.url === '/api/genkey') {
      const wallet = generateKeyPair();
      return sendJson(res, 200, wallet);
    }
    if (req.method === 'GET' && req.url.startsWith('/api/chain')) {
      const summary = {
        height: chain.chain.length - 1,
        head: chain.latestBlock.hash,
        difficulty: chain.difficulty,
        reward: chain.miningReward,
        blocks: chain.chain.map((b) => ({
          index: b.index,
          hash: b.hash,
          prev: b.previousHash,
          ts: b.timestamp,
          txs: b.transactions.length,
          merkleRoot: b.merkleRoot,
        })).slice(-50),
        pending: chain.pending.map((t) => ({ from: t.from, to: t.to, amount: t.amount, fee: t.fee, nonce: t.nonce })),
      };
      return sendJson(res, 200, summary);
    }
    if (req.method === 'GET' && req.url.startsWith('/api/balance')) {
      const u = new URL(req.url, 'http://_');
      const address = u.searchParams.get('address') || '';
      return sendJson(res, 200, { address, balance: chain.getBalanceOf(address), nonce: chain.getNonce(address) });
    }
    if (req.method === 'POST' && req.url === '/api/add-tx') {
      const body = await readBody(req);
      const { wallet, to, amount, fee } = body as { wallet: Wallet; to: string; amount: number; fee?: number };
      if (!wallet || !to || !amount) return sendJson(res, 400, { error: 'missing fields' });
      try {
        const nonce = chain.getNonce(wallet.address);
        const tx = new Transaction(wallet.address, to, Number(amount), Number(fee ?? 1), nonce);
        tx.sign(wallet.privateKeyPem, wallet.publicKeyPem);
        chain.addTransaction(tx);
        chain.saveToDisk();
        return sendJson(res, 200, { ok: true, pending: chain.pending.length });
      } catch (e: any) {
        return sendJson(res, 400, { error: e?.message || String(e) });
      }
    }
    if (req.method === 'POST' && req.url === '/api/mine') {
      const body = await readBody(req);
      const { miner } = body as { miner: string };
      if (!miner) return sendJson(res, 400, { error: 'missing miner' });
      try {
        const block = chain.minePendingTransactions(miner);
        return sendJson(res, 200, { ok: true, index: block.index, hash: block.hash });
      } catch (e: any) {
        return sendJson(res, 400, { error: e?.message || String(e) });
      }
    }

    notFound(res);
  } catch (e: any) {
    sendJson(res, 500, { error: e?.message || String(e) });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`La Ruche server listening on http://localhost:${PORT}`);
});
