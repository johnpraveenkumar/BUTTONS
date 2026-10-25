from flask import Flask, jsonify, request, send_from_directory
from pathlib import Path
from datetime import datetime, date
import calendar
import math
import sqlite3

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "wealthwave.db"
app = Flask(__name__)
app.json.sort_keys = False


def connect_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def columns(conn, table):
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def valid_month(value):
    try:
        datetime.strptime(value, "%Y-%m")
        return value
    except (ValueError, TypeError):
        return datetime.now().strftime("%Y-%m")


def valid_date(value):
    try:
        return date.fromisoformat(str(value)).isoformat()
    except (ValueError, TypeError):
        return None


def positive_number(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n) or n <= 0:
        return None
    return round(n, 2)


def _rename_table(conn, table):
    name = table + "_legacy"
    suffix = 1
    while conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone():
        suffix += 1
        name = f"{table}_legacy_{suffix}"
    conn.execute(f"ALTER TABLE {table} RENAME TO {name}")
    return name


def init_db():
    with connect_db() as conn:
        settings_cols = columns(conn, "settings")
        legacy_settings = None
        if settings_cols and not {"id", "budget_cap"}.issubset(settings_cols):
            legacy_settings = _rename_table(conn, "settings")

        tx_cols = columns(conn, "transactions")
        expected_tx = {"id", "type", "amount", "category", "method", "title", "created_at"}
        if tx_cols and not expected_tx.issubset(tx_cols):
            _rename_table(conn, "transactions")

        goal_cols = columns(conn, "goals")
        if goal_cols and not {"id", "name", "target", "saved"}.issubset(goal_cols):
            _rename_table(conn, "goals")

        conn.execute("""CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK(id=1), budget_cap REAL)""")
        conn.execute("INSERT OR IGNORE INTO settings(id,budget_cap) VALUES(1,NULL)")
        conn.execute("""CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL CHECK(type IN ('Income','Expenses','Saving')),
            amount REAL NOT NULL CHECK(amount > 0),
            category TEXT NOT NULL DEFAULT 'Other',
            method TEXT NOT NULL DEFAULT 'Other',
            title TEXT NOT NULL DEFAULT 'Transaction',
            created_at TEXT NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS monthly_budgets (
            month TEXT PRIMARY KEY, amount REAL NOT NULL CHECK(amount > 0))""")
        conn.execute("""CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            target REAL NOT NULL CHECK(target > 0), saved REAL NOT NULL DEFAULT 0 CHECK(saved >= 0))""")

        # Recover a budget from older key/value or single-column settings schemas.
        if legacy_settings:
            cols = columns(conn, legacy_settings)
            try:
                row = None
                if {"key", "value"}.issubset(cols):
                    row = conn.execute(
                        f"SELECT value AS budget_value FROM {legacy_settings} "
                        "WHERE key IN ('budgetCap','budget_cap') "
                        "ORDER BY CASE key WHEN 'budgetCap' THEN 0 ELSE 1 END LIMIT 1"
                    ).fetchone()
                    value = row["budget_value"] if row else None
                elif "budget_cap" in cols:
                    row = conn.execute(f"SELECT budget_cap AS budget_value FROM {legacy_settings} LIMIT 1").fetchone()
                    value = row["budget_value"] if row else None
                else:
                    value = None
                if value is not None and float(value) > 0:
                    conn.execute("UPDATE settings SET budget_cap=? WHERE id=1", (float(value),))
            except (sqlite3.Error, TypeError, ValueError):
                pass

        month = datetime.now().strftime("%Y-%m")
        old = conn.execute("SELECT budget_cap FROM settings WHERE id=1").fetchone()
        if old and old["budget_cap"] and not conn.execute("SELECT 1 FROM monthly_budgets WHERE month=?", (month,)).fetchone():
            conn.execute("INSERT OR IGNORE INTO monthly_budgets(month,amount) VALUES(?,?)", (month, old["budget_cap"]))
        if conn.execute("SELECT COUNT(*) FROM goals").fetchone()[0] == 0:
            conn.executemany("INSERT INTO goals(name,target,saved) VALUES(?,?,?)", [
                ("Semester College Fee", 1200, 0), ("New Laptop Fund", 900, 0)])


def build_state(conn, month):
    rows = conn.execute("SELECT * FROM transactions ORDER BY id DESC").fetchall()
    month_rows = []
    for r in rows:
        raw_date = str(r["created_at"] or "")[:10]
        if raw_date.startswith(month) and r["type"] in ("Expenses", "Saving"):
            month_rows.append(r)
    expenses = round(sum(float(r["amount"]) for r in month_rows if r["type"] == "Expenses"), 2)
    savings = round(sum(float(r["amount"]) for r in month_rows if r["type"] == "Saving"), 2)
    budget = conn.execute("SELECT amount FROM monthly_budgets WHERE month=?", (month,)).fetchone()
    cap = float(budget["amount"]) if budget else None
    activities = []
    daily = {}
    for r in rows:
        dt_text = str(r["created_at"] or "")
        try:
            dt = datetime.fromisoformat(dt_text)
            time_label = dt.strftime("%d %b %Y")
            day_key = dt.strftime("%Y-%m-%d")
        except ValueError:
            time_label = dt_text
            day_key = dt_text[:10]
        kind = r["type"]
        if day_key.startswith(month) and kind == "Expenses":
            daily[day_key] = round(daily.get(day_key, 0) + float(r["amount"]), 2)
        activities.append({"id": r["id"], "name": r["title"], "category": r["category"],
            "method": r["method"], "time": time_label, "date": day_key,
            "classify": kind, "amount": float(r["amount"])})
    goals = [dict(g) for g in conn.execute("SELECT * FROM goals ORDER BY id").fetchall()]
    remaining = round(max(0, (cap or 0) - expenses - savings), 2)
    return {"month": month, "totalBalance": remaining, "remaining": remaining,
        "income": 0, "expenses": expenses, "savings": savings, "budgetCap": cap,
        "activities": activities, "goals": goals, "dailyExpenses": daily}


@app.get("/")
def home():
    return send_from_directory(BASE_DIR, "code.html")


@app.get("/code.css")
def stylesheet():
    return send_from_directory(BASE_DIR, "code.css")


@app.get("/code.js")
def javascript():
    return send_from_directory(BASE_DIR, "code.js")


@app.get("/api/state")
def get_state():
    month = valid_month(request.args.get("month", datetime.now().strftime("%Y-%m")))
    with connect_db() as conn:
        return jsonify(build_state(conn, month))


@app.post("/api/budget")
def set_budget():
    data = request.get_json(silent=True) or {}
    amount = positive_number(data.get("amount", data.get("cap")))
    month = valid_month(data.get("month", datetime.now().strftime("%Y-%m")))
    if amount is None:
        return jsonify({"error": "Enter a budget amount greater than zero."}), 400
    with connect_db() as conn:
        conn.execute("INSERT INTO monthly_budgets(month,amount) VALUES(?,?) ON CONFLICT(month) DO UPDATE SET amount=excluded.amount", (month, amount))
        return jsonify({"success": True, "state": build_state(conn, month)})


@app.post("/api/transaction")
def add_transaction():
    data = request.get_json(silent=True) or {}
    tx_type = data.get("type")
    title = str(data.get("title", "Expense")).strip()[:100]
    category = str(data.get("category", "Other")).strip()[:60] or "Other"
    method = str(data.get("method", "Other")).strip()[:60] or "Other"
    amount = positive_number(data.get("amount"))
    tx_date = valid_date(data.get("date")) or date.today().isoformat()
    month = tx_date[:7]
    if tx_type not in ("Expenses", "Saving"):
        return jsonify({"error": "Choose Expense or Savings."}), 400
    if amount is None:
        return jsonify({"error": "Amount must be greater than zero."}), 400
    if not title:
        return jsonify({"error": "Please enter a description."}), 400
    with connect_db() as conn:
        current = build_state(conn, month)
        if current["budgetCap"] is None:
            return jsonify({"error": f"Set a budget for {month} before recording expenses or savings."}), 400
        # Expenses are always recorded, even when the monthly budget is exhausted.
        # The dashboard then marks the month as over budget instead of losing the transaction.
        # Savings still cannot exceed the available budget.
        if tx_type == "Saving" and amount > current["remaining"]:
            return jsonify({"error": f"Not enough budget left to move that amount to savings. You have ₹{current['remaining']:.2f} available for {month}."}), 400
        created_at = tx_date + "T12:00:00"
        conn.execute("INSERT INTO transactions(type,amount,category,method,title,created_at) VALUES(?,?,?,?,?,?)",
                     (tx_type, amount, category, method, title, created_at))
        return jsonify({"success": True, "state": build_state(conn, month)}), 201


@app.post("/api/goal")
def add_goal():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()[:100]
    target = positive_number(data.get("target"))
    try:
        saved = float(data.get("saved", 0))
    except (TypeError, ValueError):
        saved = -1
    if not name or target is None or not math.isfinite(saved) or saved < 0:
        return jsonify({"error": "Enter a goal name, positive target, and saved amount of zero or more."}), 400
    with connect_db() as conn:
        conn.execute("INSERT INTO goals(name,target,saved) VALUES(?,?,?)", (name, target, round(saved, 2)))
        return jsonify({"success": True, "state": build_state(conn, valid_month(datetime.now().strftime('%Y-%m')))}), 201


@app.errorhandler(404)
def not_found(_error):
    return jsonify({"error": "Not found."}), 404


@app.errorhandler(500)
def internal_error(_error):
    return jsonify({"error": "An internal server error occurred."}), 500


init_db()
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
