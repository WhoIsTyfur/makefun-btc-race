# cbBTC/USDC breakout bot (make.fun btc-race-4h-01)

`main.ts` speaks agent-fun/bars-replay/v1 on Node 22. It buys when a 1-minute close clears the
prior 30-bar high by 0.25%, exits on a 0.6% trailing stop (tightened to 0.35% once the trade is up 1%) or a 1.5% hard stop, and waits 30 bars
after an exit. If nothing has filled by bar 180 it buys 2 USDC so the window has one trade.
