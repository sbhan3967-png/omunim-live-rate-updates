/* OMUNIM Live MCX Rate Calculator — BOOKMARKLET build (no extension).
   Version: 1.7-web (2026-11-28) — same maths as extension v1.7, including
   the stone-table fix (GR1's CS 73,935 was missing) and
   the purity-rate Quotation fix: metalRate = (MCX + premium) x item purity
   (76% item quotes at the 18K rate, 60% / 14K item at the 14K rate).
   Works on any laptop / any browser with just internet: save it as a
   bookmark, open the OMUNIM OwnerHome page, click the bookmark.

   RATE SOURCE: the page script first tries https://mcxlive.org/gold/ and
   /silver/ directly. mcxlive.org sends no CORS header, so a page script is
   usually blocked by the browser — then the rate comes from OMUNIM's own
   top bar ("MCX Gold:..." / "MCX Silver:..."), OMUNIM's server-side live
   MCX rate, and the panel labels the source honestly ("OMUNIM top bar se").
   No proxy is used anywhere.

   LOADING: the bookmarklet loader fetches this file from
   raw.githubusercontent.com/sbhan3967-png/omunim-live-rate-updates/main/
   omunim-live-rate.js and runs it in the OMUNIM page. The loader always
   fetches the latest file, so there is no update check and no install.
   Settings (premiums) live in localStorage, not in any extension storage.
   Display + Quotation navigation only — it never saves, bills or edits
   anything in OMUNIM.
*/

/* OMUNIM Live MCX Rate Calculator — pure parsing / calculation helpers.
   No browser-extension APIs in this file — the same pure logic is
   shared by the extension build and this bookmarklet build.

   VERIFIED FACTS (browser verification, 22 Nov 2026, DLR16 / barcode 1016):
   - Detail opens inside OwnerHome by AJAX panel swap; URL stays
     https://release.omunim.in/2/omHomePage.php?divPanel=OwnerHome
   - Every field is a table row: label | ":" | value (plain text, no
     reliable ids/classes) — so parsing anchors on exact label text.
   - Metal Amount 34,977.02 = fine 2.7072 g x pure Rs 12,920/g
     (i.e. Rs 1,29,200/10 g at stock-entry time). Net 4.512 g x Final
     Purity 60% = 2.7072 g. Making 1,200 x 2.7072 = 3,248.64.
   - GST = 3% of Total Amount. dia Amt 43,600 = stone-table AMT.
   - v1.7: stone amount comes from the stone TABLE (SR.NO./DETAILS/
     COLOR/CLARITY/QTY/GS WT/AMT) when one exists — GR1's CS 73,935
     has no "dia Amt" label. Table wins, label is the fallback.
   - Top bar itself shows "MCX Gold:121949" / "MCX Silver:148900".

   MCX SOURCE: https://mcxlive.org/gold/ and /silver/ — the live quote
   is embedded as window.FD_FEED JSON (last = per 10 g gold, per 1 kg
   silver). Same source + parser as the Weighing Scale app v1.48.
   Old "Last Trade" table parser is kept as fallback.
*/

function parseNum(s) {
  if (s === null || s === undefined) return null;
  var n = parseFloat(String(s).replace(/[,\u20b9\s]/g, ""));
  return isNaN(n) ? null : n;
}

function formatINR(n, decimals) {
  if (decimals === undefined) decimals = 2;
  if (n === null || n === undefined || isNaN(n)) return "-";
  try {
    return Number(n).toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  } catch (e) {
    return Number(n).toFixed(decimals);
  }
}

/* ---- MCX page parsing (mcxlive.org) ---- */

function parseFdFeed(html, metal) {
  if (!html) return null;
  try {
    var m = html.match(/window\.FD_FEED=(\{.*?\});window\.FD_DATA/s);
    if (!m) return null;
    var d = JSON.parse(m[1]);
    var last = parseFloat(d.last);
    if (!(last > 0)) return null;
    var close = parseFloat(d.close) || 0;
    var change = d.c_value !== undefined ? parseFloat(d.c_value) : (close ? last - close : 0);
    var pct = d.c_percent !== undefined ? parseFloat(d.c_percent) : (close ? (change / close) * 100 : 0);
    var out = {
      metal: metal,
      last: last,
      change: change,
      change_pct: pct,
      contract: String(d.expiry || d.name || ""),
      as_on: String(d.c_datetime || ""),
      last_trade: String(d.t_datetime || ""),
      status: String(d.status || ""),
      unit: metal === "GOLD" ? "10 g" : "1 kg"
    };
    ["high", "low", "open"].forEach(function (k) {
      if (d[k] !== undefined) out[k] = parseFloat(d[k]);
    });
    return out;
  } catch (e) {
    return null;
  }
}

function parseMcxPage(html, metal) {
  if (!html) return null;
  var fd = parseFdFeed(html, metal);
  if (fd) return fd;
  // Fallback: old server-rendered "Last Trade" table layout.
  try {
    var lastM = html.match(
      /Last Trade<\/td>[\s\S]*?<td class="main-change[^"]*">.*?([\d,]+)<\/td>\s*<td class="main-change[^"]*">\s*([+-]?[\d,]+)<\/td>\s*<td class="main-change[^"]*">\s*([+-]?[\d.]+%)<\/td>/);
    if (!lastM) return null;
    var contractM = html.match(/<h2 class="main-head">MCX (?:Gold|Silver)\s+([^<]+)<\/h2>/);
    var asOnM = html.match(/As on\s+([^<]+?),\s*India Time/);
    return {
      metal: metal,
      last: parseNum(lastM[1]),
      change: parseNum(lastM[2]),
      change_pct: parseFloat(String(lastM[3]).replace("%", "")),
      contract: contractM ? contractM[1].trim() : "",
      as_on: asOnM ? asOnM[1].trim() : "",
      last_trade: "",
      status: "",
      unit: metal === "GOLD" ? "10 g" : "1 kg"
    };
  } catch (e) {
    return null;
  }
}

/* ---- OMUNIM panel parsing (by exact label text) ---- */

function _labelNum(text, labelPattern) {
  var re = new RegExp(labelPattern + "\\s*:\\s*([\\d,]+\\.?\\d*)", "i");
  var m = text.match(re);
  return m ? parseNum(m[1]) : null;
}

/* ---- Stone table parsing (v1.7) ----
   Items whose stone is a TABLE row, not a "dia Amt" label (GR1, 28 Nov
   2026: CS 7.950 CT, AMT 73,935 — the old parser read diaAmt = 0 and
   the panel showed 174,712.72 instead of 250,865.77). In innerText the
   table is TAB-separated cells:
     SR.NO.\tDETAILS\tCOLOR\tCLARITY\tQTY\tGS WT\tAMT
     1\tCS\t-\t-\t1\t7.950 CT\t73935
   (the Node test text uses spaces — both separators are handled).
   Rule: if a stone table exists, its AMT sum IS the stone amount
   (the "dia Amt" label, if any, is the SAME amount — DLR16 has both,
   table 43,600 = label 43,600 — so taking the table never
   double-counts). If no table exists, fall back to the label. */
function parseStoneTable(text) {
  if (!text) return null;
  var lines = String(text).split("\n");
  var total = 0, rows = 0, inTable = false;
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var norm = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    if (/^SR\.?\s*NO\.?/i.test(norm) && /\bAMT\b/i.test(norm)) { inTable = true; continue; }
    if (!inTable || !norm) continue;
    var cells = raw.split("\t").map(function (c) { return c.trim(); }).filter(function (c) { return c !== ""; });
    if (cells.length < 2) cells = norm.split(" ");
    if (cells.length < 2 || !/^\d+$/.test(cells[0])) { inTable = false; continue; }
    var amt = parseNum(cells[cells.length - 1]);
    if (amt === null) continue; // row without an amount: skip, keep table open
    total += amt; rows++;
  }
  return rows ? total : null;
}

function parsePanelText(text) {
  if (!text) return null;
  // Normalise: non-breaking spaces, "Rs." artefacts, tabs.
  var t = String(text).replace(/\u00a0/g, " ");
  if (!/ITEM DETAILS PANEL/i.test(t) && !/Product Code\s*:/i.test(t)) return null;

  var p = {};
  var m;
  m = t.match(/Product Code\s*:\s*([A-Za-z0-9\-_]+)/i);
  p.productCode = m ? m[1] : null;
  m = t.match(/Barcode No\s*:\s*([A-Za-z0-9\-]+)/i);
  p.barcode = m ? m[1] : null;
  m = t.match(/Metal\s*:\s*(Gold|Silver|Platinum)/i);
  p.metal = m ? m[1] : null;
  // Product name is the heading (e.g. "Dlring") — best effort only.
  m = t.match(/ITEM DETAILS PANEL[\s\S]{0,400}?\n\s*([A-Za-z][A-Za-z ]{2,30})\n/i);
  p.productName = m ? m[1].trim() : null;

  p.qty = _labelNum(t, "Item Quantity");
  p.grossWt = _labelNum(t, "Gross Weight");
  p.lessWt = _labelNum(t, "Less Weight");
  p.netWt = _labelNum(t, "Net Weight");
  p.totalWt = _labelNum(t, "Total Weight");
  p.purity = _labelNum(t, "Purity");
  p.wastage = _labelNum(t, "Item Wastage");
  p.finalPurity = _labelNum(t, "Final Purity");
  p.fineWt = _labelNum(t, "Fine Weight");
  p.finalFineWt = _labelNum(t, "Final Fine Weight");

  m = t.match(/Other Charges\s*:\s*([\d,]+)\s*Fixed/i);
  p.otherChargesFixed = m ? parseNum(m[1]) : null;

  p.metalAmtOld = _labelNum(t, "Metal Amount");
  p.diaAmt = _labelNum(t, "dia Amt");
  // v1.7: stone table (CS/DIA/...) wins over the "dia Amt" label when it
  // exists (same amount on items that have both — never double-counted);
  // items like GR1 have ONLY the table, so without this the stone was 0.
  p.stoneTableAmt = parseStoneTable(t);
  if (p.stoneTableAmt !== null) p.diaAmt = p.stoneTableAmt;
  m = t.match(/Making Charges\s*(?:\(([^)]*)\))?\s*:\s*([\d,]+\.\d{2})/i);
  p.makingAmtOld = m ? parseNum(m[2]) : null;
  p.makingBracket = m && m[1] ? m[1].trim() : null;
  p.hallmarkAmt = _labelNum(t, "Hallmark Charges");
  // Right-column Other Charges has decimals (1,000.00); the middle
  // "1000 Fixed" has none, so the decimal form picks the right one.
  var others = [];
  var reOther = /Other Charges\s*:\s*([\d,]+\.\d{2})/gi;
  var om;
  while ((om = reOther.exec(t)) !== null) others.push(parseNum(om[1]));
  p.otherAmt = others.length ? others[0] : null;
  p.totalAmtOld = _labelNum(t, "Total Amount");
  p.gstAmtOld = _labelNum(t, "GST Amount");
  m = t.match(/Price\s*:\s*\u20b9?\s*([\d,]+\.\d{2})/i);
  p.priceOld = m ? parseNum(m[1]) : null;
  m = t.match(/Final Price\s*\u20b9?\s*([\d,]+\.\d{2})/i);
  p.finalPriceOld = m ? parseNum(m[1]) : null;

  // OMUNIM's own top bar also shows MCX — fallback if mcxlive fetch fails.
  m = t.match(/MCX Gold\s*:\s*([\d,]+)/i);
  p.topMcxGold = m ? parseNum(m[1]) : null;
  m = t.match(/MCX Silver\s*:\s*([\d,]+)/i);
  p.topMcxSilver = m ? parseNum(m[1]) : null;

  // Nothing usable without weights.
  if (p.netWt === null && p.fineWt === null && p.totalWt === null) return null;
  return p;
}

/* ---- Price calculation ----
   The OMUNIM Metal Amount is NEVER used. Fresh metal value is:
     Gold:   fineWt(g) x (MCX gold + gold premium) / 10
     Silver: fineWt(g) / 1000 x (MCX silver + silver premium)
   Fine weight is taken unrounded where possible: Net x Final Purity%,
   because OMUNIM itself used 2.7072 g (not the displayed 2.707 g).
   Making: % -> % of new metal; GM -> rate x the weight it was charged
   on (found by matching displayed making / rate to a known weight,
   else fine weight); PP/PC -> rate x qty; Fixed / no bracket -> as shown.
   GST rate is read from the page (GST / Total, normally 3%), else 3%.
*/
function computePrice(p, rates, premiums) {
  premiums = premiums || {};
  var isSilver = !!(p.metal && /silver/i.test(p.metal));
  var mcxRaw = isSilver ? (rates && rates.silver && rates.silver.last) : (rates && rates.gold && rates.gold.last);
  var premium = isSilver ? (parseFloat(premiums.silver) || 0) : (parseFloat(premiums.gold) || 0);
  var mcx = (mcxRaw === null || mcxRaw === undefined) ? null : mcxRaw + premium;
  var ratePerGram = null;
  if (mcx !== null) ratePerGram = isSilver ? mcx / 1000 : mcx / 10;

  var fineExact = null;
  if (p.netWt !== null && p.finalPurity !== null) fineExact = (p.netWt * p.finalPurity) / 100;
  else if (p.netWt !== null && p.purity !== null) fineExact = (p.netWt * p.purity) / 100;
  else if (p.finalFineWt !== null) fineExact = p.finalFineWt;
  else if (p.fineWt !== null) fineExact = p.fineWt;

  var fineShown = p.finalFineWt !== null ? p.finalFineWt : (p.fineWt !== null ? p.fineWt : fineExact);
  var newMetal = (ratePerGram !== null && fineExact !== null) ? fineExact * ratePerGram : null;

  // Making charges.
  var making = { amount: p.makingAmtOld || 0, basis: "as shown", rate: null, unit: null };
  if (p.makingBracket) {
    var b = p.makingBracket;
    var bm = b.match(/([\d,]+\.?\d*)\s*(%|GM|G|PP|PC|PER PIECE|PIECE|FIXED)?/i);
    if (bm) {
      var rate = parseNum(bm[1]);
      var unit = (bm[2] || "").toUpperCase();
      making.rate = rate;
      making.unit = unit;
      if (unit === "%") {
        making.amount = newMetal !== null ? (newMetal * rate) / 100 : (p.makingAmtOld || 0);
        making.basis = rate + "% of new metal amount";
      } else if (unit === "PP" || unit === "PC" || unit === "PER PIECE" || unit === "PIECE") {
        var qty = p.qty || 1;
        making.amount = rate * qty;
        making.basis = "Rs " + formatINR(rate, 0) + " x " + qty + " pc";
      } else if (unit === "GM" || unit === "G") {
        // Which weight was it charged on? Match displayed / rate.
        var base = fineExact, baseName = "fine wt";
        if (rate > 0 && p.makingAmtOld) {
          var implied = p.makingAmtOld / rate;
          var cands = [
            ["fine wt", fineExact], ["net wt", p.netWt],
            ["total wt", p.totalWt], ["gross wt", p.grossWt]
          ];
          for (var i = 0; i < cands.length; i++) {
            var cw = cands[i][1];
            if (cw && Math.abs(implied - cw) / cw < 0.005) { base = cw; baseName = cands[i][0]; break; }
          }
        }
        making.amount = rate * (base || 0);
        making.basis = "Rs " + formatINR(rate, 0) + "/g x " + (base !== null ? base.toFixed(3) : "-") + " g (" + baseName + ")";
      } else {
        making.amount = p.makingAmtOld || 0;
        making.basis = "as shown (" + b + ")";
      }
    }
  }

  var dia = p.diaAmt || 0;
  var hallmark = p.hallmarkAmt || 0;
  var other = p.otherAmt !== null ? p.otherAmt : (p.otherChargesFixed || 0);
  var subtotal = newMetal !== null ? newMetal + dia + making.amount + hallmark + other : null;

  var gstRate = 0.03;
  if (p.gstAmtOld && p.totalAmtOld) gstRate = p.gstAmtOld / p.totalAmtOld;
  var gst = subtotal !== null ? subtotal * gstRate : null;
  var finalPrice = subtotal !== null ? subtotal + gst : null;
  var oldFinal = p.finalPriceOld !== null ? p.finalPriceOld : (p.priceOld !== null ? p.priceOld : null);
  var diff = (finalPrice !== null && oldFinal !== null) ? finalPrice - oldFinal : null;

  return {
    isSilver: isSilver,
    mcxRaw: mcxRaw,
    premium: premium,
    mcxWithPremium: mcx,
    ratePerGram: ratePerGram,
    fineExact: fineExact,
    fineShown: fineShown,
    newMetal: newMetal,
    dia: dia,
    making: making,
    hallmark: hallmark,
    other: other,
    subtotal: subtotal,
    gstRate: gstRate,
    gst: gst,
    finalPrice: finalPrice,
    oldFinal: oldFinal,
    oldMetal: p.metalAmtOld,
    diff: diff
  };
}

/* ---- Rate picking (v1.2) ----
   Which rate should the panel use right now?
   - Background mcxlive rate fresh (< 90 s old): use it.
   - Background rate stale/missing BUT OMUNIM's own top bar shows an
     MCX rate ("MCX Gold:124908" — OMUNIM's server rate, always fresh
     while OMUNIM is open): use the top-bar rate, labelled fallback.
     A fallback rate object is always re-read from the page, never
     treated as fresh, so it keeps tracking the top bar.
   - Otherwise: keep whatever rate object we have (possibly null). */
function pickRate(mcx, parsed, nowMs) {
  nowMs = nowMs || Date.now();
  var age = (mcx && mcx.fetchedAt) ? nowMs - new Date(mcx.fetchedAt).getTime() : Infinity;
  if (mcx && mcx.source === "omunim-topbar") age = Infinity; // re-read every time
  // v1.3: a stale merge (fetch failed, last-good values reused) is stale
  // even if its fetchedAt was just stamped — judge by the fresh flags too.
  if (mcx && (mcx.goldFresh === false || mcx.silverFresh === false)) age = Infinity;
  if (mcx && age <= 90 * 1000) return { mcx: mcx, fallback: false };
  if (parsed && parsed.topMcxGold) {
    var silverLast = parsed.topMcxSilver || (mcx && mcx.silver ? mcx.silver.last : 0);
    return {
      mcx: {
        gold: { last: parsed.topMcxGold, status: "", last_trade: "" },
        silver: { last: silverLast, status: "", last_trade: "" },
        fetchedAt: new Date(nowMs).toISOString(),
        source: "omunim-topbar"
      },
      fallback: true
    };
  }
  return { mcx: mcx, fallback: false };
}

/* ---- Rate board (v1.3) ----
   User's own purity map: 22K = 92%, 20K = 85%, 18K = 76%, 14K = 60%
   of the MCX gold rate (per 10 g). Silver is the MCX silver rate per kg.
   Prices are whole rupees, jeweller style. */
var BOARD_PURITY = [
  { label: "24K", pct: 100, f: 1.00 },
  { label: "22K", pct: 92, f: 0.92 },
  { label: "20K", pct: 85, f: 0.85 },
  { label: "18K", pct: 76, f: 0.76 },
  { label: "14K", pct: 60, f: 0.60 }
];
function boardRates(goldLast, silverLast, premiums) {
  // v1.4: dikhaya jaane wala rate premium ke BAAD wala hota hai —
  // board aur final price dono me MCX + premium use hota hai.
  var pg = (premiums && premiums.gold) || 0;
  var ps = (premiums && premiums.silver) || 0;
  var gold = (goldLast === null || goldLast === undefined) ? null : goldLast + pg;
  var silver = (silverLast === null || silverLast === undefined) ? null : silverLast + ps;
  var rows = BOARD_PURITY.map(function (r) {
    return {
      label: r.label, pct: r.pct,
      price: gold === null ? null : Math.round(gold * r.f),
      unit: "/10g"
    };
  });
  rows.push({
    label: "Silver", pct: null,
    price: silver === null ? null : Math.round(silver),
    unit: "/kg"
  });
  return rows;
}

/* ---- Quotation URL builder (v1.5) ----
   OMUNIM's Quotation button is an anchor whose onclick does
   window.open('.../ogiaquot.php?<params>', 'popup', 'width=410,height=420,...').
   The URL is baked server-side. The estimate page is a pure GET render
   (verified live 28 Nov 2026, 10-variant matrix on LGB1 + DLR16):
   - metalRate -> Gold Rate line + the "@ rate" on the NT WT line
   - custValuation -> NT WT amount AS-IS (not recomputed)
   - makingCharges / totalOthCharges / valueAdded / hallmarkCharges -> as-is
   - TAXABLE = custValuation + diaAmt(DB lookup) + making + other + valueAdded + hallmark
   - CGST/SGST = totalTax/2 each; TOTAL = TAXABLE + round(totalTax, 2)
   - custFinalValuation, productMRP, quotLay: no visible effect
   - dia comes from the DB item lookup (newItemId + newPreItemId), NOT the URL
   So: read the live onclick URL, substitute only the rate-dependent
   params, keep everything else (incl. newItemId/newPreItemId) untouched.
   Metal basis (user's choice, 28 Nov 2026): OMUNIM's own — NET weight x
   rate — so the receipt's arithmetic stays correct (2.070 GM @ rate =
   custValuation). The panel's FINAL PRICE stays fine-weight based.
   v1.6 fix (28 Nov): the rate is the rate OF THAT PURITY, not the 24K
   rate — metalRate = (MCX + premium) x purity (Final Purity, else
   Purity). So a 76% item quotes at the 18K rate, a 60% (14K) item at
   the 14K rate — the same purity rates the board shows. custValuation
   = netWt x metalRate/10, which equals fineWt x (MCX+premium)/10,
   and the receipt line stays arithmetically correct.
   Silver assumption (untested — no silver item checked live): metalRate
   is the per-kg rate, custValuation = netWt x rate/1000. */
function round2(n) { return Math.round(n * 100) / 100; }

function buildQuotationUrl(pageUrl, parsed, calc, effRate) {
  if (!pageUrl || !parsed || !calc || effRate === null || effRate === undefined) return null;
  var u;
  try { u = new URL(pageUrl); } catch (e) { return null; }
  if (u.pathname.indexOf("ogiaquot.php") === -1) return null;
  var isSilver = !!calc.isSilver;
  // v1.6: usi purity ka rate — 24K rate nahi.
  var purityFrac = null;
  if (parsed.finalPurity !== null && parsed.finalPurity !== undefined) purityFrac = parsed.finalPurity / 100;
  else if (parsed.purity !== null && parsed.purity !== undefined) purityFrac = parsed.purity / 100;
  var purityRate = round2(purityFrac !== null ? effRate * purityFrac : effRate);
  var ratePerGram = isSilver ? purityRate / 1000 : purityRate / 10;
  var netWt = parsed.netWt !== null && parsed.netWt !== undefined ? parsed.netWt
    : (parsed.totalWt !== null && parsed.totalWt !== undefined ? parsed.totalWt : parsed.grossWt);
  if (netWt === null || netWt === undefined) return null;
  var netMetal = netWt * ratePerGram;
  // Making against the NEW (net) metal: % scales with metal; GM/PP/Fixed unchanged.
  var makingAmt = calc.making ? calc.making.amount : (parsed.makingAmtOld || 0);
  if (calc.making && calc.making.unit === "%" && calc.making.rate) {
    makingAmt = (netMetal * calc.making.rate) / 100;
  }
  var dia = calc.dia || 0;
  var hallmark = calc.hallmark || 0;
  var other = calc.other || 0;
  var valueAdded = parseFloat(u.searchParams.get("valueAdded")) || 0;
  var taxable = netMetal + dia + makingAmt + hallmark + other + valueAdded;
  var gstRate = calc.gstRate || 0.03;
  var totalTax = round2(taxable * gstRate);
  var finalTotal = round2(taxable + totalTax);
  var p = u.searchParams;
  p.set("metalRate", String(purityRate));
  p.set("custValuation", String(round2(netMetal)));
  p.set("makingCharges", String(round2(makingAmt)));
  p.set("totalTax", String(totalTax));
  p.set("custFinalValuation", String(finalTotal));
  return u.toString();
}

/* ================= bookmarklet UI (page context) =================
   Adapted from the extension's content script. Differences:
   - storage is localStorage (keys omunimLiveRate.*), no extension APIs
   - no background worker: the MCX fetch runs in-page, with the OMUNIM
     top-bar rate as fallback (re-read from the page on every scan)
   - no toolbar popup: premium inputs live INSIDE the floating panel
   - no update banner: the loader always fetches this latest file
   - double-injection guard: a second bookmark click just re-shows
     the panel instead of building it twice
   OMUNIM's own page JS errors are pre-existing and unrelated; this
   code never depends on OMUNIM's scripts and never touches its data.
*/
(function () {
  "use strict";

  // Double-injection guard.
  if (window.__omunimLiveRateLoaded && window.__omunimLiveRate) {
    window.__omunimLiveRate.enabled = true;
    try { localStorage.setItem("omunimLiveRate.enabled", "1"); } catch (e) {}
    window.__omunimLiveRate.render();
    return;
  }
  window.__omunimLiveRateLoaded = true;

  var isOwnerHome =
    location.hostname === "release.omunim.in" &&
    location.pathname.indexOf("/2/omHomePage.php") !== -1 &&
    location.search.indexOf("divPanel=OwnerHome") !== -1;
  if (!isOwnerHome) {
    window.__omunimLiveRateLoaded = false;
    alert("OMUNIM Live Rate sirf OMUNIM ke OwnerHome page par chalega.\nPehle https://release.omunim.in/2/omHomePage.php?divPanel=OwnerHome kholo, phir bookmark dabao.");
    return;
  }

  var LS_GOLD = "omunimLiveRate.goldPremium";
  var LS_SILVER = "omunimLiveRate.silverPremium";
  var LS_ENABLED = "omunimLiveRate.enabled";

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var state = {
    parsed: null,
    calc: null,
    mcx: null,          // {gold, silver, fetchedAt, source, goldFresh, silverFresh}
    mcxError: null,
    mcxStale: false,
    mcxFallback: false, // true when rate came from OMUNIM's own top bar
    premiums: { gold: 0, silver: 0 },
    enabled: true,
    minimised: false,
    refreshing: false,
    nextRefreshAt: 0
  };

  /* ---------- floating panel (Shadow DOM, so OMUNIM CSS can't break it) ---------- */
  var host = document.createElement("div");
  host.id = "omunim-live-rate-host";
  host.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;font-family:Arial,sans-serif;";
  document.documentElement.appendChild(host);
  var shadow = host.attachShadow({ mode: "open" });

  var css = [
    ".panel{width:360px;max-width:calc(100vw - 24px);max-height:82vh;overflow:auto;background:#fff;border:2px solid #b8860b;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.35);color:#222;font-size:13px}",
    ".head{display:flex;align-items:center;gap:8px;background:linear-gradient(90deg,#8a6d1b,#b8860b);color:#fff;padding:9px 10px;position:sticky;top:0}",
    ".head b{flex:1;font-size:14px}",
    ".dot{width:9px;height:9px;border-radius:50%;background:#37d67a;display:inline-block}",
    ".dot.stale{background:#f5a623}",
    ".dot.off{background:#e5484d}",
    ".hbtn{background:rgba(255,255,255,.22);border:0;color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px}",
    ".body{padding:10px 12px 12px}",
    ".row{display:flex;justify-content:space-between;gap:10px;padding:3px 0}",
    ".row .k{color:#555}",
    ".row .v{text-align:right;font-variant-numeric:tabular-nums}",
    ".strike{text-decoration:line-through;color:#999}",
    ".final{background:#e8f7ee;border:1.5px solid #1e9e4a;border-radius:8px;padding:8px 10px;margin-top:8px;display:flex;justify-content:space-between;align-items:center}",
    ".final b{font-size:19px;color:#0d7a33}",
    ".diff{font-weight:bold}",
    ".diff.up{color:#c0392b}.diff.down{color:#0d7a33}",
    ".note{font-size:11.5px;color:#666;margin-top:8px;line-height:1.45}",
    ".warn{font-size:11.5px;color:#8a5a00;background:#fff4d6;border-radius:6px;padding:6px 8px;margin-top:8px;line-height:1.45}",
    ".prem{display:flex;gap:8px;margin-top:10px}",
    ".prem label{flex:1;font-size:11.5px;color:#555}",
    ".prem input{width:100%;box-sizing:border-box;padding:6px;border:1px solid #ccc;border-radius:6px;margin-top:3px;font-size:13px}",
    ".small{font-size:11.5px;color:#777}",
    "hr{border:0;border-top:1px solid #e5e5e5;margin:8px 0}"
  ].join("\n");

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function inr(n, d) { return "\u20b9" + formatINR(n, d === undefined ? 2 : d); }

  function render() {
    if (!state.enabled) { shadow.innerHTML = ""; return; }
    // Premium type karte waqt focus na khoye: render se pehle focus yaad rakho.
    var ae = shadow.activeElement;
    var focusId = ae && ae.id ? ae.id : null;
    var focusVal = ae && ae.value !== undefined ? ae.value : null;
    var focusSel = null;
    if (ae && ae.selectionStart !== undefined) {
      try { focusSel = [ae.selectionStart, ae.selectionEnd]; } catch (e) {}
    }
    var dotCls = !state.mcx ? "off" : (state.mcxStale || state.mcxFallback ? "stale" : "");
    var dotTitle = !state.mcx ? "Rate nahi mila" : (state.mcxStale ? "Purana rate — refresh ho raha hai" : "Live rate");
    var head = '<div class="head"><span class="dot ' + dotCls + '" title="' + dotTitle + '"></span>' +
      '<span style="flex:1"></span>' +
      '<button class="hbtn" id="lr-refresh" title="Rate abhi refresh karo">&#8635;</button>' +
      '<button class="hbtn" id="lr-min">' + (state.minimised ? "+" : "–") + '</button>' +
      '<button class="hbtn" id="lr-close" title="Panel band karo (bookmark dobara dabane par wapas aa jayega)">&#10005;</button></div>';
    var body = "";
    if (!state.minimised) {
      body = '<div class="body">' + bodyHtml() + "</div>";
    }
    shadow.innerHTML = "<style>" + css + '</style><div class="panel">' + head + body + "</div>";
    var r = shadow.getElementById("lr-refresh");
    if (r) r.addEventListener("click", function () { refreshRates(true); });
    var mn = shadow.getElementById("lr-min");
    if (mn) mn.addEventListener("click", function () { state.minimised = !state.minimised; render(); });
    var cl = shadow.getElementById("lr-close");
    if (cl) cl.addEventListener("click", function () {
      state.enabled = false;
      lsSet(LS_ENABLED, "0");
      render();
    });
    bindPremiumInputs();
    tickClock();
    if (focusId) {
      var el = shadow.getElementById(focusId);
      if (el) {
        if (focusVal !== null) el.value = focusVal;
        try {
          el.focus();
          if (focusSel) el.setSelectionRange(focusSel[0], focusSel[1]);
        } catch (e) {}
      }
    }
  }

  // Minimal panel: no item open -> sirf rate board (6 rows + time).
  // Item open -> sirf Item + MCX rate + bada FINAL PRICE + OMUNIM/fark.
  function boardHtml() {
    var h = "";
    var rows = boardRates(state.mcx ? state.mcx.gold.last : null, state.mcx ? state.mcx.silver.last : null, state.premiums);
    rows.forEach(function (r) {
      h += '<div class="row"><span class="k" style="font-size:14px">' + esc(r.label) +
        (r.pct !== null && r.pct !== 100 ? ' <span class="small">' + r.pct + '%</span>' : "") +
        '</span><span class="v" style="font-size:16px;font-weight:bold">' +
        (r.price === null ? "—" : inr(r.price, 0)) + ' <span class="small">' + r.unit + "</span></span></div>";
    });
    h += '<div style="text-align:right;margin-top:4px" class="small"><span id="lr-clock">—</span></div>';
    return h;
  }

  function premiumHtml() {
    return '<hr><div class="prem">' +
      '<label>Gold premium ₹/10g<input id="lr-prem-gold" type="number" inputmode="decimal" value="' + esc(state.premiums.gold || 0) + '"></label>' +
      '<label>Silver premium ₹/kg<input id="lr-prem-silver" type="number" inputmode="decimal" value="' + esc(state.premiums.silver || 0) + '"></label>' +
      "</div>" +
      '<div class="small" style="margin-top:4px">Premium badalte hi rate aur FINAL PRICE update ho jate hain. Setting is browser me save rehti hai.</div>';
  }

  function bindPremiumInputs() {
    function bind(id, key) {
      var el = shadow.getElementById(id);
      if (!el) return;
      el.addEventListener("change", function () {
        var v = parseFloat(el.value) || 0;
        state.premiums[key] = v;
        lsSet(key === "gold" ? LS_GOLD : LS_SILVER, String(v));
        recompute();
      });
    }
    bind("lr-prem-gold", "gold");
    bind("lr-prem-silver", "silver");
  }

  function bodyHtml() {
    var h = "";
    if (!state.parsed) return h + boardHtml() + premiumHtml();
    // Item row pehle, phir minimal rate line (sirf rate + source + clock).
    var p = state.parsed, c = state.calc;
    h += '<div class="row"><span class="k">Item</span><span class="v"><b>' + esc(p.productCode || "-") + "</b>" +
      (p.barcode ? " • " + esc(p.barcode) : "") + " • " + esc(p.metal || "") + "</span></div>";
    if (!state.mcx) {
      h += '<div class="warn">Live MCX rate abhi nahi mila' + (state.mcxError ? " (" + esc(state.mcxError) + ")" : "") + '. Refresh dabayein ya 1 minute rukiye.</div>';
      return h + premiumHtml();
    }
    var g = state.mcx.gold, s = state.mcx.silver;
    // Dikhaya jaane wala rate premium ke baad wala hai (wahi rate
    // jo FINAL PRICE me use hota hai).
    var effGold = g.last + (state.premiums.gold || 0);
    var effSilver = s.last + (state.premiums.silver || 0);
    var metalLine = c && c.isSilver
      ? "MCX Silver <b>" + inr(effSilver, 0) + " /kg</b>"
      : "MCX Gold <b>" + inr(effGold, 0) + " /10g</b>";
    h += '<div class="row"><span class="k">' + metalLine + '</span><span class="v small">' +
      (state.mcxFallback ? "OMUNIM top bar se" : "mcxlive.org") + "</span></div>";
    h += '<div class="row"><span class="k small" id="lr-clock">—</span><span class="v small" id="lr-next"></span></div>';
    if (state.mcxStale && !state.mcxFallback) h += '<div class="warn">Purana rate — refresh ho raha hai.' + (state.mcxError ? " " + esc(state.mcxError) : "") + "</div>";

    if (!c || c.newMetal === null) {
      h += '<div class="warn">Final price calculate nahi ho paya.</div>';
      return h + premiumHtml();
    }
    h += '<div class="final"><span><b>FINAL PRICE</b></span><b>' + inr(c.finalPrice) + "</b></div>";
    if (c.oldFinal !== null) {
      var d = c.diff;
      h += '<div class="row" style="margin-top:6px"><span class="k">OMUNIM ' + inr(c.oldFinal) + '</span><span class="v diff ' + (d < 0 ? "down" : d > 0 ? "up" : "") + '">Fark ' + (d > 0 ? "+" : "") + inr(d) + "</span></div>";
    }
    return h + premiumHtml();
  }

  /* ---------- Quotation button interception ----------
     OMUNIM's Quotation anchor opens ogiaquot.php via an inline onclick
     window.open(url, 'popup', ...). A capture-phase listener catches the
     click before the inline handler runs; if we have a live rate + an
     open item, open the SAME page with MCX+premium values instead, at
     the item's own purity rate (v1.6 fix). If anything is missing, let
     OMUNIM's own click go through untouched. */
  function quotationOnClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[onclick*="ogiaquot.php"]') : null;
    if (!a) return;
    if (!state.parsed || !state.calc || !state.mcx) return;
    var eff = state.calc.mcxWithPremium;
    if (eff === null || eff === undefined) return;
    var onc = a.getAttribute("onclick") || "";
    var um = onc.match(/window\.open\('([^']+)'/);
    if (!um) return;
    var newUrl = buildQuotationUrl(um[1], state.parsed, state.calc, eff);
    if (!newUrl) return;
    e.preventDefault();
    e.stopPropagation();
    window.open(newUrl, "popup", "width=410,height=420,scrollbars=yes,resizable=yes,toolbar=no,directories=no,location=no,menubar=no,status=no,left=0,top=0");
  }
  document.addEventListener("click", quotationOnClick, true);

  /* ---------- data ---------- */

  // OMUNIM's own top bar ("MCX Gold:121949") — fallback rate source.
  // Item khula ho ya na ho, top bar page par hamesha dikhta hai.
  function readTopBarRates() {
    var text = "";
    try { text = document.body ? document.body.innerText || "" : ""; } catch (e) { text = ""; }
    var g = text.match(/MCX Gold\s*:\s*([\d,]+)/i);
    var s = text.match(/MCX Silver\s*:\s*([\d,]+)/i);
    return { gold: g ? parseNum(g[1]) : null, silver: s ? parseNum(s[1]) : null };
  }

  function recompute() {
    var topBar = readTopBarRates();
    var forPick = state.parsed || {};
    if (forPick.topMcxGold == null) forPick.topMcxGold = topBar.gold;
    if (forPick.topMcxSilver == null) forPick.topMcxSilver = topBar.silver;
    // Rate pick karo — fresh mcxlive rate ho to wahi, warna (90 second
    // se purana ho to) OMUNIM top bar ka MCX rate.
    var picked = pickRate(state.mcx, forPick, Date.now());
    state.mcx = picked.mcx;
    state.mcxFallback = picked.fallback;
    if (state.parsed) {
      state.calc = computePrice(state.parsed, state.mcx, state.premiums);
    } else {
      state.calc = null;
    }
    render();
  }

  /* ---------- MCX fetch (in-page — no background worker) ----------
     mcxlive.org ko seedha fetch karne ki koshish hoti hai; us site par
     CORS header nahi hai, isliye page script ka fetch aksar block hota
     hai — tab pickRate OMUNIM top bar ka rate use karta hai (upar).
     Gold aur silver alag-alag fetch hote hain, taaki ek ke fail hone
     par dusra ruk na jaye; last good rate kabhi discard nahi hota. */
  var GOLD_URL = "https://mcxlive.org/gold/";
  var SILVER_URL = "https://mcxlive.org/silver/";

  function fetchPage(url, timeoutMs) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, timeoutMs || 15000);
    return fetch(url, {
      signal: ctrl.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-IN,en;q=0.9"
      }
    }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).catch(function (e) { clearTimeout(t); throw e; });
  }

  function fetchOne(url, metal) {
    return fetchPage(url).then(function (html) {
      return parseMcxPage(html, metal);
    }).catch(function () { return null; });
  }

  function fetchMcx() {
    return Promise.all([fetchOne(GOLD_URL, "GOLD"), fetchOne(SILVER_URL, "SILVER")]).then(function (results) {
      var prev = state.mcx;
      var gold = results[0] || (prev && prev.gold) || null;
      var silver = results[1] || (prev && prev.silver) || null;
      var anyFresh = !!results[0] || !!results[1];
      if (!gold || !silver) {
        state.mcxError = "mcxlive.org se rate nahi mila — OMUNIM top bar ka rate use ho raha hai";
      } else {
        state.mcxError = null;
      }
      if (!gold || !silver) {
        // Dono me se ek bhi rate nahi: top bar fallback hi bacha hai.
        state.mcx = prev;
        state.mcxStale = true;
      } else {
        state.mcx = {
          gold: gold,
          silver: silver,
          // fetchedAt sirf tabhi aage badhe jab kam se kam ek metal
          // fresh mila ho, warna stale rate fresh lagta hai.
          fetchedAt: anyFresh ? new Date().toISOString() : (prev && prev.fetchedAt) || new Date().toISOString(),
          source: anyFresh ? "mcxlive.org" : (prev && prev.source) || "mcxlive.org",
          goldFresh: !!results[0],
          silverFresh: !!results[1]
        };
        state.mcxStale = !anyFresh;
      }
      recompute();
    }).catch(function (e) {
      state.mcxError = String(e && e.message || e);
      state.mcxStale = true;
      recompute();
    });
  }

  function refreshRates(force) {
    if (state.refreshing && !force) return;
    state.refreshing = true;
    state.nextRefreshAt = Date.now() + 60 * 1000;
    fetchMcx().then(function () { state.refreshing = false; })
      .catch(function () { state.refreshing = false; });
  }

  var scanTimer = null;
  function scan() {
    var text = "";
    try { text = document.body ? document.body.innerText || "" : ""; } catch (e) { text = ""; }
    var parsed = parsePanelText(text);
    var changed = JSON.stringify(parsed) !== JSON.stringify(state.parsed);
    state.parsed = parsed;
    // Fallback rate top bar se aata hai to har scan par dobara pick karo,
    // taaki top bar ka naya rate bhi turant price me aa jaye.
    if (changed || !state.calc || state.mcxFallback) recompute();
  }
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 400);
  }

  /* ---------- boot ---------- */
  state.premiums.gold = parseFloat(lsGet(LS_GOLD)) || 0;
  state.premiums.silver = parseFloat(lsGet(LS_SILVER)) || 0;
  state.enabled = lsGet(LS_ENABLED) !== "0";
  render();
  scan();
  refreshRates(false);

  window.__omunimLiveRate = { state: state, render: render, refreshRates: refreshRates, scan: scan };

  // OMUNIM panel AJAX se badalta hai — URL nahi badalta, isliye DOM observe karo.
  var observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Ticking clock — har second "Updated HH:MM:SS" aur
  // "Next refresh in Ns" update karo, taaki refresh dikhai de.
  // Sirf clock wale nodes ka text badalta hai (poora panel dobara
  // render nahi hota, warna premium type karte waqt focus chala jata).
  function tickClock() {
    var c = shadow.getElementById("lr-clock");
    var n = shadow.getElementById("lr-next");
    if (!c && !n) return;
    if (c) {
      var t = state.mcx && state.mcx.fetchedAt ? new Date(state.mcx.fetchedAt) : null;
      c.textContent = t ? t.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }) : "—";
    }
    if (n) {
      if (state.refreshing) n.textContent = "Refreshing…";
      else if (state.nextRefreshAt) {
        var s = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
        n.textContent = "Next refresh in " + s + "s";
      } else n.textContent = "";
    }
  }
  setInterval(tickClock, 1000);

  // User ka rule: rate har 1 minute me refresh.
  setInterval(function () { refreshRates(true); }, 60 * 1000);
  // Panel scan bhi har 5 second me (koi change miss na ho).
  setInterval(scan, 5000);
})();
