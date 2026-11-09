// Breakout-with-trailing-stop bot for agent-fun/bars-replay/v1 (cbBTC/USDC).
//
// Reads hello, then one batch per 1-minute bar, and answers every batch with
// exactly one reply echoing its seq. Node 22 built-ins only, no clock, no
// randomness: the same input gives the same bytes every run.
import { createInterface } from "node:readline";

const LOOKBACK = 30; // bars in the breakout channel
const ENTRY_MARGIN = 0.0025; // close must clear the channel high by this fraction
const TRAIL = 0.006; // trailing stop from the highest close since entry
const HARD_STOP = 0.015; // stop under the entry close
const COOLDOWN = 30; // bars to wait after an exit before re-entering
const FALLBACK_BAR = 180; // nothing filled by this bar: take a token trade
const FALLBACK_QUOTE = 2_000_000n; // 2 USDC, so the race always has 1 trade
const MIN_NOTIONAL = 1_000_000n;
const BUY_FRACTION_BPS = 9900n;
const BUY_SLIP_BPS = 100;
const SELL_SLIP_BPS = 400;

type Order = Record<string, string | number>;

class Bot {
  symbol: string;
  closes: number[] = [];
  n = 0;
  inTrade = false; // a full-size breakout position is live
  entry = 0;
  peak = 0;
  lastExit = -1e9;
  filledAny = false;
  orderId = 0;

  constructor(hello: any) {
    this.symbol = hello.symbols[0].symbol;
  }

  nextId(side: string): string {
    this.orderId += 1;
    return `${side}-${this.orderId}`;
  }

  onBatch(msg: any): Order[] {
    for (const f of msg.fills ?? []) {
      if (f.status !== "filled") {
        // A rejected breakout buy means no live trade.
        if (f.side === "buy" && f.client_id.startsWith("b-")) this.inTrade = false;
        continue;
      }
      this.filledAny = true;
      if (f.side === "sell") {
        this.inTrade = false;
        this.lastExit = this.n;
      }
    }

    let close = -1;
    for (const b of msg.bars ?? []) if (b.symbol === this.symbol) close = Number(b.c);
    const cash = BigInt(msg.account.cash_quote_units);
    let qty = "0";
    for (const p of msg.account.positions ?? []) if (p.symbol === this.symbol) qty = p.qty;

    const orders: Order[] = [];
    if (close < 0) return orders;
    this.n += 1;
    this.closes.push(close);
    if (this.closes.length > LOOKBACK + 1) this.closes.shift();

    if (this.inTrade && qty !== "0") {
      if (close > this.peak) this.peak = close;
      if (close < this.peak * (1 - TRAIL) || close < this.entry * (1 - HARD_STOP)) {
        orders.push({ side: "sell", client_id: this.nextId("s"), symbol: this.symbol, qty, max_slippage_bps: SELL_SLIP_BPS });
      }
      return orders;
    }

    const hist = this.closes.slice(0, -1);
    if (hist.length >= LOOKBACK && this.n - this.lastExit >= COOLDOWN) {
      const high = Math.max(...hist.slice(-LOOKBACK));
      if (close > high * (1 + ENTRY_MARGIN)) {
        const notional = (cash * BUY_FRACTION_BPS) / 10000n;
        if (notional >= MIN_NOTIONAL) {
          orders.push({ side: "buy", client_id: this.nextId("b"), symbol: this.symbol, notional_quote_units: notional.toString(), max_slippage_bps: BUY_SLIP_BPS });
          this.inTrade = true;
          this.entry = close;
          this.peak = close;
          return orders;
        }
      }
    }

    if (!this.filledAny && this.n === FALLBACK_BAR && cash >= FALLBACK_QUOTE) {
      orders.push({ side: "buy", client_id: this.nextId("f"), symbol: this.symbol, notional_quote_units: FALLBACK_QUOTE.toString(), max_slippage_bps: 500 });
    }
    return orders;
  }
}

let bot: Bot | null = null;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line: string) => {
  const s = line.trim();
  if (!s) return;
  const msg = JSON.parse(s);
  if (msg.type === "hello") {
    bot = new Bot(msg);
  } else if (msg.type === "batch") {
    const orders = bot ? bot.onBatch(msg) : [];
    process.stdout.write(JSON.stringify({ type: "reply", seq: msg.seq, orders }) + "\n");
  } else if (msg.type === "done") {
    rl.close();
  }
});
