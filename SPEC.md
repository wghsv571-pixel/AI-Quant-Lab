# 中芯国际 H 股技术指标分析规格说明

## 1. 项目目标

使用 Python Notebook 对中芯国际 H 股（`00981.HK`）在 2025-07-02 至 2026-06-30 的未复权日线行情进行可复现分析，逐步计算并展示 RSI、MACD、布林带和 ATR。内容仅用于课程学习和数据分析，不构成投资建议。

交付物：

- `smic_hk_indicators.ipynb`：包含配置、数据获取、清洗、公式、计算、验证、图表和结论。
- `data/00981_HK_daily_20250702_20260630.csv`：首次成功调用 Tushare 后自动生成的本地缓存。

## 2. 数据规格

### 2.1 数据源与区间

- 数据源：Tushare Pro 港股日线接口 `hk_daily`。
- 证券代码：`00981.HK`。
- 日期区间：`20250702` 至 `20260630`，首尾均包含。
- 价格口径：未复权，币种为港元。
- 凭证：使用 `python-dotenv` 从项目根目录 `.env` 加载环境变量 `TUSHARE_TOKEN`；Notebook、缓存和输出不得包含 Token，`.env` 必须被 `.gitignore` 排除。
- 缓存：默认优先读取本地 CSV；将 `REFRESH_DATA=True` 时强制调用接口并覆盖缓存。

Tushare 港股日线接口需要单独的数据权限。Token 缺失、依赖缺失、接口无权限、接口返回空数据时，Notebook 必须显示可操作的中文错误信息，不得静默切换到其他数据提供商或伪造数据。

### 2.2 标准字段

最终基础表至少包含：

| 字段 | 含义 | 类型 |
| --- | --- | --- |
| `trade_date` | 交易日 | `datetime64[ns]` |
| `open` | 开盘价 | `float` |
| `high` | 最高价 | `float` |
| `low` | 最低价 | `float` |
| `close` | 收盘价 | `float` |
| `volume` | 成交量，由 Tushare 的 `vol` 或 `volume` 统一命名 | `float` |

允许保留 `pre_close`、`change`、`pct_chg`、`amount` 等可选字段。

### 2.3 清洗与验证

1. 将 `trade_date` 转为日期类型并按升序排列。
2. 过滤到指定区间；同一交易日重复时保留接口返回中的最后一条。
3. 将 OHLCV 转为数值；必需字段无法转换或为空时终止真实数据分析。
4. 验证日期唯一且单调递增、成交量非负，并验证 `low <= open/close <= high` 与 `low <= high`。
5. 不对非交易日补值，不对缺失价格插值。

## 3. 指标定义

### 3.1 RSI(14)

令 `delta_t = close_t - close_(t-1)`，上涨量为 `max(delta_t, 0)`，下跌量为 `max(-delta_t, 0)`。

- 第一个 14 期平均上涨量和平均下跌量使用简单平均。
- 后续按 Wilder 递推：`avg_t = (avg_(t-1) * 13 + value_t) / 14`。
- `RS = avg_gain / avg_loss`，`RSI = 100 - 100 / (1 + RS)`。
- 平均下跌为 0 且平均上涨大于 0 时 RSI 为 100；两者均为 0 时 RSI 为 50。
- 输出列：`rsi_14`；前 14 行为预热期空值。

### 3.2 MACD(12, 26, 9)

- 快线：收盘价 12 期 EMA。
- 慢线：收盘价 26 期 EMA。
- `macd = ema_12 - ema_26`。
- `macd_signal`：`macd` 的 9 期 EMA。
- `macd_hist = macd - macd_signal`。
- EMA 使用 `adjust=False`，并在各自跨度满足前保留空值。

### 3.3 布林带(20, 2)

- `bb_mid`：20 日收盘价简单移动平均。
- 标准差：20 日滚动总体标准差，`ddof=0`。
- `bb_upper = bb_mid + 2 * std_20`。
- `bb_lower = bb_mid - 2 * std_20`。
- 前 19 行为预热期空值。

### 3.4 ATR(14)

真实波幅为以下三项的最大值：

1. `high_t - low_t`
2. `abs(high_t - close_(t-1))`
3. `abs(low_t - close_(t-1))`

第一天仅使用当日最高价减最低价。首个 ATR 是前 14 个真实波幅的简单平均，后续使用 Wilder 递推。输出列为 `tr` 和 `atr_14`，ATR 前 13 行为空值。

## 4. Notebook 结构与接口

Notebook 按以下顺序组织，必须可以从空内核顺序运行：

1. 研究目标、口径和免责声明。
2. 导入依赖与集中配置。
3. 数据读取、缓存、清洗和基础检查。
4. 四类指标的 Markdown 公式说明。
5. 指标函数定义、计算与程序化验证。
6. 人工构造数据的 RSI 和 ATR 单元测试。
7. 四联图可视化。
8. 最新有效交易日指标表和中性文字解读。

顶部公开配置：

- `TS_CODE`、`START_DATE`、`END_DATE`、`REFRESH_DATA`
- `RSI_PERIOD`
- `MACD_FAST`、`MACD_SLOW`、`MACD_SIGNAL`
- `BB_PERIOD`、`BB_STD_MULTIPLIER`
- `ATR_PERIOD`

核心函数：

- `load_price_data`
- `calculate_rsi`
- `calculate_macd`
- `calculate_bollinger_bands`
- `calculate_atr`
- `validate_indicator_data`

指标结果表名为 `indicator_data`，在基础 OHLCV 之外包含：`rsi_14`、`macd`、`macd_signal`、`macd_hist`、`bb_mid`、`bb_upper`、`bb_lower`、`tr`、`atr_14`。

## 5. 可视化与解释

使用共享日期轴绘制四个纵向子图：

1. 收盘价、布林带中轨、上轨、下轨及带状区间。
2. RSI 曲线、30/70 参考线和 50 中轴。
3. MACD、信号线和正负柱状图。
4. ATR 曲线。

图表使用中文标题、港元或指数单位、图例和网格。结果区展示最新一个四类指标均非空的交易日，并解释：RSI 所处区间、MACD 动能方向、价格相对布林带的位置和 ATR 的波动含义。不得输出交易指令、收益预测或确定性判断。

## 6. 验收标准

- Notebook JSON 合法，可由 Jupyter 打开并从空内核顺序执行。
- 有缓存或有效 Token 时，能生成真实指标、四联图和最新交易日汇总。
- 没有缓存且缺少 Token 时，Notebook 完整执行并清晰说明如何设置凭证；公式和人工样例测试仍然运行。
- RSI 有效值均在 `[0, 100]`；ATR 和成交量非负。
- 每个有效布林带行满足 `bb_upper >= bb_mid >= bb_lower`。
- `macd_hist` 与 `macd - macd_signal` 在浮点容差内一致。
- RSI、布林带、MACD 和 ATR 的预热期符合第 3 节定义。
- 人工构造数据能够验证 RSI 初始简单平均、Wilder 递推和 ATR 真实波幅公式。
- Notebook 不包含 Token，不使用 A 股数据，不实现策略回测。
