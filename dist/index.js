import { ApiPromise, WsProvider } from '@polkadot/api';
const DEFAULT_ENDPOINT = process.env.PEAQ_WS || 'wss://ws.agung.peaq.network';
function withTimeout(promise, ms, label = 'operation') {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        promise
            .then((v) => {
            clearTimeout(t);
            resolve(v);
        })
            .catch((e) => {
            clearTimeout(t);
            reject(e);
        });
    });
}
async function main() {
    const endpoint = DEFAULT_ENDPOINT;
    const provider = new WsProvider(endpoint);
    console.log(`Connecting to ${endpoint} ...`);
    const api = await withTimeout(ApiPromise.create({ provider }), 15000, 'peaq API connection');
    console.log('Connected to peaq', api.genesisHash.toHex());
    await api.disconnect();
}
main().catch((err) => {
    console.error('Failed to connect:', err?.message || err);
    process.exitCode = 1;
});
