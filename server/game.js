import { createDeck, shuffle, evaluateHand, compareScore } from './cards.js';

export const STAGES = ['preflop', 'flop', 'turn', 'river', 'showdown'];

const START_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const MAX_PLAYERS = 3;
const TURN_SECONDS = 45;

export class Table {
  constructor(id) {
    this.id = id;
    this.players = [];        // { id, name, chips, cards, ... }
    this.deck = [];
    this.community = [];
    this.pots = [];           // [{ amount, eligible: [playerId] }]
    this.stage = null;        // null = brak rozdania
    this.dealerIdx = -1;
    this.turnIdx = -1;
    this.currentBet = 0;
    this.minRaise = BIG_BLIND;
    this.handNo = 0;
    this.log = [];
    this.lastResult = null;   // podsumowanie ostatniego rozdania
    this.deadline = 0;        // timestamp końca tury
    this.smallBlind = SMALL_BLIND;
    this.bigBlind = BIG_BLIND;
  }

  // ---------- gracze ----------

  addPlayer(id, name) {
    if (this.players.length >= MAX_PLAYERS) return { error: 'Stół jest pełny (max 3 graczy).' };
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return { error: 'Gracz o tej nazwie już siedzi przy stole.' };
    }
    this.players.push({
      id,
      name,
      chips: START_CHIPS,
      cards: [],
      bet: 0,            // postawione w bieżącej rundzie
      committed: 0,      // postawione w całym rozdaniu
      folded: false,
      allIn: false,
      acted: false,
      inHand: false,
      connected: true,
      ready: false,
    });
    this.pushLog(`${name} dołącza do stołu.`);
    return { ok: true };
  }

  removePlayer(id) {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const p = this.players[idx];
    this.pushLog(`${p.name} opuszcza stół.`);

    if (this.stage && p.inHand && !p.folded) {
      // Traktujemy odejście jak spasowanie, żeby rozdanie mogło się dokończyć.
      p.folded = true;
      p.acted = true;
    }
    const wasTurn = this.turnIdx === idx;
    this.players.splice(idx, 1);
    if (this.dealerIdx >= idx) this.dealerIdx--;
    if (this.turnIdx > idx) this.turnIdx--;

    if (this.stage) {
      if (this.players.filter((p) => p.inHand && !p.folded).length <= 1) {
        this.finishHand();
      } else if (wasTurn) {
        this.advanceTurn();
      }
    }
    if (this.players.length === 0) this.stage = null;
  }

  setReady(id, ready) {
    const p = this.players.find((x) => x.id === id);
    if (p) p.ready = ready;
  }

  canStart() {
    const eligible = this.players.filter((p) => p.chips > 0);
    return !this.stage && eligible.length >= 2 && eligible.every((p) => p.ready);
  }

  // ---------- rozdanie ----------

  startHand() {
    const active = this.players.filter((p) => p.chips > 0);
    if (active.length < 2) return { error: 'Potrzeba minimum 2 graczy z żetonami.' };

    this.handNo++;
    this.deck = shuffle(createDeck());
    this.community = [];
    this.pots = [];
    this.lastResult = null;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.stage = 'preflop';

    for (const p of this.players) {
      p.cards = [];
      p.bet = 0;
      p.committed = 0;
      p.folded = false;
      p.allIn = false;
      p.acted = false;
      p.inHand = p.chips > 0;
      p.ready = false;
    }

    // Przycisk rozdającego przesuwa się na kolejnego gracza z żetonami.
    this.dealerIdx = this.nextIdx(this.dealerIdx, (p) => p.inHand);
    this.pushLog(`--- Rozdanie #${this.handNo} (rozdaje ${this.players[this.dealerIdx].name}) ---`);

    const inHand = this.seatsInHand();
    // Heads-up: rozdający jest małym ciemnym. Przy 3 graczach: SB = dealer+1.
    const sbIdx = inHand.length === 2
      ? this.dealerIdx
      : this.nextIdx(this.dealerIdx, (p) => p.inHand);
    const bbIdx = this.nextIdx(sbIdx, (p) => p.inHand);

    this.postBlind(sbIdx, this.smallBlind, 'małą ciemną');
    this.postBlind(bbIdx, this.bigBlind, 'dużą ciemną');
    this.currentBet = this.bigBlind;

    for (const p of this.players) {
      if (!p.inHand) continue;
      p.cards = [this.deck.pop(), this.deck.pop()];
    }

    // Preflop pierwszy mówi gracz za dużą ciemną (heads-up: rozdający/SB).
    const headsUp = inHand.length === 2;
    this.turnIdx = this.firstActor(headsUp ? sbIdx : bbIdx, headsUp);
    this.resetDeadline();

    // Ciemne mogły wstawić graczy all-in — wtedy nie ma czego licytować.
    if (this.turnIdx === -1 || this.isBettingClosed()) {
      this.collectBets();
      this.nextStage();
    }
    return { ok: true };
  }

  postBlind(idx, amount, label) {
    const p = this.players[idx];
    const paid = Math.min(amount, p.chips);
    p.chips -= paid;
    p.bet += paid;
    p.committed += paid;
    if (p.chips === 0) p.allIn = true;
    this.pushLog(`${p.name} wpłaca ${label} (${paid}).`);
  }

  seatsInHand() {
    return this.players.filter((p) => p.inHand);
  }

  activePlayers() {
    return this.players.filter((p) => p.inHand && !p.folded);
  }

  canAct(p) {
    return p.inHand && !p.folded && !p.allIn && p.chips > 0;
  }

  /** Pierwszy gracz zdolny do akcji, licząc od miejsca `seat` (opcjonalnie włącznie). */
  firstActor(seat, includeSeat) {
    if (includeSeat && this.players[seat] && this.canAct(this.players[seat])) return seat;
    return this.nextIdx(seat, (p) => this.canAct(p));
  }

  nextIdx(from, pred) {
    const n = this.players.length;
    if (n === 0) return -1;
    for (let i = 1; i <= n; i++) {
      const idx = (from + i + n) % n;
      if (pred(this.players[idx])) return idx;
    }
    return -1;
  }

  resetDeadline() {
    this.deadline = Date.now() + TURN_SECONDS * 1000;
  }

  // ---------- akcje ----------

  /** action: 'fold' | 'check' | 'call' | 'raise' | 'allin'; amount = docelowa wysokość zakładu */
  act(playerId, action, amount) {
    if (!this.stage || this.stage === 'showdown') return { error: 'Rozdanie nie trwa.' };
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return { error: 'Nie ma Cię przy stole.' };
    if (idx !== this.turnIdx) return { error: 'To nie Twoja kolej.' };

    const p = this.players[idx];
    const toCall = this.currentBet - p.bet;

    switch (action) {
      case 'fold':
        p.folded = true;
        this.pushLog(`${p.name} pasuje.`);
        break;

      case 'check':
        if (toCall > 0) return { error: 'Nie możesz czekać — musisz sprawdzić lub spasować.' };
        this.pushLog(`${p.name} czeka.`);
        break;

      case 'call': {
        if (toCall <= 0) return { error: 'Nie ma czego sprawdzać.' };
        const paid = Math.min(toCall, p.chips);
        p.chips -= paid;
        p.bet += paid;
        p.committed += paid;
        if (p.chips === 0) p.allIn = true;
        this.pushLog(`${p.name} sprawdza (${paid})${p.allIn ? ' — all-in' : ''}.`);
        break;
      }

      case 'allin': {
        const paid = p.chips;
        if (paid <= 0) return { error: 'Nie masz żetonów.' };
        const newBet = p.bet + paid;
        p.chips = 0;
        p.bet = newBet;
        p.committed += paid;
        p.allIn = true;
        if (newBet > this.currentBet) {
          // Podbicie poniżej minimum nie otwiera ponownie licytacji dla tych,
          // którzy już zadeklarowali pełną stawkę.
          const raiseBy = newBet - this.currentBet;
          if (raiseBy >= this.minRaise) {
            this.minRaise = raiseBy;
            this.reopenBetting(p);
          }
          this.currentBet = newBet;
        }
        this.pushLog(`${p.name} gra all-in (${newBet}).`);
        break;
      }

      case 'raise': {
        const target = Math.floor(Number(amount));
        if (!Number.isFinite(target)) return { error: 'Nieprawidłowa kwota.' };
        if (target <= this.currentBet) return { error: 'Podbicie musi być wyższe od aktualnego zakładu.' };
        const need = target - p.bet;
        if (need > p.chips) return { error: 'Nie masz tylu żetonów.' };
        const raiseBy = target - this.currentBet;
        if (raiseBy < this.minRaise && need < p.chips) {
          return { error: `Minimalne podbicie to ${this.currentBet + this.minRaise}.` };
        }
        p.chips -= need;
        p.bet = target;
        p.committed += need;
        if (p.chips === 0) p.allIn = true;
        const verb = this.currentBet === 0 ? 'stawia' : 'podbija do';
        this.minRaise = Math.max(this.minRaise, raiseBy);
        this.currentBet = target;
        this.reopenBetting(p);
        this.pushLog(`${p.name} ${verb} ${target}${p.allIn ? ' — all-in' : ''}.`);
        break;
      }

      default:
        return { error: 'Nieznana akcja.' };
    }

    p.acted = true;
    this.advanceTurn();
    return { ok: true };
  }

  /** Po podbiciu pozostali gracze muszą odpowiedzieć ponownie. */
  reopenBetting(raiser) {
    for (const q of this.players) {
      if (q !== raiser && this.canAct(q)) q.acted = false;
    }
  }

  advanceTurn() {
    // Wygrana bez showdownu — został jeden gracz.
    if (this.activePlayers().length <= 1) {
      this.finishHand();
      return;
    }

    if (this.isBettingClosed()) {
      this.collectBets();
      this.nextStage();
      return;
    }

    const next = this.nextIdx(this.turnIdx, (p) => this.canAct(p) && !this.isSettled(p));
    if (next === -1) {
      this.collectBets();
      this.nextStage();
    } else {
      this.turnIdx = next;
      this.resetDeadline();
    }
  }

  isSettled(p) {
    return p.acted && p.bet === this.currentBet;
  }

  isBettingClosed() {
    const contenders = this.players.filter((p) => this.canAct(p));
    if (contenders.length === 0) return true;
    // Jeden gracz przy stole, reszta all-in — nie ma z kim licytować.
    if (contenders.length === 1 && this.activePlayers().length > 1) {
      const solo = contenders[0];
      const maxOther = Math.max(
        ...this.activePlayers().filter((p) => p !== solo).map((p) => p.bet),
      );
      // Pozostali są all-in — nie ma z kim licytować, wystarczy wyrównanie.
      if (solo.bet >= maxOther) return true;
    }
    return contenders.every((p) => this.isSettled(p));
  }

  /** Zbiera zakłady rundy do puli (z podziałem na pule boczne). */
  collectBets() {
    for (const p of this.players) p.bet = 0;
    this.rebuildPots();
  }

  /** Buduje pule główną i boczne na podstawie sumarycznych wkładów w rozdaniu. */
  rebuildPots() {
    const contributors = this.players.filter((p) => p.committed > 0);
    if (contributors.length === 0) {
      this.pots = [];
      return;
    }
    const levels = [...new Set(contributors.map((p) => p.committed))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      const eligible = [];
      for (const p of contributors) {
        if (p.committed >= level) {
          amount += level - prev;
          if (!p.folded) eligible.push(p.id);
        } else if (p.committed > prev) {
          amount += p.committed - prev;
        }
      }
      if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }
    // Scalanie sąsiadujących pul o identycznym gronie uprawnionych.
    this.pots = pots.reduce((acc, pot) => {
      const last = acc[acc.length - 1];
      if (last && last.eligible.join() === pot.eligible.join()) last.amount += pot.amount;
      else acc.push(pot);
      return acc;
    }, []);
  }

  get potTotal() {
    return this.pots.reduce((s, p) => s + p.amount, 0)
      + this.players.reduce((s, p) => s + p.bet, 0);
  }

  nextStage() {
    for (const p of this.players) p.acted = false;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    const stageIdx = STAGES.indexOf(this.stage);
    const next = STAGES[stageIdx + 1];

    if (next === 'flop') {
      this.deck.pop(); // spalona karta
      this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    } else if (next === 'turn' || next === 'river') {
      this.deck.pop();
      this.community.push(this.deck.pop());
    }
    this.stage = next;

    if (next === 'showdown') {
      this.finishHand();
      return;
    }

    this.pushLog(`--- ${next.toUpperCase()}: ${this.community.map(fmt).join(' ')} ---`);

    // Jeśli nikt nie może już licytować (all-iny), dobieramy resztę stołu.
    if (this.players.filter((p) => this.canAct(p)).length < 2) {
      this.nextStage();
      return;
    }

    // Postflop pierwszy mówi gracz za rozdającym.
    this.turnIdx = this.nextIdx(this.dealerIdx, (p) => this.canAct(p));
    this.resetDeadline();
  }

  finishHand() {
    this.collectBets();
    const alive = this.activePlayers();
    const results = [];

    if (alive.length === 1) {
      const winner = alive[0];
      const won = this.potTotal;
      winner.chips += won;
      this.pushLog(`${winner.name} wygrywa ${won} (pozostali spasowali).`);
      results.push({ playerId: winner.id, name: winner.name, won, hand: null });
      this.pots = [];
    } else {
      const scores = new Map();
      for (const p of alive) {
        scores.set(p.id, evaluateHand([...p.cards, ...this.community]));
      }
      const wonBy = new Map();

      for (const pot of this.pots) {
        const contenders = pot.eligible
          .map((id) => this.players.find((p) => p.id === id))
          .filter((p) => p && !p.folded);
        if (contenders.length === 0) continue;

        let best = null;
        let winners = [];
        for (const p of contenders) {
          const sc = scores.get(p.id);
          const cmp = best ? compareScore(sc, best) : 1;
          if (cmp > 0) { best = sc; winners = [p]; }
          else if (cmp === 0) winners.push(p);
        }
        const share = Math.floor(pot.amount / winners.length);
        let remainder = pot.amount - share * winners.length;
        for (const w of winners) {
          // Reszta z niepodzielnej puli trafia do gracza najbliżej rozdającego.
          const extra = remainder > 0 ? 1 : 0;
          if (extra) remainder--;
          w.chips += share + extra;
          wonBy.set(w.id, (wonBy.get(w.id) || 0) + share + extra);
        }
      }

      for (const p of alive) {
        const sc = scores.get(p.id);
        results.push({
          playerId: p.id,
          name: p.name,
          won: wonBy.get(p.id) || 0,
          cards: p.cards,
          hand: sc.name,
          best: sc.cards,   // pięć kart tworzących układ — do podświetlenia w UI
        });
      }
      for (const r of results.filter((r) => r.won > 0)) {
        this.pushLog(`${r.name} wygrywa ${r.won} — ${r.hand}.`);
      }
      this.pots = [];
    }

    this.lastResult = {
      community: [...this.community],
      results: results.sort((a, b) => b.won - a.won),
    };
    this.stage = null;
    this.turnIdx = -1;
    this.deadline = 0;
    for (const p of this.players) {
      p.inHand = false;
      p.ready = false;
      if (p.chips === 0) this.pushLog(`${p.name} nie ma już żetonów.`);
    }
  }

  /** Auto-akcja po przekroczeniu czasu: czekaj jeśli za darmo, inaczej pas. */
  timeoutCurrentPlayer() {
    if (!this.stage || this.turnIdx < 0) return false;
    const p = this.players[this.turnIdx];
    if (!p) return false;
    const toCall = this.currentBet - p.bet;
    this.pushLog(`${p.name} przekroczył czas.`);
    this.act(p.id, toCall > 0 ? 'fold' : 'check');
    return true;
  }

  pushLog(msg) {
    this.log.push({ t: Date.now(), msg });
    if (this.log.length > 200) this.log.shift();
  }

  // ---------- widok dla klienta ----------

  stateFor(viewerId) {
    const showdownOver = !this.stage && this.lastResult;
    return {
      tableId: this.id,
      stage: this.stage,
      handNo: this.handNo,
      community: this.community,
      pot: this.potTotal,
      pots: this.pots.map((p) => p.amount),
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      bigBlind: this.bigBlind,
      dealerIdx: this.dealerIdx,
      turnId: this.turnIdx >= 0 ? this.players[this.turnIdx]?.id : null,
      deadline: this.deadline,
      canStart: this.canStart(),
      lastResult: this.lastResult,
      you: viewerId,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        inHand: p.inHand,
        connected: p.connected,
        ready: p.ready,
        // Karty widoczne tylko dla właściciela; po showdownie — dla wszystkich.
        cards:
          p.id === viewerId || (showdownOver && !p.folded && this.lastResult.results.some((r) => r.playerId === p.id && r.cards))
            ? p.cards
            : p.cards.map(() => null),
      })),
      log: this.log.slice(-40),
    };
  }
}

function fmt(c) {
  const names = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  return (names[c.r] || c.r) + c.s;
}
