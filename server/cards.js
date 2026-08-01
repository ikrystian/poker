// Karty reprezentowane jako { r: 2..14, s: 'h'|'d'|'c'|'s' }

export const SUITS = ['s', 'h', 'd', 'c'];
export const RANK_NAMES = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
  9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export function createDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) deck.push({ r, s });
  }
  return deck;
}

export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export const HAND_NAMES = [
  'Wysoka karta',
  'Para',
  'Dwie pary',
  'Trójka',
  'Strit',
  'Kolor',
  'Full',
  'Kareta',
  'Poker',
  'Poker królewski',
];

/**
 * Najlepszy układ 5 kart z 5-7 kart (Texas Hold'em: 2 własne + 5 wspólnych).
 * Zwraca { rank, tiebreak[], name, cards[] }; porównanie leksykograficzne
 * [rank, ...tiebreak] wyznacza silniejszą rękę.
 */
export function evaluateHand(cards) {
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const score = scoreFive(combo);
    if (!best || compareScore(score, best) > 0) best = score;
  }
  return best;
}

export function compareScore(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const n = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < n; i++) {
    const d = (a.tiebreak[i] || 0) - (b.tiebreak[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function* combinations(arr, k) {
  const n = arr.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function scoreFive(cards) {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const suits = cards.map((c) => c.s);
  const isFlush = suits.every((s) => s === suits[0]);

  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    // Koło: A-5-4-3-2 — as liczy się jako 5
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5;
  }

  // Grupowanie po liczności, potem po randze
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()]
    .map(([r, n]) => ({ r, n }))
    .sort((a, b) => b.n - a.n || b.r - a.r);
  const shape = groups.map((g) => g.n).join('');
  const byGroup = groups.map((g) => g.r);

  let rank, tiebreak;
  if (isFlush && straightHigh === 14) {
    rank = 9; tiebreak = [14];
  } else if (isFlush && straightHigh) {
    rank = 8; tiebreak = [straightHigh];
  } else if (shape === '41') {
    rank = 7; tiebreak = byGroup;
  } else if (shape === '32') {
    rank = 6; tiebreak = byGroup;
  } else if (isFlush) {
    rank = 5; tiebreak = ranks;
  } else if (straightHigh) {
    rank = 4; tiebreak = [straightHigh];
  } else if (shape === '311') {
    rank = 3; tiebreak = byGroup;
  } else if (shape === '221') {
    rank = 2; tiebreak = byGroup;
  } else if (shape === '2111') {
    rank = 1; tiebreak = byGroup;
  } else {
    rank = 0; tiebreak = ranks;
  }

  return { rank, tiebreak, name: HAND_NAMES[rank], cards };
}
