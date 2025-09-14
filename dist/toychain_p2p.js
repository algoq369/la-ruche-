import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { Blockchain } from './toychain/blockchain.js';
import { Transaction } from './toychain/transaction.js';
function log(...a) { console.log('[p2p]', ...a); }
const PORT = Number(process.env.PORT || '9000');
const PEERS = (process.env.PEERS || '').split(',').map(s => s.trim()).filter(Boolean);
const DATA = process.env.DATA || 'toychain.data.json';
const chain = new Blockchain(3, 50, DATA);
const wss = new WebSocketServer({ port: PORT });
wss.on('listening', () => log('listening on', PORT));
wss.on('connection', (ws) => {
    log('peer connected');
    const hello = { type: 'hello', height: chain.chain.length - 1, head: chain.latestBlock.hash };
    ws.send(JSON.stringify(hello));
    ws.on('message', (raw) => handleMessage(ws, raw.toString()));
});
const sockets = [];
function connectToPeer(url) {
    const ws = new WebSocket(url);
    ws.on('open', () => {
        log('connected to', url);
        sockets.push(ws);
        ws.send(JSON.stringify({ type: 'hello', height: chain.chain.length - 1, head: chain.latestBlock.hash }));
    });
    ws.on('message', (raw) => handleMessage(ws, raw.toString()));
    ws.on('error', () => { });
}
function broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const ws of wss.clients)
        ws.send(payload);
    for (const ws of sockets)
        ws.send(payload);
}
function handleMessage(ws, raw) {
    try {
        const msg = JSON.parse(raw);
        if (msg.type === 'tx') {
            const tx = Object.assign(new Transaction(msg.tx.from, msg.tx.to, msg.tx.amount, msg.tx.fee, msg.tx.nonce), msg.tx);
            try {
                chain.addTransaction(tx);
                chain.saveToDisk();
                log('added tx from peer');
                broadcast({ type: 'tx', tx });
            }
            catch (e) {
                log('tx rejected:', e.message);
            }
        }
        else if (msg.type === 'block') {
            const b = msg.block;
            // very naive: accept if previous matches and valid
            const tip = chain.latestBlock;
            if (b.previousHash === tip.hash) {
                const txs = b.transactions.map((t) => Object.assign(new Transaction(t.from, t.to, t.amount, t.fee, t.nonce), t));
                const block = { ...b, transactions: txs };
                // reconstruct block instance
                const newBlock = new chain.chain[0].constructor(b.index, b.previousHash, txs, b.timestamp);
                newBlock.nonce = b.nonce;
                newBlock.merkleRoot = b.merkleRoot;
                newBlock.hash = b.hash;
                // validate appended chain
                const bak = chain.chain.slice();
                chain.chain.push(newBlock);
                if (chain.isValid()) {
                    chain.pending = [];
                    chain.saveToDisk();
                    log('accepted block', b.index);
                    broadcast({ type: 'block', block: b });
                }
                else {
                    chain.chain = bak;
                    log('rejected block not valid');
                }
            }
        }
    }
    catch { }
}
for (const p of PEERS)
    connectToPeer(p);
process.on('SIGINT', () => { log('bye'); process.exit(0); });
