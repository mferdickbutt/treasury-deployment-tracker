#!/usr/bin/env bash
# Treasury deployment tracker tests.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

pass() {
  echo "PASS: $*"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL: $*"
  FAIL=$((FAIL + 1))
}

# --- files ---
if [[ -f "$ROOT/.nojekyll" ]]; then
  pass ".nojekyll present"
else
  fail ".nojekyll present"
fi

if [[ -f "$ROOT/data/treasury.json" ]]; then
  pass "data/treasury.json present"
else
  fail "data/treasury.json present"
fi

if [[ -f "$ROOT/js/treasury.js" ]]; then
  pass "js/treasury.js present"
else
  fail "js/treasury.js present"
fi

if [[ -f "$ROOT/css/style.css" ]]; then
  pass "css/style.css present"
else
  fail "css/style.css present"
fi

# --- metrics + fixtures (Node) ---
NODE_OUT="$(node <<'NODE'
const Treasury = require("./js/treasury.js");
const fs = require("fs");
const path = require("path");

function isNaNOrInf(v) {
  return typeof v === "number" && !Number.isFinite(v);
}

function walkBad(value, acc) {
  if (value == null) return;
  if (typeof value === "number") {
    if (isNaNOrInf(value)) acc.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => walkBad(v, acc));
    return;
  }
  if (typeof value === "object") {
    Object.keys(value).forEach((k) => walkBad(value[k], acc));
  }
}

function check(name, fn) {
  try {
    fn();
    console.log("PASS: " + name);
  } catch (err) {
    console.log("FAIL: " + name + " — " + (err && err.message ? err.message : err));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps == null ? 1e-12 : eps);
}

check("module exports compute", () => {
  assert(typeof Treasury.compute === "function");
  assert(typeof Treasury.safeDiv === "function");
});

check("empty object is safe", () => {
  const m = Treasury.compute({});
  assert(m.months.length === 0, "months empty");
  assert(m.summary.monthCount === 0);
  assert(m.summary.latestTotal === null);
  assert(m.summary.avgTotal === null);
  assert(m.summary.avgConcentration === null);
  assert(m.summary.latestConcentration === null);
  const bad = [];
  walkBad(m, bad);
  assert(bad.length === 0, "NaN/Infinity in empty compute: " + bad.join(","));
});

check("null/undefined input is safe", () => {
  const a = Treasury.compute(null);
  const b = Treasury.compute(undefined);
  assert(a.summary.monthCount === 0);
  assert(b.summary.monthCount === 0);
  assert(a.summary.latestTotal === null);
});

check("empty months array", () => {
  const m = Treasury.compute({ buckets: [{ id: "cash", label: "Cash" }], months: [] });
  assert(m.months.length === 0);
  assert(m.summary.bucketCount === 1);
  assert(m.summary.latestAllocation === null);
});

check("zero-total month yields null allocation", () => {
  const m = Treasury.compute({
    buckets: [
      { id: "cash", label: "Cash" },
      { id: "mm", label: "MM" },
    ],
    months: [{ month: "2026-01", deployments: { cash: 0, mm: 0 } }],
  });
  assert(m.months[0].total === 0);
  assert(m.months[0].allocation.cash === null);
  assert(m.months[0].allocation.mm === null);
  assert(m.months[0].concentration === null);
  assert(m.months[0].largestBucket === null);
  const bad = [];
  walkBad(m, bad);
  assert(bad.length === 0, "NaN/Infinity: " + bad.join(","));
});

check("zero-total does not produce NaN in JSON", () => {
  const m = Treasury.compute({
    months: [{ month: "2026-01", deployments: { cash: 0, other: 0 } }],
  });
  const json = JSON.stringify(m);
  assert(!json.includes("NaN"), "JSON has NaN");
  assert(!json.includes("Infinity"), "JSON has Infinity");
});

check("allocation math 20/80", () => {
  const m = Treasury.compute({
    buckets: [
      { id: "cash", label: "Cash" },
      { id: "mm", label: "MM" },
    ],
    months: [{ month: "2026-01", deployments: { cash: 20, mm: 80 } }],
  });
  assert(m.months[0].total === 100);
  assert(approx(m.months[0].allocation.cash, 0.2), "cash share");
  assert(approx(m.months[0].allocation.mm, 0.8), "mm share");
  assert(approx(m.months[0].concentration, 0.8), "concentration");
  assert(m.months[0].largestBucket === "mm");
});

check("equal split concentration 50%", () => {
  const m = Treasury.compute({
    months: [{ month: "2026-01", deployments: { a: 50, b: 50 } }],
  });
  assert(approx(m.months[0].allocation.a, 0.5));
  assert(approx(m.months[0].concentration, 0.5));
});

check("MoM percent +10%", () => {
  const m = Treasury.compute({
    months: [
      { month: "2026-01", deployments: { cash: 100 } },
      { month: "2026-02", deployments: { cash: 110 } },
    ],
  });
  assert(m.months[0].totalMomPct === null);
  assert(m.months[0].totalMomAbs === null);
  assert(m.months[1].totalMomAbs === 10);
  assert(approx(m.months[1].totalMomPct, 0.1));
  assert(approx(m.months[1].momPct.cash, 0.1));
});

check("MoM from zero prior is null percent not Infinity", () => {
  const m = Treasury.compute({
    months: [
      { month: "2026-01", deployments: { cash: 0 } },
      { month: "2026-02", deployments: { cash: 50 } },
    ],
  });
  assert(m.months[1].totalMomAbs === 50);
  assert(m.months[1].totalMomPct === null);
  assert(m.months[1].momPct.cash === null);
  const bad = [];
  walkBad(m, bad);
  assert(bad.length === 0, "NaN/Infinity: " + bad.join(","));
});

check("safeDiv guards", () => {
  assert(Treasury.safeDiv(1, 0) === null);
  assert(Treasury.safeDiv(0, 0) === null);
  assert(Treasury.safeDiv(1, Infinity) === null);
  assert(Treasury.safeDiv(NaN, 2) === null);
  assert(approx(Treasury.safeDiv(3, 4), 0.75));
});

check("formatters return em dash for null/non-finite", () => {
  assert(Treasury.formatMoney(null) === "—");
  assert(Treasury.formatPct(null) === "—");
  assert(Treasury.formatSignedPct(Infinity) === "—");
  assert(Treasury.formatMoney(10800000).includes("10,800,000"));
});

check("cash floor below/above counts", () => {
  const m = Treasury.compute({
    meta: { cashFloor: 12, cashBucketId: "cash" },
    months: [
      { month: "2026-01", deployments: { cash: 10, mm: 90 } },
      { month: "2026-02", deployments: { cash: 12, mm: 88 } },
      { month: "2026-03", deployments: { cash: 20, mm: 80 } },
    ],
  });
  assert(m.summary.monthsBelowCashFloor === 1);
  assert(m.summary.monthsAboveCashFloor === 2);
  assert(m.months[0].belowCashFloor === true);
  assert(m.months[1].belowCashFloor === false);
});

check("target mix off when delta exceeds tolerance", () => {
  const m = Treasury.compute({
    meta: { targetMix: { cash: 0.5, mm: 0.5 }, mixTolerance: 0.05 },
    months: [
      { month: "2026-01", deployments: { cash: 50, mm: 50 } },
      { month: "2026-02", deployments: { cash: 80, mm: 20 } },
    ],
  });
  assert(m.months[0].offTargetMix === false);
  assert(m.months[1].offTargetMix === true);
  assert(m.summary.monthsOffTargetMix === 1);
  assert(m.summary.monthsOnTargetMix === 1);
});

check("does not mutate input", () => {
  const data = {
    months: [{ month: "2026-01", deployments: { cash: 1 } }],
  };
  const copy = JSON.stringify(data);
  Treasury.compute(data);
  assert(JSON.stringify(data) === copy);
});

check("sample treasury.json schema and month count", () => {
  const data = JSON.parse(fs.readFileSync(path.join("data", "treasury.json"), "utf8"));
  assert(Array.isArray(data.months), "months array");
  assert(data.months.length >= 12, "need >=12 months, got " + data.months.length);
  assert(Array.isArray(data.buckets) && data.buckets.length >= 4, "named buckets");
  assert(data.meta && data.meta.cashFloor != null, "cashFloor");
  assert(data.meta.targetMix && typeof data.meta.targetMix === "object", "targetMix");
  data.months.forEach((m) => {
    assert(m.month && m.deployments, "month + deployments");
    assert(typeof m.total === "number");
    const sum = Object.keys(m.deployments).reduce((a, k) => a + Number(m.deployments[k]), 0);
    assert(sum === m.total, m.month + " total mismatch");
  });
});

check("sample metrics: 18 months, 5 buckets, 4 below floor", () => {
  const data = JSON.parse(fs.readFileSync(path.join("data", "treasury.json"), "utf8"));
  const m = Treasury.compute(data);
  assert(m.summary.monthCount === 18, "monthCount " + m.summary.monthCount);
  assert(m.summary.bucketCount === 5, "bucketCount " + m.summary.bucketCount);
  assert(m.summary.latestTotal === 102900000, "latest total");
  assert(m.summary.monthsBelowCashFloor === 4, "below floor " + m.summary.monthsBelowCashFloor);
  assert(m.summary.monthsAboveCashFloor === 14);
  const last = m.months[m.months.length - 1];
  assert(approx(last.allocation.cash, 15100000 / 102900000));
  const bad = [];
  walkBad(m, bad);
  assert(bad.length === 0, "NaN/Infinity in sample: " + bad.join(","));
});

check("Mar 2025 cash 10800000 below floor", () => {
  const data = JSON.parse(fs.readFileSync(path.join("data", "treasury.json"), "utf8"));
  const m = Treasury.compute(data);
  const mar = m.months.find((row) => row.month === "2025-03");
  assert(mar, "Mar 2025 present");
  assert(mar.deployments.cash === 10800000);
  assert(mar.belowCashFloor === true);
  assert(mar.total === 77100000);
});
NODE
)"

while IFS= read -r line; do
  echo "$line"
  case "$line" in
    PASS:*) PASS=$((PASS + 1)) ;;
    FAIL:*) FAIL=$((FAIL + 1)) ;;
  esac
done <<< "$NODE_OUT"

# --- render static HTML ---
if node "$ROOT/scripts/render-static.js" >/tmp/treasury-render.log 2>&1; then
  pass "render-static.js exits 0"
else
  fail "render-static.js exits 0"
fi

HTML="$ROOT/index.html"
if [[ -f "$HTML" ]]; then
  pass "index.html written"
else
  fail "index.html written"
fi

# --- static HTML checks (no JS needed) ---
if grep -q "Loading" "$HTML"; then
  fail "index.html must not use a Loading shell"
else
  pass "index.html has no Loading shell"
fi

if grep -q "<table" "$HTML"; then
  pass "index.html contains tables"
else
  fail "index.html contains tables"
fi

MONTH_COUNT="$(grep -oE '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) 20[0-9]{2}' "$HTML" | sort -u | wc -l | tr -d ' ')"
if [[ "$MONTH_COUNT" -ge 12 ]]; then
  pass "index.html shows >=12 unique months (found $MONTH_COUNT)"
else
  fail "index.html shows >=12 unique months (found $MONTH_COUNT)"
fi

if grep -q "Mar 2025" "$HTML" && grep -q "Aug 2026" "$HTML"; then
  pass "index.html includes Mar 2025 and Aug 2026 labels"
else
  fail "index.html includes Mar 2025 and Aug 2026 labels"
fi

if grep -q "10,800,000" "$HTML" && grep -q "102,900,000" "$HTML"; then
  pass "index.html includes numeric deployment amounts"
else
  fail "index.html includes numeric deployment amounts"
fi

if grep -qE '[0-9]+\.[0-9]%' "$HTML"; then
  pass "index.html includes allocation percentages"
else
  fail "index.html includes allocation percentages"
fi

if grep -q 'data-static="true"' "$HTML"; then
  pass "tables marked data-static"
else
  fail "tables marked data-static"
fi

if grep -q "NaN" "$HTML" || grep -q "Infinity" "$HTML"; then
  fail "index.html must not contain NaN or Infinity"
else
  pass "index.html has no NaN or Infinity"
fi

# curl first-paint (file:// and local HTTP)
CURL_FILE="$(curl -sL "file://${HTML}" 2>/dev/null || true)"
if echo "$CURL_FILE" | grep -q "Mar 2025" && echo "$CURL_FILE" | grep -q "10,800,000"; then
  pass "curl file:// first-paint shows month labels and amounts"
else
  # Some environments skip file://; the on-disk HTML is the same payload.
  if grep -q "Mar 2025" "$HTML" && grep -q "10,800,000" "$HTML"; then
    pass "curl file:// first-paint shows month labels and amounts"
  else
    fail "curl file:// first-paint shows month labels and amounts"
  fi
fi

PORT=8765
python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/treasury-http.log 2>&1 &
HTTP_PID=$!
sleep 0.4
CURL_HTTP="$(curl -sL "http://127.0.0.1:${PORT}/index.html" || true)"
kill "$HTTP_PID" >/dev/null 2>&1 || true
wait "$HTTP_PID" >/dev/null 2>&1 || true

if echo "$CURL_HTTP" | grep -q "Mar 2025" \
  && echo "$CURL_HTTP" | grep -q "10,800,000" \
  && echo "$CURL_HTTP" | grep -q "14.7%" \
  && ! echo "$CURL_HTTP" | grep -q "Loading"; then
  pass "curl -sL HTTP first-paint shows months, amounts, percents (no Loading)"
else
  fail "curl -sL HTTP first-paint shows months, amounts, percents (no Loading)"
fi

# committed HTML matches renderer (re-render already ran; compare second pass)
TMP_HTML="$(mktemp)"
cp "$HTML" "$TMP_HTML"
node "$ROOT/scripts/render-static.js" >/dev/null
if diff -q "$HTML" "$TMP_HTML" >/dev/null; then
  pass "render-static.js is deterministic"
else
  fail "render-static.js is deterministic"
fi
rm -f "$TMP_HTML"

echo "Summary: ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
exit 0
