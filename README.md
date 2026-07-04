# 股票技术指标实验台

一个本地运行的 Web 工具，用于选择股票、调整 RSI、MACD、布林带和 ATR 参数，并即时重算和重绘图表。

## 功能

- 支持港股代码（如 `00981.HK`）和 A 股代码（如 `688981.SH`）。
- 股票代码/名称搜索与快捷选择。
- 日线 K 线或收盘价模式，布林带与成交量叠加。
- RSI、MACD、ATR 独立子图，共享日期轴。
- 滑块和数值输入调参，250ms 防抖重算。
- 参数校验、指标显隐、滚轮缩放、拖拽平移、十字光标。
- URL 保存当前股票、区间和参数。
- 导出图表 PNG 和指标 CSV。
- Tushare Token 只由后端从 `.env` 读取。

## 启动

```bash
python3 -m pip install -r requirements.txt
python3 app.py
```

浏览器打开：`http://127.0.0.1:8000`

项目根目录需要存在：

```text
TUSHARE_TOKEN=你的凭证
```

`.env` 已加入 `.gitignore`，不要把凭证写入前端代码或提交到版本控制。

## 数据与缓存

- 港股使用 Tushare `hk_daily`，A 股使用 `daily`。
- 价格采用未复权日线。
- 默认优先使用 `data/` 中覆盖目标区间的现有数据。
- 新请求缓存到 `data/web_cache/`，该目录不会提交到 Git。
- 服务端只向浏览器返回证券元数据和 OHLCV，不返回 Token。

## 指标口径

- RSI：首期简单平均，之后 Wilder 递推。
- MACD：EMA 使用递推形式，默认 `(12, 26, 9)`。
- 布林带：总体标准差 `ddof=0`，默认 `(20, 2)`。
- ATR：TR 三项取最大，首期简单平均，之后 Wilder 递推。

## 主要文件

- `app.py`：Flask 页面和数据 API。
- `templates/index.html`：页面结构。
- `static/styles.css`：响应式视觉样式。
- `static/indicators.js`：指标算法。
- `static/app.js`：状态管理、Canvas 绘图和交互。
- `PRODUCT_DESIGN.md`：产品设计文档。

## 测试

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```

若本机已安装 Node.js，可额外运行指标算法单元测试：`node tests/test_indicators.js`。

## API

- `GET /api/stocks/search?q=中芯`
- `GET /api/prices/00981.HK?start=2025-07-02&end=2026-06-30`
- `GET /api/health/data-source`

本工具仅用于学习和数据分析，不构成投资建议。
