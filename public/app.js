const socket = io();

const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const STAGE_LABEL = {
  preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown',
};

const $ = (sel) => document.querySelector(sel);
let state = null;
let myId = localStorage.getItem('pokerPlayerId') || null;

// ---------- dołączanie ----------

let session = JSON.parse(localStorage.getItem('pokerSession') || '{}');
if (session.name) $('#name').value = session.name;
if (session.table) $('#table').value = session.table;

function join(name, tableId, onError) {
  socket.emit('join', { tableId, name, playerId: myId }, (res) => {
    if (res.error) { onError(res.error); return; }
    myId = res.playerId;
    session = { name, table: res.tableId };
    localStorage.setItem('pokerPlayerId', myId);
    localStorage.setItem('pokerSession', JSON.stringify(session));
    $('#lobby').hidden = true;
    $('#game').hidden = false;
    $('#table-label').textContent = `Stół: ${res.tableId}`;
  });
}

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  join(
    $('#name').value.trim(),
    $('#table').value.trim() || 'stol1',
    (err) => { $('#join-error').textContent = err; },
  );
});

// Odświeżenie strony nie wyrzuca z gry — wracamy na swoje miejsce automatycznie.
if (myId && session.name && session.table) {
  join(session.name, session.table, () => {});
}

// Po zerwaniu i wznowieniu połączenia wracamy na swoje miejsce.
socket.on('connect', () => {
  if (myId && session.name && !$('#game').hidden) {
    socket.emit('join', { tableId: session.table, name: session.name, playerId: myId }, () => {});
  }
});

$('#leave').addEventListener('click', () => {
  socket.emit('leave');
  localStorage.removeItem('pokerPlayerId');
  location.reload();
});

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#chat').value.trim();
  if (text) socket.emit('chat', text);
  $('#chat').value = '';
});

socket.on('state', (s) => { state = s; render(s); });

// ---------- render ----------

const TURN_MS = 45000;

const cardKey = (c) => `${c.r}${c.s}`;

function cardEl(card, small, best, animate) {
  const el = document.createElement('div');
  el.className = 'card' + (small ? ' small' : '') + (animate ? ' deal' : '');
  // Po showdownie wyróżniamy pięć kart zwycięskiego układu.
  if (best && card) el.classList.add(best.has(cardKey(card)) ? 'hl' : 'dim');
  if (card === undefined) { el.classList.add('slot'); return el; }
  if (card === null) { el.classList.add('back'); return el; }

  if (card.s === 'h' || card.s === 'd') el.classList.add('red');
  const rank = RANK_LABEL[card.r] || card.r;
  const suit = SUIT_SYMBOL[card.s];
  el.innerHTML = `<span class="corner tl">${rank}<i>${suit}</i></span>`
    + `<span class="pip">${suit}</span>`
    + `<span class="corner br">${rank}<i>${suit}</i></span>`;
  return el;
}

let prevCommunity = 0;
let prevHandNo = -1;

function render(s) {
  const me = s.players.find((p) => p.id === s.you);
  const myIdx = s.players.indexOf(me);
  const results = s.lastResult ? s.lastResult.results : [];
  const winners = new Set(results.filter((r) => r.won > 0).map((r) => r.playerId));
  // Układ do podświetlenia pokazujemy tylko przy jednym zwycięzcy po showdownie.
  const champion = results.filter((r) => r.won > 0);
  const best = champion.length === 1 && champion[0].best
    ? new Set(champion[0].best.map(cardKey))
    : null;

  // Obracamy stół tak, by nasze miejsce było zawsze na dole.
  const dealHole = s.handNo !== prevHandNo;   // karty własne animujemy raz na rozdanie
  const seats = $('#seats');
  seats.innerHTML = '';
  s.players.forEach((p, i) => {
    const pos = (i - myIdx + s.players.length) % s.players.length;
    seats.appendChild(seatEl(p, pos, i, s, winners, winners.has(p.id) ? best : null, dealHole));
  });
  prevHandNo = s.handNo;

  $('#pot').innerHTML = `<i class="chip"></i>Pula ${s.pot}`;
  $('#pot').classList.toggle('on', s.pot > 0);
  $('#stage').textContent = s.stage ? STAGE_LABEL[s.stage] : '';
  $('#hand-label').textContent = s.handNo ? `Rozdanie #${s.handNo}` : 'Oczekiwanie';

  // Pięć slotów — puste miejsca na karty wspólne rysujemy jako obrysy.
  // Animujemy tylko karty, które doszły od poprzedniego renderu.
  const fresh = s.community.length > prevCommunity ? prevCommunity : Infinity;
  const comm = $('#community');
  comm.innerHTML = '';
  for (let i = 0; i < 5; i++) comm.appendChild(cardEl(s.community[i], false, best, i >= fresh));
  prevCommunity = s.community.length;

  $('#banner').textContent = bannerText(s);

  renderControls(s, me);
  renderLog(s);
}

function bannerText(s) {
  if (s.stage || !s.lastResult) return '';
  const won = s.lastResult.results.filter((r) => r.won > 0);
  if (won.length === 0) return '';
  if (won.length > 1) return `Podział puli — ${won.map((r) => r.name).join(' i ')}`;
  return `${won[0].name} wygrywa ${won[0].won}${won[0].hand ? ` — ${won[0].hand}` : ''}`;
}

function seatEl(p, pos, idx, s, winners, best, dealHole) {
  const el = document.createElement('div');
  el.className = `seat seat-${pos}`;
  if (p.folded) el.classList.add('folded');
  if (s.turnId === p.id) el.classList.add('turn');
  if (winners.has(p.id)) el.classList.add('winner');

  const hole = document.createElement('div');
  hole.className = 'hole';
  // Własne karty rysujemy w pełnym rozmiarze — mają być czytelne bez wysiłku.
  for (const c of p.cards) hole.appendChild(cardEl(c, pos !== 0, best, dealHole));
  el.appendChild(hole);

  const badges = [
    p.allIn ? '<span class="badge allin">ALL-IN</span>' : '',
    !s.stage && p.ready ? '<span class="badge ready">GOTOWY</span>' : '',
    !p.connected ? '<span class="badge off">OFFLINE</span>' : '',
    winners.has(p.id) ? `<span class="badge won">+${wonBy(s, p.id)}</span>` : '',
  ].join('');

  const box = document.createElement('div');
  box.className = 'seat-box';
  box.innerHTML = `<div class="avatar">${escapeHtml(p.name.slice(0, 1).toUpperCase())}</div>`
    + `<div class="meta">`
    + `<div class="name">${escapeHtml(p.name)}${badges}</div>`
    + `<div class="chips">${p.chips} 🪙</div>`
    + `</div>`
    + (idx === s.dealerIdx ? '<div class="dealer-btn">D</div>' : '');
  el.appendChild(box);

  const status = document.createElement('div');
  status.className = 'status';
  status.textContent = p.folded ? 'pas' : '';
  el.appendChild(status);

  if (p.bet > 0) {
    const bet = document.createElement('div');
    bet.className = 'chip-bet';
    bet.innerHTML = `<i class="chip"></i>${p.bet}`;
    el.appendChild(bet);
  }
  return el;
}

function wonBy(s, id) {
  const r = s.lastResult.results.find((x) => x.playerId === id);
  return r ? r.won : 0;
}

// Pierścień odliczający czas rysujemy niezależnie od odświeżeń stanu z serwera.
function tickTimer() {
  const avatar = document.querySelector('.seat.turn .avatar');
  if (avatar && state && state.deadline) {
    const left = Math.max(0, state.deadline - Date.now());
    avatar.style.setProperty('--p', `${(left / TURN_MS) * 100}%`);
  }
  requestAnimationFrame(tickTimer);
}
requestAnimationFrame(tickTimer);

function renderControls(s, me) {
  const box = $('#controls');
  box.innerHTML = '';
  keyMap = {};
  if (!me) return;

  if (!s.stage) {
    if (s.lastResult) box.appendChild(resultEl(s.lastResult));
    if (me.chips <= 0) {
      box.appendChild(hint('Nie masz już żetonów — czekasz na koniec gry.'));
      return;
    }
    const btn = document.createElement('button');
    btn.textContent = me.ready ? 'Czekam na pozostałych…' : 'Gotowy — rozdaj karty';
    btn.disabled = me.ready;
    btn.onclick = () => socket.emit('ready', true);
    box.appendChild(btn);
    if (s.players.filter((p) => p.id !== me.id && p.chips > 0).length === 0) {
      box.appendChild(hint('Potrzebny jeszcze co najmniej 1 gracz.'));
    }
    return;
  }

  if (s.turnId !== me.id) {
    const who = s.players.find((p) => p.id === s.turnId);
    box.appendChild(hint(who ? `Kolej gracza: ${who.name}` : 'Rozdanie w toku…'));
    return;
  }

  const toCall = s.currentBet - me.bet;
  const minRaiseTo = Math.min(s.currentBet + s.minRaise, me.bet + me.chips);
  const maxRaiseTo = me.bet + me.chips;

  box.appendChild(actionBtn('Pas', 'fold', 'f', () => send('fold')));
  box.appendChild(toCall <= 0
    ? actionBtn('Czekam', '', 'c', () => send('check'))
    : actionBtn(
      toCall >= me.chips ? `Sprawdzam all-in (${me.chips})` : `Sprawdzam ${toCall}`,
      'call', 'c', () => send('call'),
    ));

  if (maxRaiseTo > s.currentBet) {
    const group = document.createElement('div');
    group.className = 'raise-group';

    const range = document.createElement('input');
    range.type = 'range';
    Object.assign(range, { min: minRaiseTo, max: maxRaiseTo, step: s.bigBlind, value: minRaiseTo });

    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'amount';
    num.inputMode = 'numeric';   // klawiatura numeryczna na telefonie
    Object.assign(num, { min: minRaiseTo, max: maxRaiseTo, value: minRaiseTo });

    range.oninput = () => { num.value = range.value; };
    num.oninput = () => { range.value = num.value; };
    const setTo = (v) => {
      const val = Math.max(minRaiseTo, Math.min(maxRaiseTo, Math.round(v)));
      num.value = val; range.value = val;
    };

    // Szybkie stawki liczone od puli po wyrównaniu obecnego zakładu.
    const quick = document.createElement('div');
    quick.className = 'quick';
    for (const [label, frac] of [['½ puli', 0.5], ['¾ puli', 0.75], ['Pula', 1]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => setTo(s.currentBet + (s.pot + toCall) * frac);
      quick.appendChild(b);
    }

    group.append(quick, range, num, actionBtn(
      s.currentBet === 0 ? 'Stawiam' : 'Podbijam', '', 'r',
      () => send('raise', Math.max(minRaiseTo, Math.min(maxRaiseTo, Number(num.value)))),
    ));
    box.appendChild(group);
    box.appendChild(actionBtn(`All-in ${maxRaiseTo}`, 'allin', 'a', () => send('allin')));
  }
}

// ---------- skróty klawiszowe ----------

let keyMap = {};

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const fn = keyMap[e.key.toLowerCase()];
  if (fn) { e.preventDefault(); fn(); }
});

function actionBtn(label, cls, key, onClick) {
  const b = document.createElement('button');
  b.innerHTML = `${escapeHtml(label)}${key ? `<span class="kbd">${key.toUpperCase()}</span>` : ''}`;
  if (cls) b.className = cls;
  b.onclick = onClick;
  if (key) keyMap[key] = onClick;
  return b;
}

function hint(text) {
  const el = document.createElement('span');
  el.className = 'hint';
  el.textContent = text;
  return el;
}

function resultEl(result) {
  const el = document.createElement('div');
  el.className = 'result';
  el.innerHTML = result.results
    .map((r) => `<span><b>${escapeHtml(r.name)}</b>${r.hand ? ` — ${r.hand}` : ''}`
      + (r.won > 0 ? ` <span class="won">+${r.won}</span>` : '') + '</span>')
    .join('');
  return el;
}

function send(action, amount) {
  socket.emit('action', { action, amount }, (res) => {
    if (res && res.error) flash(res.error);
  });
}

function flash(msg) {
  const note = document.createElement('span');
  note.className = 'hint';
  note.style.color = 'var(--red)';
  note.textContent = msg;
  $('#controls').appendChild(note);
  setTimeout(() => note.remove(), 2500);
}

let lastLogLen = 0;
function renderLog(s) {
  const box = $('#log');
  box.innerHTML = s.log
    .map((l) => {
      const cls = l.msg.startsWith('---') ? 'sep' : (l.msg.startsWith('💬') ? 'chat' : '');
      const text = l.msg.replace(/^---\s*|\s*---$/g, '');
      return `<div class="${cls}">${escapeHtml(text)}</div>`;
    })
    .join('');
  if (s.log.length !== lastLogLen) {
    box.scrollTop = box.scrollHeight;
    lastLogLen = s.log.length;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

