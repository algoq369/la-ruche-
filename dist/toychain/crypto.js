import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify } from 'crypto';
export function generateKeyPair() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const address = deriveAddress(publicKeyPem);
    return { privateKeyPem, publicKeyPem, address };
}
export function deriveAddress(publicKeyPem) {
    const pk = createPublicKey(publicKeyPem);
    const spkiDer = pk.export({ type: 'spki', format: 'der' });
    const sha = createHash('sha256').update(spkiDer).digest();
    const ripe = createHash('ripemd160').update(sha).digest('hex');
    return `addr_${ripe}`;
}
export function signPayload(privateKeyPem, payload) {
    const key = createPrivateKey(privateKeyPem);
    const sig = edSign(null, payload, key);
    return sig.toString('base64');
}
export function verifyPayload(publicKeyPem, payload, signatureB64) {
    const key = createPublicKey(publicKeyPem);
    const sig = Buffer.from(signatureB64, 'base64');
    return edVerify(null, payload, key, sig);
}
export function sha256Hex(data) {
    const h = createHash('sha256');
    h.update(data);
    return h.digest('hex');
}
