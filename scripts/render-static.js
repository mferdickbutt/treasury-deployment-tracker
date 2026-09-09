#!/usr/bin/env node
/**
 * Bake treasury metrics tables into index.html.
 * First-paint HTML includes month labels and numeric amounts — no JS required.
 *
 * Usage: node scripts/render-static.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var Treasury = require("../js/treasury.js");

var ROOT = path.resolve(__dirname, "..");
var DATA_PATH = path.join(ROOT, "data", "treasury.json");
var OUT_PATH = path.join(ROOT, "index.html");

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bucketById(buckets, id) {
  for (var i = 0; i < buckets.length; i++) {
    if (buckets[i].id === id) return buckets[i];
  }
  return { id: id, label: id };
}

function render(data) {
  var metrics = Treasury.compute(data);
  var currency = metrics.meta.currency || "USD";
  var buckets = metrics.buckets;
  var months = metrics.months;
  var summary = metrics.summary;
  var money = function (n) {
    return Treasury.formatMoney(n, currency);
  };

  function bucketHeadings() {
    return buckets
      .map(function (b) {
        return "<th scope=\"col\">" + esc(b.label) + "</th>";
      })
      .join("");
  }

  var amountRows = months
    .map(function (m) {
      var cells = buckets
        .map(function (b) {
          return "<td>" + esc(money(m.deployments[b.id])) + "</td>";
        })
        .join("");
      var cls = m.belowCashFloor ? " class=\"below-floor\"" : "";
      return (
        "<tr" +
        cls +
        "><th scope=\"row\">" +
        esc(m.label) +
        "</th>" +
        cells +
        "<td>" +
        esc(money(m.total)) +
        "</td></tr>"
      );
    })
    .join("\n");

  var allocRows = months
    .map(function (m) {
      var cells = buckets
        .map(function (b) {
          return "<td>" + esc(Treasury.formatPct(m.allocation[b.id])) + "</td>";
        })
        .join("");
      return (
        "<tr><th scope=\"row\">" +
        esc(m.label) +
        "</th>" +
        cells +
        "<td>" +
        esc(Treasury.formatPct(m.concentration)) +
        "</td></tr>"
      );
    })
    .join("\n");

  var momRows = months
    .map(function (m) {
      return (
        "<tr><th scope=\"row\">" +
        esc(m.label) +
        "</th><td>" +
        esc(Treasury.formatSignedMoney(m.totalMomAbs, currency)) +
        "</td><td>" +
        esc(Treasury.formatSignedPct(m.totalMomPct)) +
        "</td><td>" +
        esc(Treasury.formatSignedMoney(m.momAbs.cash, currency)) +
        "</td><td>" +
        esc(Treasury.formatSignedPct(m.momPct.cash)) +
        "</td></tr>"
      );
    })
    .join("\n");

  var policyRows = months
    .map(function (m) {
      var floorFlag =
        m.belowCashFloor == null
          ? "—"
          : m.belowCashFloor
            ? "<span class=\"flag-below\">Below floor</span>"
            : "<span class=\"flag-ok\">Meets floor</span>";
      var mixFlag =
        m.offTargetMix == null
          ? "—"
          : m.offTargetMix
            ? "<span class=\"flag-off\">Off mix</span>"
            : "<span class=\"flag-ok\">On mix</span>";
      var largest = m.largestBucket
        ? bucketById(buckets, m.largestBucket).label
        : "—";
      return (
        "<tr" +
        (m.belowCashFloor ? " class=\"below-floor\"" : "") +
        "><th scope=\"row\">" +
        esc(m.label) +
        "</th><td>" +
        esc(money(m.cashAmount)) +
        "</td><td>" +
        floorFlag +
        "</td><td>" +
        esc(Treasury.formatPct(m.concentration)) +
        "</td><td>" +
        esc(largest) +
        "</td><td>" +
        mixFlag +
        "</td></tr>"
      );
    })
    .join("\n");

  var targetCells = "";
  if (metrics.meta.targetMix) {
    targetCells = buckets
      .map(function (b) {
        var target = metrics.meta.targetMix[b.id];
        var actual =
          summary.latestAllocation && summary.latestAllocation[b.id];
        var delta =
          actual != null && target != null ? actual - target : null;
        return (
          "<tr><th scope=\"row\">" +
          esc(b.label) +
          "</th><td>" +
          esc(Treasury.formatPct(target)) +
          "</td><td>" +
          esc(Treasury.formatPct(actual)) +
          "</td><td>" +
          esc(Treasury.formatSignedPct(delta)) +
          "</td></tr>"
        );
      })
      .join("\n");
  }

  var bucketCards = buckets
    .map(function (b) {
      return (
        "<article class=\"bucket\"><h3>" +
        esc(b.label) +
        "</h3><p>" +
        esc(b.description || "") +
        "</p></article>"
      );
    })
    .join("\n");

  var largestLabel = summary.latestLargestBucket
    ? bucketById(buckets, summary.latestLargestBucket).label
    : "—";

  var cashFloorLabel =
    metrics.meta.cashFloor == null
      ? "—"
      : money(metrics.meta.cashFloor);

  var belowLine =
    summary.monthsBelowCashFloor == null
      ? "—"
      : String(summary.monthsBelowCashFloor) +
        " of " +
        String(summary.cashFloorComparableMonths);

  var offMixLine =
    summary.monthsOffTargetMix == null
      ? "—"
      : String(summary.monthsOffTargetMix) +
        " of " +
        String(summary.mixComparableMonths);

  return (
    "<!DOCTYPE html>\n" +
    "<html lang=\"en\">\n" +
    "<head>\n" +
    "  <meta charset=\"utf-8\">\n" +
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "  <title>" +
    esc(metrics.meta.entity || "Treasury deployment tracker") +
    "</title>\n" +
    "  <link rel=\"stylesheet\" href=\"css/style.css\">\n" +
    "  <!-- statically rendered by scripts/render-static.js; tables do not require JavaScript -->\n" +
    "</head>\n" +
    "<body>\n" +
    "<div class=\"wrap\">\n" +
    "  <header class=\"hero\">\n" +
    "    <p class=\"kicker\">Public treasury deployment tracker</p>\n" +
    "    <h1>" +
    esc(metrics.meta.entity || "Treasury") +
    "</h1>\n" +
    "    <p class=\"lede\">Monthly cash and short-duration investment balances, allocation mix, concentration, and policy-floor status. Tables below are baked into this HTML so a first paint (and <code>curl</code>) shows the numbers without JavaScript.</p>\n" +
    "    <p class=\"meta-line\">As of " +
    esc(metrics.meta.asOf || summary.latestLabel || "") +
    " · Updated " +
    esc(metrics.meta.updated || "") +
    " · " +
    esc(String(summary.monthCount)) +
    " months · " +
    esc(String(summary.bucketCount)) +
    " buckets · Currency " +
    esc(currency) +
    "</p>\n" +
    "  </header>\n" +
    "\n" +
    "  <div class=\"cards\" aria-label=\"Summary metrics\">\n" +
    "    <div class=\"card\"><span class=\"label\">Latest total</span><span class=\"value\">" +
    esc(money(summary.latestTotal)) +
    "</span><span class=\"hint\">" +
    esc(summary.latestLabel || "") +
    "</span></div>\n" +
    "    <div class=\"card\"><span class=\"label\">Cash share</span><span class=\"value\">" +
    esc(
      Treasury.formatPct(
        summary.latestAllocation && summary.latestAllocation.cash
      )
    ) +
    "</span><span class=\"hint\">Target " +
    esc(
      Treasury.formatPct(
        metrics.meta.targetMix && metrics.meta.targetMix.cash
      )
    ) +
    "</span></div>\n" +
    "    <div class=\"card\"><span class=\"label\">Concentration</span><span class=\"value\">" +
    esc(Treasury.formatPct(summary.latestConcentration)) +
    "</span><span class=\"hint\">Largest: " +
    esc(largestLabel) +
    "</span></div>\n" +
    "    <div class=\"card\"><span class=\"label\">Cash floor</span><span class=\"value\">" +
    esc(belowLine) +
    "</span><span class=\"hint\">Policy minimum " +
    esc(cashFloorLabel) +
    "</span></div>\n" +
    "    <div class=\"card\"><span class=\"label\">Off-target mix</span><span class=\"value\">" +
    esc(offMixLine) +
    "</span><span class=\"hint\">Tolerance ±" +
    esc(Treasury.formatPct(metrics.meta.mixTolerance, 0)) +
    "</span></div>\n" +
    "  </div>\n" +
    "\n" +
    "  <section>\n" +
    "    <h2>Deployment buckets</h2>\n" +
    "    <p class=\"section-note\">Named lines used in the public tracker. Amounts are end-of-month book balances.</p>\n" +
    "    <div class=\"buckets\">\n" +
    bucketCards +
    "\n    </div>\n" +
    "  </section>\n" +
    "\n" +
    "  <section id=\"deployments\">\n" +
    "    <h2>Monthly deployments</h2>\n" +
    "    <p class=\"section-note\">End-of-month balances by bucket. Row highlight marks months below the cash floor.</p>\n" +
    "    <div class=\"table-wrap\">\n" +
    "      <table data-static=\"true\">\n" +
    "        <caption>Treasury deployment amounts (USD)</caption>\n" +
    "        <thead>\n" +
    "          <tr><th scope=\"col\">Month</th>" +
    bucketHeadings() +
    "<th scope=\"col\">Total</th></tr>\n" +
    "        </thead>\n" +
    "        <tbody>\n" +
    amountRows +
    "\n        </tbody>\n" +
    "      </table>\n" +
    "    </div>\n" +
    "  </section>\n" +
    "\n" +
    "  <section id=\"allocation\">\n" +
    "    <h2>Allocation mix</h2>\n" +
    "    <p class=\"section-note\">Each bucket as a share of that month’s total. Concentration is the largest bucket’s share.</p>\n" +
    "    <div class=\"table-wrap\">\n" +
    "      <table data-static=\"true\">\n" +
    "        <caption>Percent allocation by bucket</caption>\n" +
    "        <thead>\n" +
    "          <tr><th scope=\"col\">Month</th>" +
    bucketHeadings() +
    "<th scope=\"col\">Concentration</th></tr>\n" +
    "        </thead>\n" +
    "        <tbody>\n" +
    allocRows +
    "\n        </tbody>\n" +
    "      </table>\n" +
    "    </div>\n" +
    "  </section>\n" +
    "\n" +
    "  <section id=\"mom\">\n" +
    "    <h2>Month-over-month change</h2>\n" +
    "    <p class=\"section-note\">Change versus the prior month. The first month has no prior period (shown as —). Percent change is null when the prior amount is zero.</p>\n" +
    "    <div class=\"table-wrap\">\n" +
    "      <table data-static=\"true\">\n" +
    "        <caption>MoM change in total deployment and cash</caption>\n" +
    "        <thead>\n" +
    "          <tr><th scope=\"col\">Month</th><th scope=\"col\">Total Δ $</th><th scope=\"col\">Total Δ %</th><th scope=\"col\">Cash Δ $</th><th scope=\"col\">Cash Δ %</th></tr>\n" +
    "        </thead>\n" +
    "        <tbody>\n" +
    momRows +
    "\n        </tbody>\n" +
    "      </table>\n" +
    "    </div>\n" +
    "  </section>\n" +
    "\n" +
    "  <section id=\"policy\">\n" +
    "    <h2>Cash floor, concentration, and target mix</h2>\n" +
    "    <p class=\"section-note\">Cash floor " +
    esc(cashFloorLabel) +
    ". Mix is off-target when any bucket differs from the policy midpoint by more than ±" +
    esc(Treasury.formatPct(metrics.meta.mixTolerance, 0)) +
    ".</p>\n" +
    "    <div class=\"table-wrap\">\n" +
    "      <table data-static=\"true\">\n" +
    "        <caption>Policy status by month</caption>\n" +
    "        <thead>\n" +
    "          <tr><th scope=\"col\">Month</th><th scope=\"col\">Cash</th><th scope=\"col\">Cash floor</th><th scope=\"col\">Concentration</th><th scope=\"col\">Largest bucket</th><th scope=\"col\">Target mix</th></tr>\n" +
    "        </thead>\n" +
    "        <tbody>\n" +
    policyRows +
    "\n        </tbody>\n" +
    "      </table>\n" +
    "    </div>\n" +
    "  </section>\n" +
    "\n" +
    "  <section id=\"latest-mix\">\n" +
    "    <h2>Latest mix versus target</h2>\n" +
    "    <p class=\"section-note\">" +
    esc(summary.latestLabel || "") +
    " allocation compared with the investment-policy midpoint.</p>\n" +
    "    <div class=\"table-wrap\">\n" +
    "      <table data-static=\"true\">\n" +
    "        <caption>Target mix versus latest actual</caption>\n" +
    "        <thead>\n" +
    "          <tr><th scope=\"col\">Bucket</th><th scope=\"col\">Target</th><th scope=\"col\">Actual</th><th scope=\"col\">Delta</th></tr>\n" +
    "        </thead>\n" +
    "        <tbody>\n" +
    targetCells +
    "\n        </tbody>\n" +
    "      </table>\n" +
    "    </div>\n" +
    "  </section>\n" +
    "\n" +
    "  <footer>\n" +
    "    <p>" +
    esc(metrics.meta.notes || "Sample treasury dataset.") +
    "</p>\n" +
    "    <p>Source data: <a href=\"data/treasury.json\">data/treasury.json</a>. Re-render with <code>node scripts/render-static.js</code>. JavaScript only enhances this page; the tables above are in the markup.</p>\n" +
    "  </footer>\n" +
    "</div>\n" +
    "<script src=\"js/treasury.js\"></script>\n" +
    "<script>\n" +
    "  document.documentElement.classList.add(\"js-enhanced\");\n" +
    "</script>\n" +
    "</body>\n" +
    "</html>\n"
  );
}

function main() {
  var raw = fs.readFileSync(DATA_PATH, "utf8");
  var data = JSON.parse(raw);
  var html = render(data);
  fs.writeFileSync(OUT_PATH, html, "utf8");
  process.stdout.write("Wrote " + path.relative(ROOT, OUT_PATH) + "\n");
}

if (require.main === module) {
  main();
}

module.exports = { render: render };
