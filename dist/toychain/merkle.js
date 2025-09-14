import { createHash } from 'crypto';
export function merkleRoot(hashes) {
    if (hashes.length === 0)
        return '0'.repeat(64);
    let layer = hashes.slice();
    while (layer.length > 1) {
        const next = [];
        for (let i = 0; i < layer.length; i += 2) {
            const left = layer[i];
            const right = layer[i + 1] || left;
            const h = createHash('sha256');
            h.update(left + right);
            next.push(h.digest('hex'));
        }
        layer = next;
    }
    return layer[0];
}
export function merkleProof(hashes, index) {
    const proof = [];
    if (hashes.length === 0)
        return proof;
    let layer = hashes.slice();
    let idx = index;
    while (layer.length > 1) {
        const isRight = idx % 2 === 1;
        const pairIdx = isRight ? idx - 1 : idx + 1;
        const pair = layer[pairIdx] ?? layer[idx];
        proof.push({ hash: pair, position: isRight ? 'left' : 'right' });
        // build next layer
        const next = [];
        for (let i = 0; i < layer.length; i += 2) {
            const left = layer[i];
            const right = layer[i + 1] || left;
            const h = createHash('sha256');
            h.update(left + right);
            next.push(h.digest('hex'));
        }
        layer = next;
        idx = Math.floor(idx / 2);
    }
    return proof;
}
export function verifyMerkleProof(leaf, proof, root) {
    let hash = leaf;
    for (const step of proof) {
        const h = createHash('sha256');
        if (step.position === 'left')
            h.update(step.hash + hash);
        else
            h.update(hash + step.hash);
        hash = h.digest('hex');
    }
    return hash === root;
}
