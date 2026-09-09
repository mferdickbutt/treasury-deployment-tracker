# Treasury deployment tracker

Static public-finance page that reports how a treasury’s cash and short-duration investments are deployed each month. **First paint is HTML:** month labels, dollar amounts, and allocation percentages are baked into `index.html`. JavaScript is optional enhancement only.

Sample entity: **Harbor City Public Treasury** (illustrative data, not a live government feed).

## Quick start

```bash
node scripts/render-static.js   # bake tables into index.html
bash scripts/test.sh            # fixtures, edge cases, static-HTML checks
```

Open `index.html` locally or serve the repo root (GitHub Pages works; `.nojekyll` is included).

```bash
python3 -m http.server 8765
curl -sL http://127.0.0.1:8765/index.html | head
# months and amounts appear with JavaScript disabled
```

## Data schema (`data/treasury.json`)

| Field | Type | Meaning |
| --- | --- | --- |
| `meta.entity` | string | Display name |
| `meta.currency` | string | ISO code (USD) |
| `meta.asOf` | string | Period-ending date for the latest month |
| `meta.updated` | string | Publication date |
| `meta.cashFloor` | number | Policy minimum cash balance (currency units) |
| `meta.cashBucketId` | string | Bucket id compared to the floor (`cash`) |
| `meta.targetMix` | object | Policy midpoint shares, keys = bucket ids, values = 0–1 |
| `meta.mixTolerance` | number | Absolute share band (0.05 = ±5 percentage points) |
| `meta.notes` | string | Footnote |
| `buckets[]` | array | Named deployment lines |
| `buckets[].id` | string | Stable key (`cash`, `money_market`, …) |
| `buckets[].label` | string | Column heading |
| `buckets[].description` | string | Public definition |
| `months[]` | array | One object per month, chronological |
| `months[].month` | string | `YYYY-MM` |
| `months[].label` | string | Display label (`Mar 2025`) |
| `months[].deployments` | object | Bucket id → end-of-month amount |
| `months[].total` | number | Sum of that month’s deployments (documented; metrics re-sum) |

This sample has **18 months** (Mar 2025–Aug 2026) and **5 buckets**: cash, money-market / short-term, term deposits, operating float / payables reserve, other deployments. Totals are stored on each month. Policy thresholds live on `meta` (`cashFloor` $12,000,000; `targetMix` 18 / 38 / 28 / 12 / 4 percent).

## Formulas (`js/treasury.js`)

The module is CommonJS (`require("./js/treasury.js")`) and a browser global (`Treasury`). `compute(data)` never returns `NaN` or `Infinity`; unsafe ratios are `null` and render as `—`.

Let \(d_{m,b}\) be month \(m\)’s amount in bucket \(b\), and \(B\) the bucket set.

**Monthly total**

\[
T_m = \sum_{b \in B} d_{m,b}
\]

**Allocation** (share of that month)

\[
a_{m,b} = \frac{d_{m,b}}{T_m} \quad \text{if } T_m \neq 0;\ \text{else } a_{m,b} = \text{null}
\]

**Concentration** — largest bucket’s allocation

\[
C_m = \max_{b \in B} a_{m,b} \quad \text{if } T_m \neq 0;\ \text{else null}
\]

**Month-over-month**

\[
\Delta T_m = T_m - T_{m-1},\quad
\%\Delta T_m = \frac{\Delta T_m}{T_{m-1}} \quad \text{if } T_{m-1} \neq 0;\ \text{else null}
\]

Same for each bucket. The first month has no prior period (`null`). A zero prior total yields a dollar delta but a **null** percent (not Infinity).

**Cash floor** — month \(m\) is below floor when cash \(d_{m,\text{cash}} < \text{cashFloor}\). Summary counts: months below / months at-or-above. If `cashFloor` is omitted, counts are `null`.

**Target mix** — month \(m\) is off-mix when any bucket with a target satisfies \(|a_{m,b} - t_b| > \text{mixTolerance}\). Zero-total months (null allocations) count as off-mix when a target mix is defined. If `targetMix` is omitted, mix counts are `null`.

**Empty input** — `compute({})`, `compute(null)`, or `months: []` returns `monthCount: 0` and null latest/average fields.

## How to re-render

1. Edit `data/treasury.json` (keep `YYYY-MM` order; totals should match the sum of `deployments`).
2. Run `node scripts/render-static.js`.
3. Commit both the JSON and the generated `index.html`.
4. Run `bash scripts/test.sh` — expect `Summary: N passed, 0 failed`.

Do not replace the tables with a “Loading…” shell. The renderer writes full `<table>` markup so `curl -sL` of the page shows month names and amounts.

## Suggested next improvements

- Split operating cash vs. restricted / bond-proceeds cash instead of a single cash line.
- Add weighted-average remaining maturity (WAM) and credit-quality columns for the money-market book.
- Chart allocation stacked bars (progressive enhancement only; keep the HTML tables).
- Load live balances from a CAFR / treasurer API and fail closed to the last baked snapshot.
- Configurable mix bands per bucket (min/max) rather than a single midpoint + tolerance.
- Export CSV of `compute()` months for the audit file.
- Print stylesheet and a one-page PDF of the latest month vs. policy.
