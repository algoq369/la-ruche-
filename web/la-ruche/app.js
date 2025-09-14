const $ = (sel) => document.querySelector(sel);

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

async function refresh() {
  try {
    const s = await api('/api/chain');
    $('#height').textContent = String(s.height);
    $('#head').textContent = s.head.slice(0, 24) + '…';
    $('#difficulty').textContent = String(s.difficulty);
    $('#reward').textContent = String(s.reward);
    const tb = $('#blocksTable tbody');
    tb.innerHTML = '';
    s.blocks.slice().reverse().forEach(b => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${b.index}</td><td>${b.hash.slice(0,16)}…</td><td>${b.prev.slice(0,10)}…</td><td>${b.txs}</td><td>${b.merkleRoot.slice(0,16)}…</td>`;
      tb.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refresh();
  setInterval(refresh, 5000);

  $('#balanceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const address = $('#balAddr').value.trim();
    if (!address) return;
    try {
      const r = await api(`/api/balance?address=${encodeURIComponent(address)}`);
      $('#balOut').textContent = `Balance: ${r.balance} • Nonce: ${r.nonce}`;
      $('#balOut').className = 'ok';
    } catch (e) {
      $('#balOut').textContent = String(e);
      $('#balOut').className = 'err';
    }
  });

  $('#txForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const wallet = JSON.parse($('#wallet').value);
      const to = $('#to').value.trim();
      const amount = Number($('#amount').value);
      const fee = Number($('#fee').value);
      const r = await api('/api/add-tx', { method: 'POST', body: JSON.stringify({ wallet, to, amount, fee }) });
      $('#txOut').textContent = `OK. Pending: ${r.pending}`;
      $('#txOut').className = 'ok';
      refresh();
    } catch (e) {
      $('#txOut').textContent = (e?.message) ? e.message : String(e);
      $('#txOut').className = 'err';
    }
  });

  $('#mineForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const miner = $('#miner').value.trim();
    if (!miner) return;
    try {
      const r = await api('/api/mine', { method: 'POST', body: JSON.stringify({ miner }) });
      $('#mineOut').textContent = `Mined block #${r.index} ${r.hash.slice(0,16)}…`;
      $('#mineOut').className = 'ok';
      refresh();
    } catch (e) {
      $('#mineOut').textContent = String(e);
      $('#mineOut').className = 'err';
    }
  });
});

