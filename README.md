# ♠ Texas Hold'em — gra online dla 3 graczy

Aplikacja webowa do gry w pokera Texas Hold'em przez internet. Trzy osoby wchodzą
na tę samą stronę, wpisują ten sam kod stołu i grają w czasie rzeczywistym.

## Uruchomienie

```bash
npm install
npm start
```

Domyślnie serwer nasłuchuje na <http://localhost:3000>. Inny port:

```bash
PORT=3777 npm start
```

Każdy z graczy otwiera adres serwera, wpisuje swoją nazwę i **ten sam kod stołu**
(domyślnie `stol1`). Rozdanie startuje, gdy wszyscy klikną „Gotowy".

### Gra przez internet

Serwer musi być dostępny dla pozostałych graczy. W sieci lokalnej wystarczy adres IP
komputera-hosta (np. `http://192.168.1.15:3000`). Spoza sieci najprościej użyć tunelu:

```bash
npx localtunnel --port 3000     # albo: cloudflared tunnel --url http://localhost:3000
```

## Zasady zaimplementowane w silniku

- Pełny Texas Hold'em: pre-flop, flop, turn, river, showdown (z paloną kartą przed każdą ulicą).
- Małe/duże ciemne (10/20), przycisk rozdającego przesuwa się co rozdanie.
- Kolejność mówienia: pre-flop pierwszy gracz za dużą ciemną, po flopie pierwszy za rozdającym.
- Heads-up (gdy zostanie 2 graczy): rozdający jest małą ciemną i mówi pierwszy przed flopem.
- Pas / czekam / sprawdzam / podbijam / all-in, z kontrolą minimalnego podbicia.
- Podbicie all-in poniżej minimum nie otwiera ponownie licytacji (zgodnie z zasadami).
- **Pule boczne** przy all-inach o różnych wysokościach; niepodzielna reszta trafia do
  gracza najbliżej rozdającego.
- Rozstrzyganie remisów po kickerach, podział puli przy identycznych układach.
- Strit „na koło" (A-2-3-4-5) liczony poprawnie — as jest wtedy najniższy.

## Funkcje aplikacji

- Komunikacja w czasie rzeczywistym (Socket.IO) — stan stołu u wszystkich naraz.
- Stół z perspektywy gracza: Twoje miejsce zawsze na dole, karty własne w pełnym rozmiarze.
- Pierścień odliczający czas wokół awatara, żeton rozdającego, stosiki żetonów przy zakładach.
- Po showdownie podświetlane jest pięć kart tworzących zwycięski układ (reszta wyszarzona).
- Szybkie stawki (½ puli, ¾ puli, pula) i skróty klawiszowe: **F** pas, **C** sprawdzam/czekam,
  **R** podbijam, **A** all-in.

## Telefony

Aplikacja jest w pełni grywalna na telefonie — nie wymaga instalacji, wystarczy przeglądarka.

- Trzy układy: desktop, telefon w pionie (stół wyższy niż szerszy) i telefon w poziomie
  (stół szeroki i płaski, panel historii z boku). Każdy przetestowany pod kątem tego,
  by miejsca graczy i karty mieściły się w owalu stołu i nigdzie nie było przewijania w bok.
- Karty skalują się płynnie względem szerokości ekranu (`--card-w`), więc pięć kart wspólnych
  mieści się w rzędzie nawet na ekranie 360 px.
- Przyciski akcji mają minimum 44 px wysokości, panel akcji jest „przyklejony" do dołu ekranu,
  więc pozostaje pod ręką po przewinięciu do historii gry.
- Pola liczbowe otwierają klawiaturę numeryczną, a czcionka pól to 16 px — dzięki temu iOS
  nie przybliża strony przy kliknięciu w pole.
- Uwzględniony bezpieczny margines dolny (`safe-area-inset`) na telefonach z paskiem gestów.
- Karty przeciwników są zakryte; serwer nigdy nie wysyła cudzych kart przed showdownem.
- Limit 45 s na ruch — po przekroczeniu automatycznie czekam (jeśli za darmo) albo pas.
- Powrót do gry po odświeżeniu strony lub zerwaniu łącza (60 s na powrót na miejsce).
- Czat i historia rozdania w panelu bocznym.
- Wiele niezależnych stołów jednocześnie — rozróżnianych kodem stołu.

## Struktura

```
server/cards.js   — talia, tasowanie, ocena układów (najlepsze 5 z 7 kart)
server/game.js    — silnik: stan stołu, licytacja, pule, showdown
server/index.js   — serwer HTTP + Socket.IO, pokoje, reconnect, zegar tury
public/           — interfejs (bez frameworków)
test/simulate.js  — testy silnika: ewaluator + tysiące losowych rozdań
test/integration.js — test end-to-end na żywym serwerze (3 klienty)
```

## Testy

```bash
npm test                      # ewaluator układów + losowe rozdania (bilans żetonów)
GAMES=4000 npm test           # dłuższy przebieg (~19 tys. rozdań)

PORT=3777 npm start &         # test integracyjny wymaga działającego serwera
URL=http://localhost:3777 node test/integration.js
```

Test symulacyjny sprawdza po każdym rozdaniu, że suma żetonów przy stole się zgadza,
że nikt nie ma ujemnego stanu i że rozdanie zawsze się kończy.

## Uwagi

- Stan gry trzymany jest w pamięci procesu — restart serwera czyści stoły.
- Gra jest przeznaczona do zabawy między znajomymi: nie ma logowania ani prawdziwych pieniędzy.
