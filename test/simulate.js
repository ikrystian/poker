// Test silnika: losowe rozdania + weryfikacja ewaluatora i bilansu żetonów.
import { Table } from '../server/game.js';
import { evaluateHand, compareScore } from '../server/cards.js';

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
}

// --- 1. Ewaluator układów ---
const C = (str) => str.split(' ').map((t) => {
  const s = t.slice(-1);
  const r = { A: 14, K: 13, Q: 12, J: 11, T: 10 }[t[0]] || Number(t.slice(0, -1));
  return { r, s };
});

const cases = [
  ['As Ks Qs Js Ts 2h 3c', 'Poker królewski'],
  ['9h 8h 7h 6h 5h 2s 3c', 'Poker'],
  ['As 5s 4s 3s 2s 9h Kd', 'Poker'],           // koło w kolorze
  ['7c 7d 7h 7s Kd 2c 3c', 'Kareta'],
  ['Ac Ad Ah Kc Kd 2c 3d', 'Full'],
  ['Ac Tc 8c 5c 2c Kd Qh', 'Kolor'],
  ['Ah 5d 4c 3s 2h Kd Qc', 'Strit'],           // koło
  ['9h 8d 7c 6s 5h Kd Qc', 'Strit'],
  ['4c 4d 4h Kc 2d 7s 9h', 'Trójka'],
  ['Ac Ad Kc Kd 2h 7s 9c', 'Dwie pary'],
  ['Ac Ad Kc 2d 5h 7s 9c', 'Para'],
  ['Ac Kd Qc 2d 5h 7s 9c', 'Wysoka karta'],
];
for (const [hand, expected] of cases) {
  const got = evaluateHand(C(hand)).name;
  check(got === expected, `${hand} → oczekiwano "${expected}", otrzymano "${got}"`);
}

// Koło nie może bić strita do szóstki
check(
  compareScore(evaluateHand(C('Ah 5d 4c 3s 2h')), evaluateHand(C('6h 5d 4c 3s 2h'))) < 0,
  'A-5 (koło) powinno przegrać z 6-high stritem',
);
// Kicker rozstrzyga
check(
  compareScore(evaluateHand(C('Ac Ad Kc 5d 3h')), evaluateHand(C('As Ah Qc 5s 3d'))) > 0,
  'Para asów z królem powinna bić parę asów z damą',
);

// --- 2. Losowe rozdania ---
const ACTIONS = ['fold', 'check', 'call', 'raise', 'allin'];
let handsPlayed = 0;

const GAMES = Number(process.env.GAMES) || 400;
for (let game = 0; game < GAMES; game++) {
  const t = new Table('test');
  // Co trzecia gra na dwóch graczy — sprawdza układ heads-up (rozdający = SB).
  const names = game % 3 === 0 ? ['Ala', 'Bartek'] : ['Ala', 'Bartek', 'Celina'];
  names.forEach((n, i) => t.addPlayer(`p${i}`, n));
  const START_TOTAL = t.players.reduce((s, p) => s + p.chips, 0);

  for (let hand = 0; hand < 25; hand++) {
    if (t.players.filter((p) => p.chips > 0).length < 2) break;
    t.startHand();
    handsPlayed++;

    let guard = 0;
    while (t.stage && guard++ < 500) {
      const p = t.players[t.turnIdx];
      check(!!p, 'tura wskazuje na nieistniejącego gracza');
      if (!p) break;
      check(!p.folded && !p.allIn && p.chips > 0, `${p.name} nie powinien mieć tury`);

      const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
      const target = t.currentBet + t.minRaise + Math.floor(Math.random() * 60);
      const res = t.act(p.id, action, target);
      // Nieprawidłowe akcje są odrzucane — wtedy gramy zachowawczo.
      if (res.error) t.act(p.id, t.currentBet - p.bet > 0 ? 'call' : 'check');
    }

    check(guard < 500, 'rozdanie nie zakończyło się (możliwa pętla)');
    check(t.stage === null, 'rozdanie powinno się zakończyć');
    check(t.pots.length === 0, 'pule powinny zostać rozdzielone');

    const total = t.players.reduce((s, p) => s + p.chips, 0);
    check(total === START_TOTAL, `bilans żetonów: ${total} zamiast ${START_TOTAL}`);
    check(t.players.every((p) => p.chips >= 0), 'ujemny stan żetonów');
  }
}

console.log(`Rozegrano ${handsPlayed} rozdań.`);
console.log(failures === 0 ? '✓ Wszystkie testy przeszły.' : `✗ Błędów: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
