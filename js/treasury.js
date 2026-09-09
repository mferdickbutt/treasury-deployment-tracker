/**
 * Treasury deployment metrics.
 * Works as a Node CommonJS module and as a browser global (`Treasury`).
 *
 * All ratios are 0–1. Division by zero / empty inputs return null
 * (never NaN or Infinity).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Treasury = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function isFiniteNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  function toNumber(value, fallback) {
    if (value == null || value === "") return fallback;
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * Safe division. Returns null when the denominator is 0/non-finite
   * or the result would be NaN/Infinity.
   */
  function safeDiv(numerator, denominator) {
    if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator)) return null;
    if (denominator === 0) return null;
    var result = numerator / denominator;
    return Number.isFinite(result) ? result : null;
  }

  function inferBuckets(data) {
    if (data && Array.isArray(data.buckets) && data.buckets.length > 0) {
      return data.buckets.map(function (b) {
        return {
          id: String(b.id),
          label: b.label != null ? String(b.label) : String(b.id),
          description: b.description != null ? String(b.description) : "",
        };
      });
    }
    var ids = [];
    var seen = Object.create(null);
    var months = (data && data.months) || [];
    for (var i = 0; i < months.length; i++) {
      var dep = (months[i] && months[i].deployments) || {};
      var keys = Object.keys(dep);
      for (var k = 0; k < keys.length; k++) {
        if (!seen[keys[k]]) {
          seen[keys[k]] = true;
          ids.push(keys[k]);
        }
      }
    }
    return ids.map(function (id) {
      return { id: id, label: id, description: "" };
    });
  }

  function monthLabel(month, fallbackLabel) {
    if (fallbackLabel) return String(fallbackLabel);
    if (!month || typeof month !== "string") return "";
    var match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) return month;
    var names = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    var idx = Number(match[2]) - 1;
    if (idx < 0 || idx > 11) return month;
    return names[idx] + " " + match[1];
  }

  function deploymentsFor(month, buckets) {
    var src = (month && month.deployments) || {};
    var out = {};
    var total = 0;
    for (var i = 0; i < buckets.length; i++) {
      var id = buckets[i].id;
      var n = toNumber(src[id], 0);
      out[id] = n;
      total += n;
    }
    return { deployments: out, total: total };
  }

  function allocationMap(deployments, buckets, total) {
    var alloc = {};
    var largestBucket = null;
    var largestAmt = -Infinity;
    for (var i = 0; i < buckets.length; i++) {
      var id = buckets[i].id;
      var amount = deployments[id] || 0;
      alloc[id] = total === 0 ? null : safeDiv(amount, total);
      if (amount > largestAmt) {
        largestAmt = amount;
        largestBucket = id;
      }
    }
    if (total === 0 || buckets.length === 0) {
      return { allocation: alloc, largestBucket: null, concentration: null };
    }
    return {
      allocation: alloc,
      largestBucket: largestBucket,
      concentration: alloc[largestBucket],
    };
  }

  function mixStatus(allocation, targetMix, tolerance, buckets) {
    if (!targetMix || typeof targetMix !== "object") {
      return { offTarget: null, deltas: null };
    }
    var deltas = {};
    var off = false;
    var compared = false;
    for (var i = 0; i < buckets.length; i++) {
      var id = buckets[i].id;
      if (targetMix[id] == null) {
        deltas[id] = null;
        continue;
      }
      var target = toNumber(targetMix[id], null);
      if (target == null) {
        deltas[id] = null;
        continue;
      }
      compared = true;
      var actual = allocation[id];
      if (actual == null) {
        deltas[id] = null;
        off = true;
        continue;
      }
      var delta = actual - target;
      deltas[id] = Number.isFinite(delta) ? delta : null;
      if (deltas[id] != null && Math.abs(deltas[id]) > tolerance) off = true;
    }
    if (!compared) return { offTarget: null, deltas: deltas };
    return { offTarget: off, deltas: deltas };
  }

  function mean(values) {
    var sum = 0;
    var count = 0;
    for (var i = 0; i < values.length; i++) {
      if (isFiniteNumber(values[i])) {
        sum += values[i];
        count += 1;
      }
    }
    return count === 0 ? null : safeDiv(sum, count);
  }

  /**
   * Compute deployment metrics for a treasury dataset.
   * @param {object|null|undefined} data
   * @returns {object}
   */
  function compute(data) {
    var src = data && typeof data === "object" ? data : {};
    var meta = src.meta && typeof src.meta === "object" ? src.meta : {};
    var buckets = inferBuckets(src);
    var monthsIn = Array.isArray(src.months) ? src.months : [];
    var cashFloor =
      meta.cashFloor == null ? null : toNumber(meta.cashFloor, null);
    var cashBucketId = meta.cashBucketId ? String(meta.cashBucketId) : "cash";
    var targetMix =
      meta.targetMix && typeof meta.targetMix === "object"
        ? meta.targetMix
        : null;
    var mixTolerance = toNumber(meta.mixTolerance, 0.05);
    if (mixTolerance == null) mixTolerance = 0.05;

    var months = [];
    var belowFloor = 0;
    var aboveFloor = 0;
    var offMix = 0;
    var floorComparable = 0;
    var mixComparable = 0;

    for (var i = 0; i < monthsIn.length; i++) {
      var raw = monthsIn[i] || {};
      var rolled = deploymentsFor(raw, buckets);
      var total = rolled.total;
      var allocInfo = allocationMap(rolled.deployments, buckets, total);
      var prev = i > 0 ? months[i - 1] : null;

      var momAbs = {};
      var momPct = {};
      var totalMomAbs = null;
      var totalMomPct = null;
      if (prev) {
        totalMomAbs =
          isFiniteNumber(total) && isFiniteNumber(prev.total)
            ? total - prev.total
            : null;
        totalMomPct = safeDiv(totalMomAbs, prev.total);
        for (var b = 0; b < buckets.length; b++) {
          var id = buckets[b].id;
          var diff = rolled.deployments[id] - prev.deployments[id];
          momAbs[id] = Number.isFinite(diff) ? diff : null;
          momPct[id] = safeDiv(momAbs[id], prev.deployments[id]);
        }
      } else {
        for (var b0 = 0; b0 < buckets.length; b0++) {
          momAbs[buckets[b0].id] = null;
          momPct[buckets[b0].id] = null;
        }
      }

      var cashAmount =
        rolled.deployments[cashBucketId] != null
          ? rolled.deployments[cashBucketId]
          : null;
      var below = null;
      if (cashFloor != null && cashAmount != null) {
        below = cashAmount < cashFloor;
        floorComparable += 1;
        if (below) belowFloor += 1;
        else aboveFloor += 1;
      }

      var mix = mixStatus(
        allocInfo.allocation,
        targetMix,
        mixTolerance,
        buckets
      );
      if (mix.offTarget != null) {
        mixComparable += 1;
        if (mix.offTarget) offMix += 1;
      }

      months.push({
        month: raw.month != null ? String(raw.month) : "",
        label: monthLabel(raw.month, raw.label),
        deployments: rolled.deployments,
        total: total,
        allocation: allocInfo.allocation,
        concentration: allocInfo.concentration,
        largestBucket: allocInfo.largestBucket,
        momAbs: momAbs,
        momPct: momPct,
        totalMomAbs: totalMomAbs,
        totalMomPct: totalMomPct,
        cashAmount: cashAmount,
        belowCashFloor: below,
        offTargetMix: mix.offTarget,
        mixDeltas: mix.deltas,
      });
    }

    var latest = months.length ? months[months.length - 1] : null;
    var totals = months.map(function (m) {
      return m.total;
    });
    var concentrations = months.map(function (m) {
      return m.concentration;
    });

    return {
      meta: {
        entity: meta.entity != null ? String(meta.entity) : "",
        currency: meta.currency != null ? String(meta.currency) : "USD",
        asOf: meta.asOf != null ? String(meta.asOf) : "",
        updated: meta.updated != null ? String(meta.updated) : "",
        notes: meta.notes != null ? String(meta.notes) : "",
        cashFloor: cashFloor,
        cashBucketId: cashBucketId,
        targetMix: targetMix,
        mixTolerance: mixTolerance,
      },
      buckets: buckets,
      months: months,
      summary: {
        monthCount: months.length,
        bucketCount: buckets.length,
        latestMonth: latest ? latest.month : null,
        latestLabel: latest ? latest.label : null,
        latestTotal: latest ? latest.total : null,
        latestAllocation: latest ? latest.allocation : null,
        latestConcentration: latest ? latest.concentration : null,
        latestLargestBucket: latest ? latest.largestBucket : null,
        avgTotal: mean(totals),
        avgConcentration: mean(concentrations),
        monthsBelowCashFloor: cashFloor == null ? null : belowFloor,
        monthsAboveCashFloor: cashFloor == null ? null : aboveFloor,
        cashFloorComparableMonths: cashFloor == null ? null : floorComparable,
        monthsOffTargetMix: targetMix == null ? null : offMix,
        monthsOnTargetMix: targetMix == null ? null : mixComparable - offMix,
        mixComparableMonths: targetMix == null ? null : mixComparable,
      },
    };
  }

  function formatMoney(n, currency) {
    if (!isFiniteNumber(n)) return "—";
    var code = currency || "USD";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        maximumFractionDigits: 0,
      }).format(n);
    } catch (err) {
      return String(Math.round(n));
    }
  }

  function formatPct(ratio, digits) {
    if (!isFiniteNumber(ratio)) return "—";
    var d = digits == null ? 1 : digits;
    return (ratio * 100).toFixed(d) + "%";
  }

  function formatSignedPct(ratio, digits) {
    if (!isFiniteNumber(ratio)) return "—";
    var d = digits == null ? 1 : digits;
    var pct = ratio * 100;
    var sign = pct > 0 ? "+" : "";
    return sign + pct.toFixed(d) + "%";
  }

  function formatSignedMoney(n, currency) {
    if (!isFiniteNumber(n)) return "—";
    var formatted = formatMoney(Math.abs(n), currency);
    if (n > 0) return "+" + formatted;
    if (n < 0) return "−" + formatted;
    return formatted;
  }

  return {
    compute: compute,
    safeDiv: safeDiv,
    monthLabel: monthLabel,
    formatMoney: formatMoney,
    formatPct: formatPct,
    formatSignedPct: formatSignedPct,
    formatSignedMoney: formatSignedMoney,
  };
});
