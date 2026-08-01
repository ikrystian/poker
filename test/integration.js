// Test end-to-end: 3 klienty łączą się z serwerem i rozgrywają rozdanie.
import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://localhost:3777';
const TABLE = 'test' + Math.floor(Math.random() * 100000);
const NAMES = ['Ala', 'Bartek', 'Celina'];

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } };
const emit = (sock, ev, data) => new Promise((res) => sock.emit(ev, data, res));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const clients = [];
for (const name of NAMES) {
  const sock = io(URL, { transports: ['websocket'] });
  sock.state = null;
  sock.on('state', (s) => { sock.state = s; });
  await new Promise((r) => sock.on('connect', r));
  const res = await emit(sock, 'join', { tableId: TABLE, name });
  check(res.ok, `dołączenie ${name}: ${res.error || ''}`);
  sock.pid = res.playerId;
  clients.push(sock);
}
await wait(150);

// Czwarty gracz nie powinien się zmieścić.
const extra = io(URL, { transports: ['websocket'] });
await new Promise((r) => extra.on('connect', r));
const full = await emit(extra, 'join', { tableId: TABLE, name: 'Daniel' });
check(!!full.error, 'czwarty gracz powinien zostać odrzucony');
extra.close();

// Wszyscy gotowi → rozdanie rusza.
for (const c of clients) await emit(c, 'ready', true);
await wait(200);

const s0 = clients[0].state;
check(s0.stage === 'preflop', `oczekiwano preflop, jest ${s0.stage}`);
check(s0.pot === 30, `pula po ciemnych powinna wynosić 30, jest ${s0.pot}`);
check(s0.players.length === 3, 'przy stole powinno być 3 graczy');

// Karty własne widoczne, cudze zakryte.
const mine = s0.players.find((p) => p.id === clients[0].pid);
const other = s0.players.find((p) => p.id !== clients[0].pid);
check(mine.cards.every((c) => c && c.r), 'gracz powinien widzieć swoje karty');
check(other.cards.every((c) => c === null), 'karty przeciwnika muszą być zakryte');

// Akcja poza kolejnością musi zostać odrzucona.
const notMyTurn = clients.find((c) => c.state.turnId !== c.pid);
const bad = await emit(notMyTurn, 'action', { action: 'call' });
check(!!bad.error, 'akcja poza kolejnością powinna zostać odrzucona');

// Rozgrywamy rozdanie do końca: wszyscy tylko sprawdzają/czekają.
for (let i = 0; i < 60; i++) {
  const cur = clients.find((c) => c.state && c.state.turnId === c.pid);
  if (!cur) break;
  const me = cur.state.players.find((p) => p.id === cur.pid);
  const toCall = cur.state.currentBet - me.bet;
  await emit(cur, 'action', { action: toCall > 0 ? 'call' : 'check' });
  await wait(30);
}

const end = clients[0].state;
check(end.stage === null, `rozdanie powinno się zakończyć, jest ${end.stage}`);
check(!!end.lastResult, 'brak podsumowania rozdania');
check(end.community.length === 5, `na stole powinno być 5 kart, jest ${end.community.length}`);
check(
  end.players.reduce((s, p) => s + p.chips, 0) === 3000,
  'suma żetonów po rozdaniu powinna wynosić 3000',
);
check(
  end.lastResult.results.some((r) => r.won > 0),
  'ktoś musi wygrać pulę',
);
console.log('Wynik rozdania:', end.lastResult.results.map((r) => `${r.name} ${r.hand || ''} +${r.won}`).join(' | '));

// Rozłączenie i powrót na to samo miejsce.
const pid = clients[2].pid;
clients[2].close();
await wait(200);
const back = io(URL, { transports: ['websocket'] });
await new Promise((r) => back.on('connect', r));
const rejoin = await emit(back, 'join', { tableId: TABLE, name: 'Celina', playerId: pid });
check(rejoin.ok && rejoin.playerId === pid, 'powrót po rozłączeniu powinien odzyskać miejsce');
back.close();

for (const c of clients) c.close();
console.log(failures === 0 ? '✓ Testy integracyjne przeszły.' : `✗ Błędów: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
