import { Blockchain } from './toychain/blockchain.js';
import { Transaction } from './toychain/transaction.js';
async function main() {
    const chain = new Blockchain(3, 50); // difficulty 3, reward 50
    console.log('Mining block 1...');
    chain.addTransaction(new Transaction('alice', 'bob', 25));
    chain.addTransaction(new Transaction('bob', 'carol', 10));
    const b1 = chain.minePendingTransactions('miner1');
    console.log('Block 1 hash:', b1.hash);
    console.log('Balances after block 1:');
    console.log('alice:', chain.getBalanceOf('alice'));
    console.log('bob  :', chain.getBalanceOf('bob'));
    console.log('carol:', chain.getBalanceOf('carol'));
    console.log('miner1:', chain.getBalanceOf('miner1'));
    console.log('\nMining block 2...');
    chain.addTransaction(new Transaction('alice', 'carol', 5));
    const b2 = chain.minePendingTransactions('miner1');
    console.log('Block 2 hash:', b2.hash);
    console.log('Balances after block 2:');
    console.log('alice:', chain.getBalanceOf('alice'));
    console.log('bob  :', chain.getBalanceOf('bob'));
    console.log('carol:', chain.getBalanceOf('carol'));
    console.log('miner1:', chain.getBalanceOf('miner1'));
    console.log('\nChain valid?', chain.isValid());
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
