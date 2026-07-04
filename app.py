from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
WEB_CACHE_DIR = DATA_DIR / "web_cache"
SYMBOL_PATTERN = re.compile(r"^(?:\d{5}\.HK|\d{6}\.(?:SH|SZ|BJ))$")

load_dotenv(ROOT / ".env")

app = Flask(__name__)
app.json.ensure_ascii = False


STOCKS = [
    {"symbol": "00981.HK", "name": "中芯国际", "market": "港股", "currency": "HKD"},
    {"symbol": "688981.SH", "name": "中芯国际", "market": "A股", "currency": "CNY"},
    {"symbol": "00700.HK", "name": "腾讯控股", "market": "港股", "currency": "HKD"},
    {"symbol": "09988.HK", "name": "阿里巴巴-W", "market": "港股", "currency": "HKD"},
    {"symbol": "03690.HK", "name": "美团-W", "market": "港股", "currency": "HKD"},
    {"symbol": "01810.HK", "name": "小米集团-W", "market": "港股", "currency": "HKD"},
    {"symbol": "600519.SH", "name": "贵州茅台", "market": "A股", "currency": "CNY"},
    {"symbol": "300750.SZ", "name": "宁德时代", "market": "A股", "currency": "CNY"},
]


class DataServiceError(RuntimeError):
    pass


def _parse_date(value: str, field_name: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except (TypeError, ValueError) as exc:
        raise DataServiceError(f"{field_name} 必须使用 YYYY-MM-DD 格式") from exc


def _stock_meta(symbol: str) -> dict:
    match = next((item for item in STOCKS if item["symbol"] == symbol), None)
    if match:
        return match.copy()
    is_hk = symbol.endswith(".HK")
    return {
        "symbol": symbol,
        "name": symbol,
        "market": "港股" if is_hk else "A股",
        "currency": "HKD" if is_hk else "CNY",
    }


def _normalize_prices(frame: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if frame is None or frame.empty:
        raise DataServiceError("所选区间没有可用行情")

    data = frame.copy()
    if "volume" not in data.columns and "vol" in data.columns:
        data = data.rename(columns={"vol": "volume"})

    required = ["trade_date", "open", "high", "low", "close", "volume"]
    missing = [column for column in required if column not in data.columns]
    if missing:
        raise DataServiceError("行情字段不完整")

    data["trade_date"] = pd.to_datetime(data["trade_date"], errors="coerce")
    for column in ["open", "high", "low", "close", "volume", "amount"]:
        if column in data.columns:
            data[column] = pd.to_numeric(data[column], errors="coerce")

    data = data.dropna(subset=required)
    data = data.drop_duplicates("trade_date", keep="last").sort_values("trade_date")
    if data.empty:
        raise DataServiceError("清洗后没有有效行情")

    invalid = (
        (data["high"] < data["low"])
        | (data["open"] > data["high"])
        | (data["open"] < data["low"])
        | (data["close"] > data["high"])
        | (data["close"] < data["low"])
        | (data["volume"] < 0)
    )
    if invalid.any():
        raise DataServiceError("行情数据未通过 OHLCV 合法性检查")

    if "ts_code" not in data.columns:
        data["ts_code"] = symbol
    return data.reset_index(drop=True)


def _load_seed_cache(symbol: str, start: datetime, end: datetime) -> pd.DataFrame | None:
    for path in sorted(DATA_DIR.glob("*.csv")):
        try:
            frame = pd.read_csv(path)
            if "ts_code" in frame.columns and symbol not in set(frame["ts_code"].astype(str)):
                continue
            if "ts_code" not in frame.columns and symbol.replace(".", "_") not in path.name:
                continue
            normalized = _normalize_prices(frame, symbol)
            available_start = normalized["trade_date"].min()
            available_end = normalized["trade_date"].max()
            if available_start <= start and available_end >= end:
                return normalized
        except (OSError, ValueError, DataServiceError):
            continue
    return None


def _fetch_tushare(symbol: str, fetch_start: datetime, end: datetime) -> pd.DataFrame:
    token = os.getenv("TUSHARE_TOKEN")
    if not token:
        raise DataServiceError("行情服务尚未配置")

    try:
        import tushare as ts

        pro = ts.pro_api(token)
        kwargs = {
            "ts_code": symbol,
            "start_date": fetch_start.strftime("%Y%m%d"),
            "end_date": end.strftime("%Y%m%d"),
        }
        frame = pro.hk_daily(**kwargs) if symbol.endswith(".HK") else pro.daily(**kwargs)
    except Exception as exc:
        app.logger.warning("Tushare request failed for %s", symbol)
        raise DataServiceError("行情服务暂不可用，请稍后重试") from exc

    normalized = _normalize_prices(frame, symbol)
    WEB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_name = f"{symbol.replace('.', '_')}_{fetch_start:%Y%m%d}_{end:%Y%m%d}.csv"
    to_cache = normalized.copy()
    to_cache["trade_date"] = to_cache["trade_date"].dt.strftime("%Y-%m-%d")
    to_cache.to_csv(WEB_CACHE_DIR / cache_name, index=False, encoding="utf-8-sig")
    return normalized


def _load_web_cache(symbol: str, fetch_start: datetime, end: datetime) -> pd.DataFrame | None:
    pattern = f"{symbol.replace('.', '_')}_*.csv"
    for path in sorted(WEB_CACHE_DIR.glob(pattern), reverse=True):
        try:
            frame = _normalize_prices(pd.read_csv(path), symbol)
            if frame["trade_date"].min() <= fetch_start and frame["trade_date"].max() >= end:
                return frame
        except (OSError, ValueError, DataServiceError):
            continue
    return None


def _serialize_prices(frame: pd.DataFrame) -> list[dict]:
    records = []
    for row in frame.itertuples(index=False):
        record = {
            "date": row.trade_date.strftime("%Y-%m-%d"),
            "open": round(float(row.open), 6),
            "high": round(float(row.high), 6),
            "low": round(float(row.low), 6),
            "close": round(float(row.close), 6),
            "volume": round(float(row.volume), 4),
        }
        amount = getattr(row, "amount", None)
        if amount is not None and pd.notna(amount):
            record["amount"] = round(float(amount), 4)
        records.append(record)
    return records


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/stocks/search")
def search_stocks():
    query = request.args.get("q", "").strip().lower()
    if not query:
        return jsonify({"items": STOCKS[:6]})

    items = [
        item
        for item in STOCKS
        if query in item["symbol"].lower() or query in item["name"].lower()
    ]
    query_upper = query.upper()
    if SYMBOL_PATTERN.fullmatch(query_upper) and not any(item["symbol"] == query_upper for item in items):
        items.insert(0, _stock_meta(query_upper))
    return jsonify({"items": items[:8]})


@app.get("/api/prices/<symbol>")
def prices(symbol: str):
    symbol = symbol.upper()
    if not SYMBOL_PATTERN.fullmatch(symbol):
        return jsonify({"error": "证券代码格式不正确"}), 400

    try:
        start = _parse_date(request.args.get("start"), "开始日期")
        end = _parse_date(request.args.get("end"), "结束日期")
        if start > end:
            raise DataServiceError("开始日期不能晚于结束日期")
        if (end - start).days > 3653:
            raise DataServiceError("单次查询区间不能超过 10 年")

        warmup_days = min(max(request.args.get("warmup", default=180, type=int), 30), 730)
        fetch_start = start - timedelta(days=warmup_days)
        refresh = request.args.get("refresh") == "1"

        source = "本地数据"
        frame = None if refresh else _load_web_cache(symbol, fetch_start, end)
        if frame is not None:
            source = "本地缓存"
        if frame is None and not refresh:
            frame = _load_seed_cache(symbol, start, end)
        if frame is None:
            frame = _fetch_tushare(symbol, fetch_start, end)
            source = "Tushare Pro"

        frame = frame.loc[frame["trade_date"] <= end].copy()
        if frame.empty or frame["trade_date"].max() < start:
            raise DataServiceError("所选区间没有可用行情")

        meta = _stock_meta(symbol)
        meta.update(
            {
                "frequency": "1d",
                "adjustment": "未复权",
                "source": source,
                "requested_start": start.strftime("%Y-%m-%d"),
                "requested_end": end.strftime("%Y-%m-%d"),
                "available_start": frame["trade_date"].min().strftime("%Y-%m-%d"),
                "available_end": frame["trade_date"].max().strftime("%Y-%m-%d"),
            }
        )
        return jsonify({"meta": meta, "prices": _serialize_prices(frame)})
    except DataServiceError as exc:
        return jsonify({"error": str(exc)}), 400


@app.get("/api/health/data-source")
def data_source_health():
    return jsonify(
        {
            "configured": bool(os.getenv("TUSHARE_TOKEN")),
            "provider": "Tushare Pro",
            "cache_available": DATA_DIR.exists() and any(DATA_DIR.rglob("*.csv")),
        }
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=False)

