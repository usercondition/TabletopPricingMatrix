const money = (n) =>
  Number(n ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

const state = {
  inputs: {
    resinMassG: 85,
    resinVolumeMl: 0,
    bottlePriceUsd: 28,
    bottleMassG: 1000,
    bottleVolumeMl: null,
    competitorPriceUsd: 0,
    undercutPercent: 0.05,
    undercutExtraUsd: 0,
    laborMinutes: 45,
    laborRatePerHour: 35,
    printHours: 6,
    machineRatePerHour: 2.5,
    packagingUsd: 4,
    shippingUsd: 8,
    failureRate: 0.08,
    minMargin: 0.25,
    targetMargin: 0.4,
  },
  competitorAsin: "",
  competitor: null,
  market: null,
  result: null,
  busy: false,
  copied: false,
  error: null,
};

const fields = [
  ["resinMassG", "Slicer resin (g)"],
  ["printHours", "Print hours"],
  ["laborMinutes", "Labor minutes"],
  ["laborRatePerHour", "Labor $/hr"],
  ["machineRatePerHour", "Machine $/hr"],
  ["packagingUsd", "Packaging $"],
  ["shippingUsd", "Shipping $"],
  ["failureRate", "Failure buffer (0–1)"],
  ["bottlePriceUsd", "Bottle price $"],
  ["bottleMassG", "Bottle mass g"],
  ["undercutPercent", "Undercut % (0–1)"],
  ["undercutExtraUsd", "Extra undercut $"],
  ["minMargin", "Min margin (0–1)"],
  ["competitorPriceUsd", "Amazon product $"],
];

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function readFieldsFromDom() {
  for (const [key] of fields) {
    const el = document.getElementById(key);
    if (el && el.value !== "") state.inputs[key] = Number(el.value);
  }
  const asinEl = document.getElementById("competitorAsin");
  if (asinEl) state.competitorAsin = asinEl.value.trim();
}

async function refreshResin(force = false) {
  state.busy = true;
  state.error = null;
  render();
  try {
    state.market = await api(`/api/resin-market${force ? "?force=1" : ""}`);
    if (state.market?.bottlePriceUsd) {
      state.inputs.bottlePriceUsd = state.market.bottlePriceUsd;
      state.inputs.bottleMassG = state.market.bottleMassG || 1000;
    }
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function refreshCompetitor(force = false) {
  readFieldsFromDom();
  if (!state.competitorAsin) {
    state.error = "Paste an Amazon ASIN or product URL for the item you are making.";
    render();
    return;
  }
  state.busy = true;
  state.error = null;
  render();
  try {
    const q = encodeURIComponent(state.competitorAsin);
    state.competitor = await api(`/api/amazon-product?asin=${q}${force ? "&force=1" : ""}`);
    if (state.competitor?.priceUsd) {
      state.inputs.competitorPriceUsd = state.competitor.priceUsd;
    }
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function price() {
  readFieldsFromDom();
  // If an ASIN is present but product price is still 0, fetch it first.
  if ((!state.inputs.competitorPriceUsd || state.inputs.competitorPriceUsd <= 0) && state.competitorAsin) {
    await refreshCompetitor(false);
    readFieldsFromDom();
  }
  state.busy = true;
  state.error = null;
  state.copied = false;
  render();
  try {
    const payload = { ...state.inputs };
    const data = await api("/api/price", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.result = data.result;
  } catch (err) {
    state.error = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function copyHubspot() {
  if (!state.result) return;
  const f = state.result.hubspotFields;
  const text = [
    `amount\t${f.suggested_amount.toFixed(2)}`,
    `print_material_cost\t${f.print_material_cost.toFixed(2)}`,
    `print_labor_cost\t${f.print_labor_cost.toFixed(2)}`,
    `print_packaging_cost\t${f.print_packaging_cost.toFixed(2)}`,
    `print_actual_shipping_cost\t${f.print_actual_shipping_cost.toFixed(2)}`,
  ].join("\n");
  await navigator.clipboard.writeText(text);
  state.copied = true;
  render();
  setTimeout(() => {
    state.copied = false;
    render();
  }, 1600);
}

function render() {
  const root = document.getElementById("app");
  const market = state.market;
  const competitor = state.competitor;
  const result = state.result;
  const c = result?.competitive;
  const recommended = result?.recommended;

  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-kicker">Print Operations · Tool</div>
        <h1>Pricing Matrix</h1>
        <p>Slicer grams × bottle cost vs Amazon listing for the part you make — undercut the listing and keep the highest profit above your floor.</p>
      </div>
      <div class="live-pill">
        <span class="dot ${market?.warning ? "warn" : ""}"></span>
        <span>Resin <strong>${market ? money(market.bottlePriceUsd) : "…"}</strong> / ${market?.bottleMassG || 1000}g</span>
      </div>
    </header>

    <div class="layout">
      <section class="panel">
        <h2>1 · Real costs</h2>
        <div class="grid" id="fields"></div>

        <h2 style="margin-top:1.1rem">2 · Amazon product you compete with</h2>
        <div class="field full">
          <label for="competitorAsin">Amazon ASIN or product URL</label>
          <input id="competitorAsin" type="text" placeholder="B0XXXXXXXX or https://www.amazon.com/dp/..." value="${state.competitorAsin.replaceAll('"', "&quot;")}" />
        </div>
        ${
          competitor
            ? `<p class="note">${competitor.title ? `<strong>${competitor.title}</strong><br>` : ""}Listing ${competitor.priceUsd != null ? money(competitor.priceUsd) : "—"} · ${competitor.source}${competitor.warning ? ` · ${competitor.warning}` : ""}</p>`
            : `<p class="note">Fetch the live buy-box price for the finished item, then generate the undercut quote.</p>`
        }

        <div class="actions">
          <button class="btn-primary" id="btn-price" ${state.busy ? "disabled" : ""}>${state.busy ? "Working…" : "Generate best price"}</button>
          <button class="btn-ghost" id="btn-comp" ${state.busy ? "disabled" : ""}>Fetch Amazon product</button>
          <button class="btn-ghost" id="btn-resin" ${state.busy ? "disabled" : ""}>Refresh resin bottle</button>
        </div>
        ${market?.warning ? `<div class="warning">${market.warning}</div>` : ""}
        ${competitor?.warning ? `<div class="warning">${competitor.warning}</div>` : ""}
        ${state.error ? `<div class="warning">${state.error}</div>` : ""}
      </section>

      <section class="panel">
        <h2>Best price</h2>
        ${
          recommended && c
            ? `
          <div class="hero-quote">
            <div class="label">${c.viable ? "Recommended undercut" : "Blocked — use floor"}</div>
            <div class="amount">${money(c.recommendedUsd)}</div>
            <div class="meta">${c.marginPercent}% margin · ${money(c.grossProfitUsd)} profit · cost ${money(c.costFloorUsd)}</div>
          </div>
          <p class="note">${c.message}</p>
          <div class="tiers">
            ${result.tiers
              .map(
                (t) => `
              <div class="tier ${Math.abs(t.amountUsd - c.recommendedUsd) < 0.009 ? "active" : ""}">
                <div class="name">${t.label}</div>
                <div class="val">${money(t.amountUsd)}</div>
                <div class="side">${t.marginPercent}% · ${money(t.grossProfitUsd)}</div>
              </div>`,
              )
              .join("")}
          </div>
          <h2>Compare</h2>
          <div class="costs">
            <div class="row"><span>Amazon listing</span><span>${c.amazonListingUsd != null ? money(c.amazonListingUsd) : "—"}</span></div>
            <div class="row"><span>Your undercut</span><span>${c.undercutPriceUsd != null ? money(c.undercutPriceUsd) : "—"}</span></div>
            <div class="row"><span>Savings vs Amazon</span><span>${c.savingsVsAmazonUsd != null ? `${money(c.savingsVsAmazonUsd)} (${c.savingsVsAmazonPercent}%)` : "—"}</span></div>
            <div class="row"><span>Min viable (floor)</span><span>${money(c.minViableUsd)}</span></div>
            <div class="row total"><span>Material from slicer</span><span>${money(result.costs.materialUsd)} · ${state.inputs.resinMassG}g</span></div>
          </div>
          <h2>Cost stack</h2>
          <div class="costs">
            <div class="row"><span>Material</span><span>${money(result.costs.materialUsd)}</span></div>
            <div class="row"><span>Labor</span><span>${money(result.costs.laborUsd)}</span></div>
            <div class="row"><span>Machine</span><span>${money(result.costs.machineUsd)}</span></div>
            <div class="row"><span>Failure buffer</span><span>${money(result.costs.failureBufferUsd)}</span></div>
            <div class="row"><span>Packaging</span><span>${money(result.costs.packagingUsd)}</span></div>
            <div class="row"><span>Shipping</span><span>${money(result.costs.shippingUsd)}</span></div>
            <div class="row total"><span>Total cost</span><span>${money(result.costs.costTotalUsd)}</span></div>
          </div>
          <h2>HubSpot field map</h2>
          <div class="hubspot">
            <div class="row"><span>amount</span><span>${money(result.hubspotFields.suggested_amount)}</span></div>
            <div class="row"><span>print_material_cost</span><span>${money(result.hubspotFields.print_material_cost)}</span></div>
            <div class="row"><span>print_labor_cost</span><span>${money(result.hubspotFields.print_labor_cost)}</span></div>
            <div class="row"><span>print_packaging_cost</span><span>${money(result.hubspotFields.print_packaging_cost)}</span></div>
            <div class="row"><span>print_actual_shipping_cost</span><span>${money(result.hubspotFields.print_actual_shipping_cost)}</span></div>
          </div>
          <div class="actions">
            <button class="btn-ghost" id="btn-copy">Copy HubSpot fields</button>
            ${state.copied ? `<span class="copy-ok">copied</span>` : ""}
          </div>
        `
            : `<p class="note">Enter slicer grams, refresh bottle cost, fetch the Amazon product listing, then generate.</p>`
        }
      </section>
    </div>
  `;

  const fieldsEl = document.getElementById("fields");
  for (const [key, label] of fields) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.innerHTML = `<label for="${key}">${label}</label>`;
    const input = document.createElement("input");
    input.id = key;
    input.type = "number";
    input.step = "any";
    input.value = state.inputs[key] ?? "";
    input.addEventListener("input", () => {
      state.inputs[key] = Number(input.value);
    });
    wrap.appendChild(input);
    fieldsEl.appendChild(wrap);
  }

  document.getElementById("btn-price")?.addEventListener("click", () => price());
  document.getElementById("btn-comp")?.addEventListener("click", () => refreshCompetitor(true));
  document.getElementById("btn-resin")?.addEventListener("click", () => refreshResin(true));
  document.getElementById("btn-copy")?.addEventListener("click", () => copyHubspot());
  document.getElementById("competitorAsin")?.addEventListener("input", (e) => {
    state.competitorAsin = e.target.value.trim();
  });
}

render();
refreshResin(false).then(() => price());
