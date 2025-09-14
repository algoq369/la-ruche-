import http from 'http';
import { readFileSync, existsSync, statSync, createReadStream } from 'fs';
import { resolve, join, extname } from 'path';
import { Blockchain } from '../toychain/blockchain.js';
import { Transaction } from '../toychain/transaction.js';
import { generateKeyPair } from '../toychain/crypto.js';
// Config
const PORT = Number(process.env.PORT || '8080');
const DATA = process.env.DATA || 'toychain.data.json';
const METRICS_FILE = process.env.METRICS_FILE || '/tmp/metrics.json';
const METRICS_TOKEN = process.env.METRICS_TOKEN || '';
const BINANCE_SYMBOL = process.env.BINANCE_SYMBOL || 'BTCUSDT';
const BINANCE_INTERVAL = process.env.BINANCE_INTERVAL || '1m';
const BINANCE_POLL_MS = Number(process.env.BINANCE_POLL_MS || '60000');
let WEB_ROOT = resolve(process.cwd(), 'web/la-ruche');
(() => {
    const candidates = [
        WEB_ROOT,
        resolve(process.cwd(), '../web/la-ruche'),
        resolve(process.cwd(), '../../web/la-ruche'),
        resolve(process.cwd(), '../../../web/la-ruche'),
        resolve(process.cwd(), 'dist/web/la-ruche'),
    ];
    for (const p of candidates) {
        try {
            if (existsSync(p)) {
                WEB_ROOT = p;
                break;
            }
        }
        catch { }
    }
})();
const chain = new Blockchain(3, 50, DATA);
function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}
function notFound(res) { res.writeHead(404); res.end('Not found'); }
async function readBody(req) {
    return new Promise((resolveBody) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const buf = Buffer.concat(chunks);
            try {
                resolveBody(JSON.parse(buf.toString('utf8') || '{}'));
            }
            catch {
                resolveBody({});
            }
        });
    });
}
function mime(filePath) {
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
function serveStatic(req, res) {
    if (!req.url)
        return false;
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
function defaultMetrics() {
    return { rsi: 50, valueArea: '-', openInterest: 0, volume: 0, netLong: 0, updatedAt: Date.now() };
}
function loadMetrics() {
    try {
        if (existsSync(METRICS_FILE)) {
            const raw = readFileSync(METRICS_FILE, 'utf8');
            const obj = JSON.parse(raw);
            return { ...defaultMetrics(), ...obj };
        }
    }
    catch { }
    return defaultMetrics();
}
function saveMetrics(m) {
    try {
        const data = JSON.stringify(m, null, 2);
        require('fs').writeFileSync(METRICS_FILE, data);
    }
    catch { }
}
let metricsCache = loadMetrics();
// --- Binance live metrics updater ---
async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
}
function calcRSI(closes, period = 14) {
    if (closes.length < period + 1)
        return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change >= 0)
            gains += change;
        else
            losses -= change;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = Math.max(0, change);
        const loss = Math.max(0, -change);
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0)
        return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}
async function updateMetricsFromBinance() {
    try {
        const symbol = BINANCE_SYMBOL.toUpperCase();
        // 1) Kliness for RSI and VWAP/std
        const kUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${BINANCE_INTERVAL}&limit=500`;
        const klines = await fetchJson(kUrl);
        const closes = klines.map(k => Number(k[4]));
        const vols = klines.map(k => Number(k[5]));
        const highs = klines.map(k => Number(k[2]));
        const lows = klines.map(k => Number(k[3]));
        // Typical price for VWAP
        const tps = klines.map((k, i) => (highs[i] + lows[i] + closes[i]) / 3);
        const sumVol = vols.reduce((a, b) => a + b, 0) || 1;
        const vwap = tps.reduce((a, tp, i) => a + tp * vols[i], 0) / sumVol;
        const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
        const sd = Math.sqrt(closes.reduce((a, b) => a + (b - mean) ** 2, 0) / closes.length);
        const vah = vwap + sd;
        const val = vwap - sd;
        const rsi = calcRSI(closes, 14) ?? metricsCache.rsi;
        // 2) Open interest
        const oiUrl = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
        const oiJson = await fetchJson(oiUrl);
        const openInterest = Number(oiJson.openInterest);
        // 3) 24h ticker for volume and taker buy ratio (net long proxy)
        const tUrl = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`;
        const t = await fetchJson(tUrl);
        const volume = Number(t.volume);
        const takerBuy = Number(t.takerBuyBaseAssetVolume || 0);
        let netLong = 0;
        if (volume > 0) {
            const ratio = takerBuy / volume; // 0..1
            netLong = (ratio * 2 - 1) * 100; // -100..100
        }
        metricsCache = {
            rsi: Number(rsi?.toFixed(2)),
            valueArea: `VAH ${vah.toFixed(2)} / VAL ${val.toFixed(2)} (VWAP ${vwap.toFixed(2)})`,
            openInterest,
            volume,
            netLong: Number(netLong.toFixed(2)),
            updatedAt: Date.now(),
        };
        saveMetrics(metricsCache);
    }
    catch (e) {
        // Best-effort: keep previous metrics on failure
    }
}
function scheduleBinance() {
    updateMetricsFromBinance();
    setInterval(updateMetricsFromBinance, Math.max(15000, BINANCE_POLL_MS));
}
const server = http.createServer(async (req, res) => {
    try {
        if (!req.url)
            return notFound(res);
        // Static
        if (!req.url.startsWith('/api/')) {
            // Explicit mapping for News page to avoid any path issues
            if (req.url === '/news' || req.url === '/news.html') {
                const file = join(WEB_ROOT, 'news.html');
                if (existsSync(file)) {
                    const body = readFileSync(file);
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
                    res.end(body);
                    return;
                }
            }
            // Map to news assets directly just in case
            if (req.url === '/news.js') {
                const file = join(WEB_ROOT, 'news.js');
                if (existsSync(file)) {
                    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
                    createReadStream(file).pipe(res);
                    return;
                }
            }
            if (req.url === '/news.json') {
                const file = join(WEB_ROOT, 'news.json');
                if (existsSync(file)) {
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    createReadStream(file).pipe(res);
                    return;
                }
            }
            if (serveStatic(req, res))
                return;
            else
                return notFound(res);
        }
        // API
        if (req.method === 'GET' && req.url === '/api/health') {
            return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'GET' && req.url === '/api/metrics') {
            return sendJson(res, 200, metricsCache);
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
            const { wallet, to, amount, fee } = body;
            if (!wallet || !to || !amount)
                return sendJson(res, 400, { error: 'missing fields' });
            try {
                const nonce = chain.getNonce(wallet.address);
                const tx = new Transaction(wallet.address, to, Number(amount), Number(fee ?? 1), nonce);
                tx.sign(wallet.privateKeyPem, wallet.publicKeyPem);
                chain.addTransaction(tx);
                chain.saveToDisk();
                return sendJson(res, 200, { ok: true, pending: chain.pending.length });
            }
            catch (e) {
                return sendJson(res, 400, { error: e?.message || String(e) });
            }
        }
        if (req.method === 'POST' && req.url === '/api/mine') {
            const body = await readBody(req);
            const { miner } = body;
            if (!miner)
                return sendJson(res, 400, { error: 'missing miner' });
            try {
                const block = chain.minePendingTransactions(miner);
                return sendJson(res, 200, { ok: true, index: block.index, hash: block.hash });
            }
            catch (e) {
                return sendJson(res, 400, { error: e?.message || String(e) });
            }
        }
        if (req.method === 'POST' && req.url === '/api/metrics') {
            if (METRICS_TOKEN) {
                const token = req.headers['x-admin-token'] || '';
                if (token !== METRICS_TOKEN)
                    return sendJson(res, 401, { error: 'unauthorized' });
            }
            const body = await readBody(req);
            const next = { ...metricsCache };
            if (typeof body.rsi === 'number' && isFinite(body.rsi))
                next.rsi = Math.max(0, Math.min(100, body.rsi));
            if (typeof body.valueArea === 'string')
                next.valueArea = String(body.valueArea);
            if (typeof body.openInterest === 'number' && isFinite(body.openInterest))
                next.openInterest = body.openInterest;
            if (typeof body.volume === 'number' && isFinite(body.volume))
                next.volume = body.volume;
            if (typeof body.netLong === 'number' && isFinite(body.netLong))
                next.netLong = Math.max(-100, Math.min(100, body.netLong));
            next.updatedAt = Date.now();
            metricsCache = next;
            saveMetrics(metricsCache);
            return sendJson(res, 200, { ok: true, metrics: metricsCache });
        }
        notFound(res);
    }
    catch (e) {
        sendJson(res, 500, { error: e?.message || String(e) });
    }
});
server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`La Ruche server listening on http://localhost:${PORT}`);
    // Start Binance updater if network is available
    try {
        scheduleBinance();
    }
    catch { }
});
