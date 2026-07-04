(function (global) {
  "use strict";

  const isNumber = (value) => Number.isFinite(value);

  function ema(values, span) {
    const result = Array(values.length).fill(null);
    const alpha = 2 / (span + 1);
    let current = null;
    let validCount = 0;

    values.forEach((value, index) => {
      if (!isNumber(value)) return;
      current = current === null ? value : alpha * value + (1 - alpha) * current;
      validCount += 1;
      if (validCount >= span) result[index] = current;
    });
    return result;
  }

  function rsi(closes, period) {
    const result = Array(closes.length).fill(null);
    if (closes.length <= period) return result;

    const gains = Array(closes.length).fill(0);
    const losses = Array(closes.length).fill(0);
    for (let i = 1; i < closes.length; i += 1) {
      const delta = closes[i] - closes[i - 1];
      gains[i] = Math.max(delta, 0);
      losses[i] = Math.max(-delta, 0);
    }

    let avgGain = gains.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / period;
    let avgLoss = losses.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / period;

    const valueFor = () => {
      if (avgLoss === 0 && avgGain === 0) return 50;
      if (avgLoss === 0) return 100;
      const rs = avgGain / avgLoss;
      return 100 - 100 / (1 + rs);
    };

    result[period] = valueFor();
    for (let i = period + 1; i < closes.length; i += 1) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      result[i] = valueFor();
    }
    return result;
  }

  function macd(closes, fast, slow, signal) {
    const fastEma = ema(closes, fast);
    const slowEma = ema(closes, slow);
    const line = closes.map((_, index) =>
      isNumber(fastEma[index]) && isNumber(slowEma[index]) ? fastEma[index] - slowEma[index] : null
    );
    const signalLine = ema(line, signal);
    const histogram = line.map((value, index) =>
      isNumber(value) && isNumber(signalLine[index]) ? value - signalLine[index] : null
    );
    return { line, signal: signalLine, histogram };
  }

  function bollinger(closes, period, multiplier) {
    const middle = Array(closes.length).fill(null);
    const upper = Array(closes.length).fill(null);
    const lower = Array(closes.length).fill(null);

    for (let i = period - 1; i < closes.length; i += 1) {
      const window = closes.slice(i - period + 1, i + 1);
      const mean = window.reduce((sum, value) => sum + value, 0) / period;
      const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
      const std = Math.sqrt(variance);
      middle[i] = mean;
      upper[i] = mean + multiplier * std;
      lower[i] = mean - multiplier * std;
    }
    return { middle, upper, lower };
  }

  function atr(prices, period) {
    const tr = prices.map((row, index) => {
      if (index === 0) return row.high - row.low;
      const previousClose = prices[index - 1].close;
      return Math.max(
        row.high - row.low,
        Math.abs(row.high - previousClose),
        Math.abs(row.low - previousClose)
      );
    });
    const values = Array(prices.length).fill(null);
    if (prices.length < period) return { tr, values };

    let current = tr.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    values[period - 1] = current;
    for (let i = period; i < tr.length; i += 1) {
      current = (current * (period - 1) + tr[i]) / period;
      values[i] = current;
    }
    return { tr, values };
  }

  function compute(prices, parameters) {
    const closes = prices.map((row) => row.close);
    return {
      rsi: rsi(closes, parameters.rsi.period),
      macd: macd(closes, parameters.macd.fast, parameters.macd.slow, parameters.macd.signal),
      bollinger: bollinger(closes, parameters.bollinger.period, parameters.bollinger.multiplier),
      atr: atr(prices, parameters.atr.period),
    };
  }

  global.IndicatorMath = { ema, rsi, macd, bollinger, atr, compute };
})(window);

