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
    enterTable();
    $('#table-label').textContent = `Stół: ${res.tableId}`;
  });
}

// Lobby ustępuje miejsca stołowi płynnie — panel odjeżdża, stół się rozkłada.
function enterTable() {
  const lobby = $('#lobby');
  if ($('#game').hidden) {
    $('#game').hidden = false;
    $('#game').classList.add('enter');
    setTimeout(() => $('#game').classList.remove('enter'), 900);
  }
  if (!lobby.hidden) {
    lobby.classList.add('out');
    setTimeout(() => { lobby.hidden = true; lobby.classList.remove('out'); }, 320);
  }
}

$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  join(
    $('#name').value.trim(),
    $('#table').value.trim() || 'stol1',
    (err) => {
      $('#join-error').textContent = err;
      shake($('#join-form'));
    },
  );
});

// Odświeżenie strony nie wyrzuca z gry — wracamy na swoje miejsce automatycznie.
if (myId && session.name && session.table) {
  join(session.name, session.table, () => { });
}

// Po zerwaniu i wznowieniu połączenia wracamy na swoje miejsce.
socket.on('connect', () => {
  if (myId && session.name && !$('#game').hidden) {
    socket.emit('join', { tableId: session.table, name: session.name, playerId: myId }, () => { });
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

// ---------- animacje ----------

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

const EASE = 'cubic-bezier(0.2, 0.9, 0.3, 1.2)';

/** Krótka animacja na elemencie, który przeżywa przebudowę widoku. */
function anim(el, frames, opts = {}) {
  if (!el || reduced.matches || !el.animate) return;
  el.animate(frames, { duration: 320, easing: EASE, fill: 'backwards', ...opts });
}

const popIn = (el) => anim(el, [
  { transform: 'scale(0.82)', opacity: 0 },
  { transform: 'scale(1)', opacity: 1 },
], { duration: 340 });

const bump = (el) => anim(el, [
  { transform: 'scale(1)' },
  { transform: 'scale(1.14)', offset: 0.4 },
  { transform: 'scale(1)' },
], { duration: 420, easing: 'ease-out' });

const shake = (el) => anim(el, [
  { transform: 'translateX(0)' }, { transform: 'translateX(-7px)' },
  { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' },
  { transform: 'translateX(0)' },
], { duration: 300, easing: 'ease-in-out' });

/** Środek elementu we współrzędnych okna (null, gdy nic nie zajmuje miejsca). */
function center(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

/** Żetony lecące łukiem z punktu A do B — do puli i z puli do zwycięzcy. */
function flyChips(from, to, count, gold) {
  if (!from || !to || reduced.matches) return;
  for (let i = 0; i < count; i++) {
    const chip = document.createElement('i');
    chip.className = `chip fly-chip${gold ? ' gold' : ''}`;
    chip.style.left = `${from.x}px`;
    chip.style.top = `${from.y}px`;
    document.body.appendChild(chip);

    const dx = to.x - from.x + (Math.random() - 0.5) * 26;
    const dy = to.y - from.y + (Math.random() - 0.5) * 20;
    const lift = 26 + Math.random() * 22;   // wysokość łuku
    const a = chip.animate([
      { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.18 },
      {
        transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - lift}px)) scale(1.1)`,
        opacity: 1, offset: 0.6,
      },
      {
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.65)`,
        opacity: 0,
      },
    ], { duration: 620, delay: i * 70, easing: 'cubic-bezier(0.35, 0, 0.35, 1)', fill: 'backwards' });
    a.onfinish = () => chip.remove();
    a.oncancel = () => chip.remove();
  }
}

/** Karty wjeżdżają od krupierki: wektor liczymy po wstawieniu do DOM,
 *  jeszcze zanim przeglądarka namaluje pierwszą klatkę animacji. */
function primeDeal() {
  if (reduced.matches) return;
  const felt = $('.felt');
  const cards = document.querySelectorAll('.card.deal, .card.dealflip');
  if (!felt || !cards.length) return;
  const r = felt.getBoundingClientRect();
  const ox = r.left + r.width / 2;
  const oy = r.top + r.height * 0.04;    // tuż pod krupierką
  for (const el of cards) {
    const c = center(el);
    if (!c) continue;
    el.style.setProperty('--dx', `${Math.round(ox - c.x)}px`);
    el.style.setProperty('--dy', `${Math.round(oy - c.y)}px`);
  }
}

// ---------- render ----------

const TURN_MS = 20000;

const cardKey = (c) => `${c.r}${c.s}`;

/**
 * Karta ma dwie ścianki (awers i rewers) obracane w 3D — dzięki temu
 * odsłonięcie kart to prawdziwy obrót, a nie podmiana obrazka.
 * anim: 'deal' (wjazd zakrytej), 'dealflip' (wjazd + odkrycie), 'flip' (samo odkrycie).
 */
function cardEl(card, opt = {}) {
  const { small, best, anim: animName, delay = 0, rot = 0, muck } = opt;
  const el = document.createElement('div');
  el.className = 'card';
  if (small) el.classList.add('small');
  if (animName && !reduced.matches) {
    el.classList.add(animName);
    el.style.setProperty('--dr', `${rot}deg`);
    if (delay) el.style.animationDelay = `${delay}ms`;
  }
  if (muck && !reduced.matches) el.classList.add('muck');

  const front = document.createElement('div');
  front.className = 'fc front';

  if (card === undefined) { el.classList.add('slot'); el.appendChild(front); return el; }

  // Po showdownie wyróżniamy pięć kart zwycięskiego układu.
  if (best && card) el.classList.add(best.has(cardKey(card)) ? 'hl' : 'dim');

  const back = document.createElement('div');
  back.className = 'fc back';

  if (card === null) { el.classList.add('down'); el.append(front, back); return el; }

  if (card.s === 'h' || card.s === 'd') el.classList.add('red');
  const rank = RANK_LABEL[card.r] || card.r;
  const suit = SUIT_SYMBOL[card.s];
  front.innerHTML = `<span class="corner tl">${rank}<i>${suit}</i></span>`
    + `<span class="pip">${suit}</span>`
    + `<span class="corner br">${rank}<i>${suit}</i></span>`;
  el.append(front, back);
  return el;
}

// Zdjęcie poprzedniego stanu — animujemy wyłącznie to, co naprawdę się zmieniło.
const prev = {
  handNo: -1,
  community: 0,
  stage: undefined,
  pot: 0,
  banner: '',
  payout: '',
  ctrlSig: '',
  myTurn: false,
  ids: new Set(),
  cards: {},
  folded: {},
  chips: {},
  bets: {},
  logKeys: new Set(),
};

let seatNodes = {};   // pid -> element miejsca z poprzedniego renderu

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

  const newHand = s.handNo !== prev.handNo;   // karty rozdajemy raz na rozdanie

  // --- co się zmieniło; stosiki żetonów mierzymy jeszcze na starym DOM ---
  const fx = {};
  for (const p of s.players) {
    const was = prev.cards[p.id] || [];
    fx[p.id] = {
      // Kartę odkrywamy obrotem tylko wtedy, gdy naprawdę leżała zakryta.
      flip: p.cards.map((c, i) => !newHand && !!c && was[i] === null),
      muck: p.folded && prev.folded[p.id] === false,
      bet: p.bet > (prev.bets[p.id] || 0),
      enter: prev.ids.size > 0 && !prev.ids.has(p.id),
      delta: prev.chips[p.id] === undefined ? 0 : p.chips - prev.chips[p.id],
    };
  }

  const potAt = center($('#pot'));
  const collect = [];
  if (s.pot > prev.pot) {
    for (const p of s.players) {
      if ((prev.bets[p.id] || 0) > 0 && p.bet === 0) {
        const from = center(seatNodes[p.id] && seatNodes[p.id].querySelector('.chip-bet'));
        if (from) collect.push(from);
      }
    }
  }
  // Wypłata puli: raz na rozdanie, w momencie pojawienia się wyniku.
  const payout = !s.stage && s.lastResult ? `h${s.handNo}` : '';
  const showPayout = payout && payout !== prev.payout;

  // Obracamy stół tak, by nasze miejsce było zawsze na dole.
  const seats = $('#seats');
  // Rozstawienie miejsc zależy od liczby graczy (CSS: #seats.count-N .seat-M).
  seats.className = `count-${s.players.length}`;
  seats.innerHTML = '';
  seatNodes = {};
  s.players.forEach((p, i) => {
    const pos = (i - myIdx + s.players.length) % s.players.length;
    const node = seatEl(p, pos, i, s, winners, winners.has(p.id) ? best : null, {
      ...fx[p.id], deal: newHand, seats: s.players.length,
    });
    seatNodes[p.id] = node;
    seats.appendChild(node);
  });

  const pot = $('#pot');
  pot.innerHTML = `<i class="chip"></i>Pula ${s.pot}`;
  pot.classList.toggle('on', s.pot > 0);
  if (s.pot > prev.pot && prev.pot > 0) bump(pot);
  else if (s.pot > 0 && prev.pot === 0) popIn(pot);

  const stage = $('#stage');
  stage.textContent = s.stage ? STAGE_LABEL[s.stage] : '';
  if (s.stage !== prev.stage && s.stage) {
    anim(stage, [
      { opacity: 0, letterSpacing: '9px' },
      { opacity: 1, letterSpacing: '3px' },
    ], { duration: 420, easing: 'ease-out' });
  }
  $('#hand-label').textContent = s.handNo ? `Rozdanie #${s.handNo}` : 'Oczekiwanie';

  // Pięć slotów — puste miejsca na karty wspólne rysujemy jako obrysy.
  // Animujemy tylko karty, które doszły od poprzedniego renderu.
  const fresh = s.community.length > prev.community ? prev.community : Infinity;
  const comm = $('#community');
  comm.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const isNew = i >= fresh;
    comm.appendChild(cardEl(s.community[i], {
      best,
      anim: isNew ? 'dealflip' : null,
      delay: isNew ? (i - fresh) * 150 : 0,
      rot: (i % 2 ? -1 : 1) * 9,
    }));
  }

  const banner = $('#banner');
  const text = bannerText(s);
  if (text !== prev.banner) {
    banner.textContent = text;
    if (text) popIn(banner);
  }

  renderControls(s, me);
  renderLog(s);

  // --- animacje wymagające już przeliczonego układu ---
  primeDeal();
  if (potAt) {
    collect.forEach((from) => flyChips(from, potAt, 4));
    if (showPayout) {
      for (const r of results.filter((x) => x.won > 0)) {
        const to = center(seatNodes[r.playerId]);
        if (to) flyChips(potAt, to, 7, true);
      }
    }
  }

  // --- zapamiętujemy stan do porównania przy następnym renderze ---
  prev.handNo = s.handNo;
  prev.community = s.community.length;
  prev.stage = s.stage;
  prev.pot = s.pot;
  prev.banner = text;
  prev.payout = payout;
  prev.ids = new Set(s.players.map((p) => p.id));
  prev.cards = {};
  prev.folded = {};
  prev.chips = {};
  prev.bets = {};
  for (const p of s.players) {
    prev.cards[p.id] = p.cards.map((c) => (c ? cardKey(c) : c));
    prev.folded[p.id] = p.folded;
    prev.chips[p.id] = p.chips;
    prev.bets[p.id] = p.bet;
  }
}

function bannerText(s) {
  if (s.stage || !s.lastResult) return '';
  const won = s.lastResult.results.filter((r) => r.won > 0);
  if (won.length === 0) return '';
  if (won.length > 1) return `Podział puli — ${won.map((r) => r.name).join(' i ')}`;
  return `${won[0].name} wygrywa ${won[0].won}${won[0].hand ? ` — ${won[0].hand}` : ''}`;
}

function seatEl(p, pos, idx, s, winners, best, fx) {
  const el = document.createElement('div');
  el.className = `seat seat-${pos}`;
  if (p.folded) el.classList.add('folded');
  if (s.turnId === p.id) el.classList.add('turn');
  if (winners.has(p.id)) el.classList.add('winner');
  if (fx.enter && !reduced.matches) el.classList.add('sit-in');

  const hole = document.createElement('div');
  hole.className = 'hole';
  // Własne karty rysujemy w pełnym rozmiarze — mają być czytelne bez wysiłku.
  p.cards.forEach((c, i) => {
    // Karty lecą kolejką dookoła stołu: runda po rundzie, miejsce po miejscu.
    const cardAnim = fx.deal ? (c ? 'dealflip' : 'deal') : (fx.flip[i] ? 'flip' : null);
    hole.appendChild(cardEl(c, {
      small: pos !== 0,
      best,
      anim: cardAnim,
      delay: fx.deal ? (i * fx.seats + pos) * 85 : (fx.flip[i] ? pos * 120 : 0),
      rot: i ? -7 : 7,
      muck: fx.muck,
    }));
  });
  el.appendChild(hole);

  const badges = [
    p.allIn ? '<span class="badge allin">ALL-IN</span>' : '',
    !s.stage && p.ready ? '<span class="badge ready">GOTOWY</span>' : '',
    !p.connected ? '<span class="badge off">OFFLINE</span>' : '',
    winners.has(p.id) ? `<span class="badge won">+${wonBy(s, p.id)}</span>` : '',
  ].join('');

  // Zmiana stanu żetonów mruga na zielono/czerwono — widać, komu ubyło.
  const chipsCls = fx.delta > 0 ? ' up' : (fx.delta < 0 ? ' down' : '');

  const box = document.createElement('div');
  box.className = 'seat-box';
  box.innerHTML = `<div class="avatar">${escapeHtml(p.name.slice(0, 1).toUpperCase())}</div>`
    + `<div class="meta">`
    + `<div class="name">${escapeHtml(p.name)}${badges}</div>`
    + `<div class="chips${chipsCls}">${p.chips} 🪙</div>`
    + `</div>`
    + (idx === s.dealerIdx ? '<div class="dealer-btn">D</div>' : '');
  el.appendChild(box);

  const status = document.createElement('div');
  status.className = 'status';
  status.textContent = p.folded ? 'pas' : '';
  el.appendChild(status);

  if (p.bet > 0) {
    const bet = document.createElement('div');
    bet.className = 'chip-bet' + (fx.bet && !reduced.matches ? ' bump' : '');
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
    // Ostatnie sekundy: pierścień czerwienieje i zaczyna pulsować.
    avatar.classList.toggle('urgent', left > 0 && left < 5000);
  }
  requestAnimationFrame(tickTimer);
}
requestAnimationFrame(tickTimer);

function renderControls(s, me) {
  const box = $('#controls');
  box.innerHTML = '';
  keyMap = {};
  const myTurn = !!(me && s.stage && s.turnId === me.id);
  box.classList.toggle('mine', myTurn);
  if (myTurn && !prev.myTurn) popIn(box);
  prev.myTurn = myTurn;
  if (!me) return;

  if (!s.stage) {
    if (s.lastResult) box.appendChild(resultEl(s.lastResult));
    if (me.chips <= 0) {
      box.appendChild(hint('Nie masz już żetonów — czekasz na koniec gry.'));
      return staggerIn(box);
    }
    const btn = document.createElement('button');
    btn.textContent = me.ready ? 'Czekam na pozostałych…' : 'Gotowy — rozdaj karty';
    btn.disabled = me.ready;
    btn.onclick = () => socket.emit('ready', true);
    box.appendChild(btn);
    if (s.players.filter((p) => p.id !== me.id && p.chips > 0).length === 0) {
      box.appendChild(hint('Potrzebny jeszcze co najmniej 1 gracz.'));
    }
    return staggerIn(box);
  }

  if (s.turnId !== me.id) {
    const who = s.players.find((p) => p.id === s.turnId);
    box.appendChild(hint(who ? `Kolej gracza: ${who.name}` : 'Rozdanie w toku…'));
    return staggerIn(box);
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
      bump(num);
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
  staggerIn(box);
}

/** Nowy zestaw akcji wjeżdża kaskadą — ale tylko gdy faktycznie się zmienił. */
function staggerIn(box) {
  const sig = [...box.children].map((c) => c.textContent).join('|');
  if (sig === prev.ctrlSig) return;
  prev.ctrlSig = sig;
  [...box.children].forEach((c, i) => anim(c, [
    { opacity: 0, transform: 'translateY(10px)' },
    { opacity: 1, transform: 'none' },
  ], { duration: 280, delay: i * 55 }));
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
  // Kliknięcie zostawia po sobie rozchodzącą się falę.
  b.onclick = (e) => { ripple(b, e); onClick(); };
  if (key) keyMap[key] = onClick;
  return b;
}

function ripple(el, e) {
  if (reduced.matches) return;
  const r = el.getBoundingClientRect();
  const d = Math.max(r.width, r.height) * 2;
  const wave = document.createElement('span');
  wave.className = 'ripple';
  wave.style.width = wave.style.height = `${d}px`;
  wave.style.left = `${(e && e.clientX ? e.clientX - r.left : r.width / 2) - d / 2}px`;
  wave.style.top = `${(e && e.clientY ? e.clientY - r.top : r.height / 2) - d / 2}px`;
  el.appendChild(wave);
  setTimeout(() => wave.remove(), 550);
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
  shake($('#controls'));
  setTimeout(() => {
    anim(note, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    setTimeout(() => note.remove(), 300);
  }, 2200);
}

let lastLogLen = 0;
function renderLog(s) {
  const box = $('#log');
  const keys = [];
  const first = prev.logKeys.size === 0;   // pierwsze wejście — bez kaskady
  box.innerHTML = s.log
    .map((l) => {
      const key = `${l.t}|${l.msg}`;
      keys.push(key);
      const cls = [
        l.msg.startsWith('---') ? 'sep' : (l.msg.startsWith('💬') ? 'chat' : ''),
        !first && !prev.logKeys.has(key) ? 'fresh' : '',
      ].filter(Boolean).join(' ');
      const text = l.msg.replace(/^---\s*|\s*---$/g, '');
      return `<div class="${cls}">${escapeHtml(text)}</div>`;
    })
    .join('');
  prev.logKeys = new Set(keys);
  if (s.log.length !== lastLogLen) {
    box.scrollTop = box.scrollHeight;
    lastLogLen = s.log.length;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
