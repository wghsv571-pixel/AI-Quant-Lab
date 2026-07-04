"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const COLORS = {
  navy: "#173b57",
  blue: "#2563eb",
  red: "#e45b5b",
  green: "#2fa37b",
  purple: "#8f4fd1",
  orange: "#f28e2b",
  gray: "#8294a0",
  grid: "#e7edf2",
  text: "#536672",
};

const DEFAULTS = {
  symbol: "00981.HK",
  start: "2025-07-02",
  end: "2026-06-30",
  chartMode: "candle",
  showVolume: true,
  bollinger: { enabled: true, period: 20, multiplier: 2 },
  rsi: { enabled: true, period: 14, upper: 70, lower: 30 },
  macd: { enabled: true, fast: 12, slow: 26, signal: 9 },
  atr: { enabled: true, period: 14 },
};

const state = {
  symbol: DEFAULTS.symbol,
  start: DEFAULTS.start,
  end: DEFAULTS.end,
  chartMode: DEFAULTS.chartMode,
  showVolume: DEFAULTS.showVolume,
  parameters: structuredClone({
    bollinger: DEFAULTS.bollinger,
    rsi: DEFAULTS.rsi,
    macd: DEFAULTS.macd,
    atr: DEFAULTS.atr,
  }),
  prices: [],
  indicators: null,
  meta: null,
  displayStart: 0,
  displayEnd: 0,
  viewStart: 0,
  viewEnd: 0,
  hoverIndex: null,
  dragging: false,
  dragStartX: 0,
  dragViewStart: 0,
  requestController: null,
};

const canvas = $("#indicator-chart");
const context = canvas.getContext("2d");
const chartWrap = $("#chart-wrap");
const tooltip = $("#chart-tooltip");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";
}

function compactNumber(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return Math.round(value).toLocaleString("zh-CN");
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

function setStatus(message, kind = "loading") {
  const banner = $("#status-banner");
  banner.textContent = message;
  banner.className = `status-banner ${kind}`;
}

function parseUrlState() {
  const query = new URLSearchParams(location.search);
  const symbol = query.get("symbol")?.toUpperCase();
  if (symbol) state.symbol = symbol;
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.get("start") || "")) state.start = query.get("start");
  if (/^\d{4}-\d{2}-\d{2}$/.test(query.get("end") || "")) state.end = query.get("end");
  if (["candle", "line"].includes(query.get("mode"))) state.chartMode = query.get("mode");

  const assignInt = (key, object, field, min, max) => {
    const value = Number(query.get(key));
    if (Number.isInteger(value) && value >= min && value <= max) object[field] = value;
  };
  const assignFloat = (key, object, field, min, max) => {
    const value = Number(query.get(key));
    if (Number.isFinite(value) && value >= min && value <= max) object[field] = value;
  };
  assignInt("rsi", state.parameters.rsi, "period", 2, 100);
  assignInt("rsiUpper", state.parameters.rsi, "upper", 2, 99);
  assignInt("rsiLower", state.parameters.rsi, "lower", 1, 98);
  assignInt("macdFast", state.parameters.macd, "fast", 2, 60);
  assignInt("macdSlow", state.parameters.macd, "slow", 3, 120);
  assignInt("macdSignal", state.parameters.macd, "signal", 2, 60);
  assignInt("bb", state.parameters.bollinger, "period", 2, 120);
  assignFloat("bbMultiplier", state.parameters.bollinger, "multiplier", 0.5, 5);
  assignInt("atr", state.parameters.atr, "period", 2, 100);

  ["rsi", "macd", "bollinger", "atr"].forEach((name) => {
    const value = query.get(`show${name[0].toUpperCase()}${name.slice(1)}`);
    if (value === "0") state.parameters[name].enabled = false;
  });
}

function updateUrl() {
  const query = new URLSearchParams();
  query.set("symbol", state.symbol);
  query.set("start", state.start);
  query.set("end", state.end);
  query.set("mode", state.chartMode);
  query.set("rsi", state.parameters.rsi.period);
  query.set("rsiUpper", state.parameters.rsi.upper);
  query.set("rsiLower", state.parameters.rsi.lower);
  query.set("macdFast", state.parameters.macd.fast);
  query.set("macdSlow", state.parameters.macd.slow);
  query.set("macdSignal", state.parameters.macd.signal);
  query.set("bb", state.parameters.bollinger.period);
  query.set("bbMultiplier", state.parameters.bollinger.multiplier);
  query.set("atr", state.parameters.atr.period);
  ["rsi", "macd", "bollinger", "atr"].forEach((name) => {
    if (!state.parameters[name].enabled) query.set(`show${name[0].toUpperCase()}${name.slice(1)}`, "0");
  });
  history.replaceState(null, "", `${location.pathname}?${query}`);
}

function syncControlsFromState() {
  $("#start-date").value = state.start;
  $("#end-date").value = state.end;
  $("#show-volume").checked = state.showVolume;
  $("#show-bollinger").checked = state.parameters.bollinger.enabled;
  $("#show-rsi").checked = state.parameters.rsi.enabled;
  $("#show-macd").checked = state.parameters.macd.enabled;
  $("#show-atr").checked = state.parameters.atr.enabled;

  const values = {
    "bb-period": state.parameters.bollinger.period,
    "bb-period-range": state.parameters.bollinger.period,
    "bb-multiplier": state.parameters.bollinger.multiplier,
    "bb-multiplier-range": state.parameters.bollinger.multiplier,
    "rsi-period": state.parameters.rsi.period,
    "rsi-period-range": state.parameters.rsi.period,
    "rsi-upper": state.parameters.rsi.upper,
    "rsi-lower": state.parameters.rsi.lower,
    "macd-fast": state.parameters.macd.fast,
    "macd-slow": state.parameters.macd.slow,
    "macd-signal": state.parameters.macd.signal,
    "atr-period": state.parameters.atr.period,
    "atr-period-range": state.parameters.atr.period,
  };
  Object.entries(values).forEach(([id, value]) => { $(`#${id}`).value = value; });
  $("#chart-candle").classList.toggle("active", state.chartMode === "candle");
  $("#chart-line").classList.toggle("active", state.chartMode === "line");
}

function readParameters() {
  const next = {
    bollinger: {
      enabled: $("#show-bollinger").checked,
      period: numeric($("#bb-period").value),
      multiplier: numeric($("#bb-multiplier").value),
    },
    rsi: {
      enabled: $("#show-rsi").checked,
      period: numeric($("#rsi-period").value),
      upper: numeric($("#rsi-upper").value),
      lower: numeric($("#rsi-lower").value),
    },
    macd: {
      enabled: $("#show-macd").checked,
      fast: numeric($("#macd-fast").value),
      slow: numeric($("#macd-slow").value),
      signal: numeric($("#macd-signal").value),
    },
    atr: { enabled: $("#show-atr").checked, period: numeric($("#atr-period").value) },
  };

  const macdValid = next.macd.fast < next.macd.slow;
  const rsiValid = next.rsi.lower < next.rsi.upper;
  $("#macd-error").hidden = macdValid;
  $("#rsi-upper").setCustomValidity(rsiValid ? "" : "上界必须大于下界");
  $("#rsi-lower").setCustomValidity(rsiValid ? "" : "下界必须小于上界");
  return macdValid && rsiValid ? next : null;
}

function recompute() {
  const parameters = readParameters();
  if (!parameters || !state.prices.length) return;
  state.parameters = parameters;
  $("#recompute-state").textContent = "计算中";
  state.indicators = window.IndicatorMath.compute(state.prices, state.parameters);
  updateUrl();
  updateInsightPanel();
  renderChart();
  requestAnimationFrame(() => { $("#recompute-state").textContent = "实时"; });
}

const scheduleRecompute = debounce(recompute, 250);

function bindPairedInput(rangeId, numberId) {
  const range = $(`#${rangeId}`);
  const number = $(`#${numberId}`);
  range.addEventListener("input", () => { number.value = range.value; scheduleRecompute(); });
  number.addEventListener("input", () => { range.value = number.value; scheduleRecompute(); });
}

async function loadPrices({ refresh = false } = {}) {
  if (state.requestController) state.requestController.abort();
  state.requestController = new AbortController();
  setStatus(`正在获取 ${state.symbol} 日线行情…`, "loading");
  $("#data-status-dot").classList.remove("ready");

  try {
    const query = new URLSearchParams({ start: state.start, end: state.end, warmup: "180" });
    if (refresh) query.set("refresh", "1");
    const response = await fetch(`/api/prices/${encodeURIComponent(state.symbol)}?${query}`, {
      signal: state.requestController.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "行情加载失败");

    state.prices = payload.prices;
    state.meta = payload.meta;
    state.indicators = window.IndicatorMath.compute(state.prices, state.parameters);
    state.displayStart = Math.max(0, state.prices.findIndex((row) => row.date >= state.start));
    const endIndex = state.prices.findLastIndex((row) => row.date <= state.end);
    state.displayEnd = endIndex >= 0 ? endIndex : state.prices.length - 1;
    state.viewStart = state.displayStart;
    state.viewEnd = state.displayEnd;
    state.hoverIndex = null;

    updateHeader();
    updateInsightPanel();
    updateUrl();
    renderChart();
    setStatus(`${state.meta.source} · ${state.displayEnd - state.displayStart + 1} 个交易日 · ${state.meta.available_end} 更新`, "success");
    $("#data-status-dot").classList.add("ready");
  } catch (error) {
    if (error.name === "AbortError") return;
    setStatus(error.message, "error");
    showToast(error.message);
  }
}

function updateHeader() {
  const meta = state.meta;
  if (!meta) return;
  const label = `${meta.symbol}  ${meta.name}`;
  $("#selected-stock").textContent = label;
  $("#workspace-title").textContent = label;
  $("#market-meta").textContent = `${meta.adjustment} · ${meta.currency === "HKD" ? "港元" : "人民币"} · ${meta.market}`;
}

function latestValidIndex() {
  if (!state.indicators) return -1;
  for (let i = state.displayEnd; i >= state.displayStart; i -= 1) {
    const values = [
      state.indicators.rsi[i],
      state.indicators.macd.line[i],
      state.indicators.macd.signal[i],
      state.indicators.bollinger.middle[i],
      state.indicators.atr.values[i],
    ];
    if (values.every(Number.isFinite)) return i;
  }
  return -1;
}

function updateInsightPanel() {
  if (!state.meta || !state.indicators) return;
  const index = latestValidIndex();
  if (index < 0) {
    $("#latest-date").textContent = "样本不足，指标仍在预热";
    $("#metric-cards").innerHTML = "";
    return;
  }

  const row = state.prices[index];
  const data = state.indicators;
  $("#latest-date").textContent = `${row.date} · 最新有效交易日`;
  $("#metric-cards").innerHTML = `
    <article class="metric-card">
      <header><h3>收盘价</h3><strong>${formatNumber(row.close)} ${state.meta.currency}</strong></header>
      <dl><div><dt>最高 / 最低</dt><dd>${formatNumber(row.high)} / ${formatNumber(row.low)}</dd></div><div><dt>成交量</dt><dd>${compactNumber(row.volume)}</dd></div></dl>
    </article>
    <article class="metric-card">
      <header><h3>布林带 (${state.parameters.bollinger.period}, ${state.parameters.bollinger.multiplier})</h3><strong>${formatNumber(data.bollinger.middle[index])}</strong></header>
      <dl><div><dt>上轨</dt><dd>${formatNumber(data.bollinger.upper[index])}</dd></div><div><dt>下轨</dt><dd>${formatNumber(data.bollinger.lower[index])}</dd></div></dl>
    </article>
    <article class="metric-card">
      <header><h3>RSI(${state.parameters.rsi.period})</h3><strong>${formatNumber(data.rsi[index])}</strong></header>
      <dl><div><dt>参考线</dt><dd>${state.parameters.rsi.lower} / ${state.parameters.rsi.upper}</dd></div></dl>
    </article>
    <article class="metric-card">
      <header><h3>MACD</h3><strong>${formatNumber(data.macd.histogram[index])}</strong></header>
      <dl><div><dt>快慢线差</dt><dd>${formatNumber(data.macd.line[index])}</dd></div><div><dt>信号线</dt><dd>${formatNumber(data.macd.signal[index])}</dd></div></dl>
    </article>
    <article class="metric-card">
      <header><h3>ATR(${state.parameters.atr.period})</h3><strong>${formatNumber(data.atr.values[index])}</strong></header>
      <dl><div><dt>占收盘价</dt><dd>${formatNumber(data.atr.values[index] / row.close * 100)}%</dd></div></dl>
    </article>`;

  const visibleCount = state.displayEnd - state.displayStart + 1;
  $("#quality-count").textContent = `${visibleCount} 个`;
  $("#quality-range").textContent = `${state.start.slice(2)} – ${state.end.slice(2)}`;
  $("#quality-source").textContent = state.meta.source;

  const rsiValue = data.rsi[index];
  const rsiText = rsiValue > state.parameters.rsi.upper ? "RSI 高于上参考线，处于偏强观察区。" : rsiValue < state.parameters.rsi.lower ? "RSI 低于下参考线，处于偏弱观察区。" : "RSI 位于上下参考线之间。";
  const macdText = data.macd.histogram[index] >= 0 ? "MACD 柱为正，快慢趋势差高于信号线。" : "MACD 柱为负，快慢趋势差低于信号线。";
  const bandText = row.close > data.bollinger.upper[index] ? "收盘价高于布林带上轨。" : row.close < data.bollinger.lower[index] ? "收盘价低于布林带下轨。" : "收盘价位于布林带上下轨之间。";
  const atrWindow = data.atr.values.slice(Math.max(state.displayStart, index - 19), index + 1).filter(Number.isFinite).sort((a, b) => a - b);
  const atrMedian = atrWindow[Math.floor(atrWindow.length / 2)];
  const atrText = `ATR ${data.atr.values[index] > atrMedian ? "高于" : "不高于"}近 20 个有效日中位数，只描述波动幅度。`;
  $("#interpretation-list").innerHTML = [rsiText, macdText, bandText, atrText].map((text) => `<li>${text}</li>`).join("");
}

function resizeCanvas() {
  const rect = chartWrap.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  renderChart();
}

function chartPanels(width, height) {
  const top = 14;
  const bottom = 30;
  const left = 12;
  const right = 55;
  const enabled = [
    { name: "price", weight: 3.1 },
    ...(state.parameters.rsi.enabled ? [{ name: "rsi", weight: 1.15 }] : []),
    ...(state.parameters.macd.enabled ? [{ name: "macd", weight: 1.35 }] : []),
    ...(state.parameters.atr.enabled ? [{ name: "atr", weight: 1.15 }] : []),
  ];
  const gap = 12;
  const availableHeight = height - top - bottom - gap * (enabled.length - 1);
  const totalWeight = enabled.reduce((sum, panel) => sum + panel.weight, 0);
  let y = top;
  return enabled.map((panel) => {
    const panelHeight = availableHeight * panel.weight / totalWeight;
    const result = { ...panel, x: left, y, width: width - left - right, height: panelHeight };
    y += panelHeight + gap;
    return result;
  });
}

function visibleRange() {
  const start = clamp(Math.round(state.viewStart), state.displayStart, state.displayEnd);
  const end = clamp(Math.round(state.viewEnd), start, state.displayEnd);
  return { start, end, count: Math.max(1, end - start + 1) };
}

function finiteExtent(values, padding = 0.08) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return { min: 0, max: 1 };
  let min = Math.min(...valid);
  let max = Math.max(...valid);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * padding;
  return { min: min - pad, max: max + pad };
}

function drawPanelFrame(panel, extent, label) {
  context.save();
  context.strokeStyle = COLORS.grid;
  context.lineWidth = 1;
  context.font = "11px PingFang SC, sans-serif";
  context.fillStyle = COLORS.text;
  context.fillText(label, panel.x + 6, panel.y + 14);
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = panel.y + panel.height * tick / 4;
    context.beginPath();
    context.moveTo(panel.x, y);
    context.lineTo(panel.x + panel.width, y);
    context.stroke();
    const value = extent.max - (extent.max - extent.min) * tick / 4;
    context.fillText(formatNumber(value, Math.abs(value) < 10 ? 2 : 1), panel.x + panel.width + 7, y + 4);
  }
  context.restore();
}

function renderLine(panel, values, extent, color, lineWidth = 1.5, dashed = false) {
  const range = visibleRange();
  const xFor = (index) => panel.x + (index - range.start + 0.5) / range.count * panel.width;
  const yFor = (value) => panel.y + (extent.max - value) / (extent.max - extent.min) * panel.height;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  if (dashed) context.setLineDash([5, 4]);
  context.beginPath();
  let started = false;
  for (let index = range.start; index <= range.end; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) { started = false; continue; }
    const x = xFor(index);
    const y = yFor(value);
    if (!started) { context.moveTo(x, y); started = true; } else context.lineTo(x, y);
  }
  context.stroke();
  context.restore();
}

function renderPricePanel(panel) {
  const range = visibleRange();
  const rows = state.prices.slice(range.start, range.end + 1);
  const bandValues = state.parameters.bollinger.enabled
    ? [...state.indicators.bollinger.upper.slice(range.start, range.end + 1), ...state.indicators.bollinger.lower.slice(range.start, range.end + 1)]
    : [];
  const extent = finiteExtent([...rows.flatMap((row) => [row.low, row.high]), ...bandValues], 0.07);
  drawPanelFrame(panel, extent, `${state.meta.symbol} · ${state.chartMode === "candle" ? "K线" : "收盘价"}${state.parameters.bollinger.enabled ? ` · 布林带(${state.parameters.bollinger.period}, ${state.parameters.bollinger.multiplier})` : ""}`);

  const xFor = (index) => panel.x + (index - range.start + 0.5) / range.count * panel.width;
  const yFor = (value) => panel.y + (extent.max - value) / (extent.max - extent.min) * panel.height;
  const candleWidth = clamp(panel.width / range.count * 0.62, 1, 9);

  if (state.parameters.bollinger.enabled) {
    context.save();
    context.fillStyle = "rgba(111, 146, 166, 0.13)";
    context.beginPath();
    let hasBand = false;
    for (let index = range.start; index <= range.end; index += 1) {
      const value = state.indicators.bollinger.upper[index];
      if (!Number.isFinite(value)) continue;
      const x = xFor(index); const y = yFor(value);
      if (!hasBand) { context.moveTo(x, y); hasBand = true; } else context.lineTo(x, y);
    }
    for (let index = range.end; index >= range.start; index -= 1) {
      const value = state.indicators.bollinger.lower[index];
      if (Number.isFinite(value)) context.lineTo(xFor(index), yFor(value));
    }
    if (hasBand) { context.closePath(); context.fill(); }
    context.restore();
    renderLine(panel, state.indicators.bollinger.upper, extent, "#7f97a4", 1, true);
    renderLine(panel, state.indicators.bollinger.middle, extent, COLORS.orange, 1.25);
    renderLine(panel, state.indicators.bollinger.lower, extent, "#7f97a4", 1, true);
  }

  if (state.showVolume) {
    const maxVolume = Math.max(...rows.map((row) => row.volume));
    context.save();
    context.globalAlpha = 0.28;
    rows.forEach((row, offset) => {
      const height = row.volume / maxVolume * panel.height * 0.18;
      context.fillStyle = row.close >= row.open ? COLORS.red : COLORS.green;
      context.fillRect(xFor(range.start + offset) - candleWidth / 2, panel.y + panel.height - height, candleWidth, height);
    });
    context.restore();
  }

  if (state.chartMode === "line") {
    renderLine(panel, state.prices.map((row) => row.close), extent, COLORS.navy, 1.8);
  } else {
    context.save();
    rows.forEach((row, offset) => {
      const x = xFor(range.start + offset);
      const color = row.close >= row.open ? COLORS.red : COLORS.green;
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, yFor(row.high));
      context.lineTo(x, yFor(row.low));
      context.stroke();
      const top = yFor(Math.max(row.open, row.close));
      const bottom = yFor(Math.min(row.open, row.close));
      const bodyHeight = Math.max(1, bottom - top);
      if (row.close >= row.open) context.fillRect(x - candleWidth / 2, top, candleWidth, bodyHeight);
      else context.fillRect(x - candleWidth / 2, top, candleWidth, bodyHeight);
    });
    context.restore();
  }
}

function renderRsiPanel(panel) {
  const extent = { min: 0, max: 100 };
  drawPanelFrame(panel, extent, `RSI(${state.parameters.rsi.period})`);
  const reference = (value, color, dashed = true) => {
    renderLine(panel, state.prices.map(() => value), extent, color, 1, dashed);
  };
  reference(state.parameters.rsi.upper, COLORS.red);
  reference(50, COLORS.gray, true);
  reference(state.parameters.rsi.lower, COLORS.green);
  renderLine(panel, state.indicators.rsi, extent, COLORS.purple, 1.45);
}

function renderMacdPanel(panel) {
  const range = visibleRange();
  const values = [
    ...state.indicators.macd.line.slice(range.start, range.end + 1),
    ...state.indicators.macd.signal.slice(range.start, range.end + 1),
    ...state.indicators.macd.histogram.slice(range.start, range.end + 1),
    0,
  ];
  const extent = finiteExtent(values, 0.12);
  drawPanelFrame(panel, extent, `MACD(${state.parameters.macd.fast}, ${state.parameters.macd.slow}, ${state.parameters.macd.signal})`);
  const xFor = (index) => panel.x + (index - range.start + 0.5) / range.count * panel.width;
  const yFor = (value) => panel.y + (extent.max - value) / (extent.max - extent.min) * panel.height;
  const zeroY = yFor(0);
  const barWidth = clamp(panel.width / range.count * 0.7, 1, 7);
  context.save();
  for (let index = range.start; index <= range.end; index += 1) {
    const value = state.indicators.macd.histogram[index];
    if (!Number.isFinite(value)) continue;
    context.fillStyle = value >= 0 ? "rgba(228,91,91,.72)" : "rgba(47,163,123,.72)";
    const y = yFor(value);
    context.fillRect(xFor(index) - barWidth / 2, Math.min(zeroY, y), barWidth, Math.max(1, Math.abs(zeroY - y)));
  }
  context.restore();
  renderLine(panel, state.indicators.macd.line, extent, COLORS.blue, 1.35);
  renderLine(panel, state.indicators.macd.signal, extent, COLORS.orange, 1.35);
}

function renderAtrPanel(panel) {
  const range = visibleRange();
  const extent = finiteExtent(state.indicators.atr.values.slice(range.start, range.end + 1), 0.12);
  drawPanelFrame(panel, extent, `ATR(${state.parameters.atr.period})`);
  renderLine(panel, state.indicators.atr.values, extent, COLORS.red, 1.45);
}

function renderXAxis(panel) {
  const range = visibleRange();
  context.save();
  context.fillStyle = COLORS.text;
  context.strokeStyle = COLORS.grid;
  context.font = "10px PingFang SC, sans-serif";
  const ticks = Math.min(8, range.count);
  for (let tick = 0; tick < ticks; tick += 1) {
    const index = Math.round(range.start + (range.count - 1) * tick / Math.max(1, ticks - 1));
    const x = panel.x + (index - range.start + 0.5) / range.count * panel.width;
    context.beginPath(); context.moveTo(x, panel.y + panel.height); context.lineTo(x, panel.y + panel.height + 4); context.stroke();
    context.fillText(state.prices[index].date.slice(2, 7), x - 16, panel.y + panel.height + 17);
  }
  context.restore();
}

function renderCrosshair(panels) {
  if (state.hoverIndex === null) return;
  const range = visibleRange();
  if (state.hoverIndex < range.start || state.hoverIndex > range.end) return;
  const x = panels[0].x + (state.hoverIndex - range.start + 0.5) / range.count * panels[0].width;
  context.save();
  context.strokeStyle = "rgba(23,59,87,.48)";
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(x, panels[0].y);
  context.lineTo(x, panels.at(-1).y + panels.at(-1).height);
  context.stroke();
  context.restore();
}

function renderChart() {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  if (!width || !height) return;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  if (!state.prices.length || !state.indicators || !state.meta) return;

  const panels = chartPanels(width, height);
  panels.forEach((panel) => {
    if (panel.name === "price") renderPricePanel(panel);
    if (panel.name === "rsi") renderRsiPanel(panel);
    if (panel.name === "macd") renderMacdPanel(panel);
    if (panel.name === "atr") renderAtrPanel(panel);
  });
  renderXAxis(panels.at(-1));
  renderCrosshair(panels);
}

function pointerIndex(event) {
  const rect = canvas.getBoundingClientRect();
  const range = visibleRange();
  const panel = chartPanels(rect.width, rect.height)[0];
  const x = event.clientX - rect.left;
  if (x < panel.x || x > panel.x + panel.width) return null;
  return clamp(Math.floor((x - panel.x) / panel.width * range.count + range.start), range.start, range.end);
}

function updateTooltip(event, index) {
  if (index === null || !state.indicators) { tooltip.hidden = true; return; }
  const row = state.prices[index];
  const data = state.indicators;
  tooltip.innerHTML = `<strong>${row.date}</strong><br>开 ${formatNumber(row.open)}　高 ${formatNumber(row.high)}<br>低 ${formatNumber(row.low)}　收 ${formatNumber(row.close)}<br>量 ${compactNumber(row.volume)}<br>RSI ${formatNumber(data.rsi[index])}　MACD ${formatNumber(data.macd.histogram[index])}<br>ATR ${formatNumber(data.atr.values[index])}`;
  tooltip.hidden = false;
  const wrapRect = chartWrap.getBoundingClientRect();
  const left = clamp(event.clientX - wrapRect.left + 12, 6, wrapRect.width - tooltip.offsetWidth - 6);
  const top = clamp(event.clientY - wrapRect.top + 12, 6, wrapRect.height - tooltip.offsetHeight - 6);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function selectStock(item) {
  state.symbol = item.symbol;
  $("#stock-search").value = "";
  $("#search-results").hidden = true;
  loadPrices();
}

async function searchStocks(query) {
  const results = $("#search-results");
  try {
    const response = await fetch(`/api/stocks/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    results.innerHTML = payload.items.length ? payload.items.map((item) => `
      <button class="search-result" type="button" data-symbol="${item.symbol}" data-name="${item.name}" data-market="${item.market}" data-currency="${item.currency}">
        <strong>${item.symbol}</strong><small>${item.market}</small><span>${item.name}</span><small>${item.currency}</small>
      </button>`).join("") : `<div class="search-empty">未找到结果。可直接输入带市场后缀的代码，例如 00700.HK。</div>`;
    results.hidden = false;
    $("#stock-search").setAttribute("aria-expanded", "true");
  } catch {
    results.hidden = true;
  }
}

function applyPreset(value) {
  if (value === "custom") { $("#date-panel").hidden = false; return; }
  $("#date-panel").hidden = true;
  const end = new Date();
  const start = new Date(end);
  const months = { "3m": 3, "6m": 6, "1y": 12, "3y": 36 }[value] || 12;
  start.setMonth(start.getMonth() - months);
  const iso = (date) => date.toISOString().slice(0, 10);
  state.start = iso(start);
  state.end = iso(end);
  syncControlsFromState();
  loadPrices();
}

function resetZoom() {
  state.viewStart = state.displayStart;
  state.viewEnd = state.displayEnd;
  renderChart();
}

function exportPng() {
  const link = document.createElement("a");
  link.download = `${state.symbol.replace(".", "_")}_indicators.png`;
  link.href = canvas.toDataURL("image/png", 1);
  link.click();
  $("#export-options").hidden = true;
}

function exportCsv() {
  if (!state.prices.length) return;
  const rows = [["trade_date", "open", "high", "low", "close", "volume", "rsi", "macd", "macd_signal", "macd_hist", "bb_mid", "bb_upper", "bb_lower", "tr", "atr"]];
  for (let index = state.displayStart; index <= state.displayEnd; index += 1) {
    const row = state.prices[index];
    const indicator = state.indicators;
    rows.push([
      row.date, row.open, row.high, row.low, row.close, row.volume,
      indicator.rsi[index] ?? "", indicator.macd.line[index] ?? "", indicator.macd.signal[index] ?? "", indicator.macd.histogram[index] ?? "",
      indicator.bollinger.middle[index] ?? "", indicator.bollinger.upper[index] ?? "", indicator.bollinger.lower[index] ?? "",
      indicator.atr.tr[index] ?? "", indicator.atr.values[index] ?? "",
    ]);
  }
  const blob = new Blob(["\uFEFF" + rows.map((row) => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.symbol.replace(".", "_")}_indicators.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  $("#export-options").hidden = true;
}

function bindEvents() {
  bindPairedInput("bb-period-range", "bb-period");
  bindPairedInput("bb-multiplier-range", "bb-multiplier");
  bindPairedInput("rsi-period-range", "rsi-period");
  bindPairedInput("atr-period-range", "atr-period");

  $$(".indicator-control input").forEach((input) => input.addEventListener("input", scheduleRecompute));
  $$(".indicator-control input[type='checkbox']").forEach((input) => input.addEventListener("change", recompute));

  $("#reset-params").addEventListener("click", () => {
    if (!confirm("恢复四个指标的默认参数？股票和日期区间将保留。")) return;
    state.parameters = structuredClone({ bollinger: DEFAULTS.bollinger, rsi: DEFAULTS.rsi, macd: DEFAULTS.macd, atr: DEFAULTS.atr });
    syncControlsFromState();
    recompute();
  });

  $("#chart-candle").addEventListener("click", () => { state.chartMode = "candle"; syncControlsFromState(); updateUrl(); renderChart(); });
  $("#chart-line").addEventListener("click", () => { state.chartMode = "line"; syncControlsFromState(); updateUrl(); renderChart(); });
  $("#show-volume").addEventListener("change", (event) => { state.showVolume = event.target.checked; renderChart(); });
  $("#reset-zoom").addEventListener("click", resetZoom);

  const search = $("#stock-search");
  const scheduleSearch = debounce((value) => searchStocks(value), 180);
  search.addEventListener("focus", () => searchStocks(search.value));
  search.addEventListener("input", () => scheduleSearch(search.value.trim()));
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = $(".search-result");
      if (first) first.click();
    }
    if (event.key === "Escape") $("#search-results").hidden = true;
  });
  $("#search-results").addEventListener("click", (event) => {
    const button = event.target.closest(".search-result");
    if (!button) return;
    selectStock({ symbol: button.dataset.symbol, name: button.dataset.name, market: button.dataset.market, currency: button.dataset.currency });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".stock-picker")) $("#search-results").hidden = true;
    if (!event.target.closest(".export-menu")) $("#export-options").hidden = true;
  });

  $("#date-preset").addEventListener("change", (event) => applyPreset(event.target.value));
  $("#apply-date").addEventListener("click", () => {
    const start = $("#start-date").value;
    const end = $("#end-date").value;
    if (!start || !end || start > end) { showToast("请检查日期区间"); return; }
    state.start = start; state.end = end; loadPrices();
  });

  $("#export-button").addEventListener("click", () => { $("#export-options").hidden = !$("#export-options").hidden; });
  $("#export-png").addEventListener("click", exportPng);
  $("#export-csv").addEventListener("click", exportCsv);
  $("#share-button").addEventListener("click", async () => {
    updateUrl();
    try { await navigator.clipboard.writeText(location.href); showToast("配置链接已复制"); }
    catch { showToast("无法访问剪贴板，请复制浏览器地址"); }
  });

  canvas.addEventListener("mousemove", (event) => {
    if (!state.prices.length) return;
    if (state.dragging) {
      const range = visibleRange();
      const rect = canvas.getBoundingClientRect();
      const delta = Math.round((state.dragStartX - event.clientX) / rect.width * range.count);
      const span = state.viewEnd - state.viewStart;
      state.viewStart = clamp(state.dragViewStart + delta, state.displayStart, state.displayEnd - span);
      state.viewEnd = state.viewStart + span;
      renderChart();
      return;
    }
    state.hoverIndex = pointerIndex(event);
    updateTooltip(event, state.hoverIndex);
    renderChart();
  });
  canvas.addEventListener("mouseleave", () => { if (!state.dragging) { state.hoverIndex = null; tooltip.hidden = true; renderChart(); } });
  canvas.addEventListener("mousedown", (event) => { state.dragging = true; state.dragStartX = event.clientX; state.dragViewStart = state.viewStart; canvas.style.cursor = "grabbing"; });
  window.addEventListener("mouseup", () => { state.dragging = false; canvas.style.cursor = "crosshair"; });
  canvas.addEventListener("dblclick", resetZoom);
  canvas.addEventListener("wheel", (event) => {
    if (!state.prices.length) return;
    event.preventDefault();
    const range = visibleRange();
    const minCount = Math.min(20, state.displayEnd - state.displayStart + 1);
    const targetCount = clamp(Math.round(range.count * (event.deltaY > 0 ? 1.16 : 0.86)), minCount, state.displayEnd - state.displayStart + 1);
    const rect = canvas.getBoundingClientRect();
    const anchorRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const anchor = range.start + range.count * anchorRatio;
    let start = Math.round(anchor - targetCount * anchorRatio);
    start = clamp(start, state.displayStart, state.displayEnd - targetCount + 1);
    state.viewStart = start;
    state.viewEnd = start + targetCount - 1;
    renderChart();
  }, { passive: false });

  new ResizeObserver(resizeCanvas).observe(chartWrap);
}

function startApp() {
  parseUrlState();
  syncControlsFromState();
  bindEvents();
  resizeCanvas();
  loadPrices();
}

startApp();
