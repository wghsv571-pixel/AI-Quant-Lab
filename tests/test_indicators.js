"use strict";

const assert = require("node:assert/strict");
global.window = global;
require("../static/indicators.js");

const close = [10, 11, 10, 12, 11, 13];
const rsi = global.IndicatorMath.rsi(close, 3);
assert.equal(rsi[0], null);
assert.ok(Math.abs(rsi[3] - 75) < 1e-12);
assert.ok(Math.abs(rsi[4] - 54.54545454545455) < 1e-12);
assert.ok(Math.abs(rsi[5] - 75) < 1e-12);

const sample = [
  { high: 10, low: 8, close: 9 },
  { high: 12, low: 9, close: 10 },
  { high: 11, low: 9, close: 10 },
  { high: 14, low: 10, close: 13 },
];
const atr = global.IndicatorMath.atr(sample, 3);
assert.deepEqual(atr.tr, [2, 3, 2, 4]);
assert.ok(Math.abs(atr.values[2] - 7 / 3) < 1e-12);
assert.ok(Math.abs(atr.values[3] - 26 / 9) < 1e-12);

const series = Array.from({ length: 80 }, (_, index) => 50 + index * 0.2 + Math.sin(index / 4));
const macd = global.IndicatorMath.macd(series, 12, 26, 9);
macd.histogram.forEach((value, index) => {
  if (value !== null) assert.ok(Math.abs(value - (macd.line[index] - macd.signal[index])) < 1e-12);
});

const bands = global.IndicatorMath.bollinger(series, 20, 2);
bands.middle.forEach((value, index) => {
  if (value !== null) {
    assert.ok(bands.upper[index] >= value);
    assert.ok(value >= bands.lower[index]);
  }
});

console.log("indicator tests: all passed");
