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
  status: "", // short non-blocking status line
  error: null,
  copied: false,
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

const API_TIMEOUT_MS = 12_000;

async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      ...options,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Request timed out (Amazon/network). Try again or enter the price manually.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function readFieldsFromDom() {
  for (const [key] of fields) {
    const el = document.getElementById(key);
    if (el && el.value !== "") {
      const n = Number(el.value);
      if (Number.isFinite(n)) state.inputs[key] = n;
    }
  }
  const asinEl = document.getElementById("competitorAsin");
  if (asinEl) state.competitorAsin = asinEl.value.trim();
}

function setStatus(text) {
  state.status = text || "";
  const el = document.getElementById("status-line");
  if (el) el.textContent = state.status;
}

function setError(text) {
  state.error = text || null;
  const el = document.getElementById("error-line");
  if (el) {
    el.hidden = !state.error;
    el.textContent = state.error || "";
  }
}

function paintResults() {
  const host = document.getElementById("results");
  if (!host) return;
  const result = state.result;
  const c = result?.competitive;
  const recommended = result?.recommended;

  if (!recommended || !c) {
    host.innerHTML = `<p class="note">Enter slicer grams + Amazon product price (fetch or type it), then generate.</p>`;
    return;
  }

  host.innerHTML = `
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
      <button class="btn-ghost" id="btn-copy" type="button">Copy HubSpot fields</button>
      ${state.copied ? `<span class="copy-ok">copied</span>` : ""}
    </div>
  `;
  document.getElementById("btn-copy")?.addEventListener("click", () => copyHubspot());
}

function paintPills() {
  const market = state.market;
  const pill = document.getElementById("resin-pill");
  if (pill) {
    pill.innerHTML = `
      <span class="dot ${market?.warning ? "warn" : ""}"></span>
      <span>Resin <strong>${market ? money(market.bottlePriceUsd) : money(state.inputs.bottlePriceUsd)}</strong> / ${market?.bottleMassG || state.inputs.bottleMassG || 1000}g</span>
    `;
  }
  const note = document.getElementById("competitor-note");
  if (note) {
    const competitor = state.competitor;
    note.innerHTML = competitor
      ? `${competitor.title ? `<strong>${competitor.title}</strong><br>` : ""}Listing ${competitor.priceUsd != null ? money(competitor.priceUsd) : "—"} · ${competitor.source}${competitor.warning ? ` · ${competitor.warning}` : ""}`
      : `Type/paste an ASIN and fetch, <em>or</em> type the Amazon product $ manually — generate does not need a fetch.`;
  }
  const warn = document.getElementById("warn-line");
  if (warn) {
    const bits = [market?.warning, state.competitor?.warning].filter(Boolean);
    warn.hidden = bits.length === 0;
    warn.textContent = bits.join(" · ");
  }
}

async function refreshResin(force = false) {
  setError(null);
  setStatus(force ? "Refreshing Amazon resin bottle…" : "Loading resin bottle price…");
  try {
    state.market = await api(`/api/resin-market${force ? "?force=1" : ""}`);
    if (state.market?.bottlePriceUsd) {
      state.inputs.bottlePriceUsd = state.market.bottlePriceUsd;
      state.inputs.bottleMassG = state.market.bottleMassG || 1000;
      const bottle = document.getElementById("bottlePriceUsd");
      const mass = document.getElementById("bottleMassG");
      if (bottle) bottle.value = String(state.inputs.bottlePriceUsd);
      if (mass) mass.value = String(state.inputs.bottleMassG);
    }
    paintPills();
    setStatus(state.market?.cached ? "Resin price (cached)." : "Resin price updated.");
  } catch (err) {
    setError(err.message);
    setStatus("");
  }
}

async function refreshCompetitor(force = false) {
  readFieldsFromDom();
  if (!state.competitorAsin) {
    setError("Paste an Amazon ASIN or product URL for the item you are making.");
    return;
  }
  setError(null);
  setStatus("Fetching Amazon product listing…");
  try {
    const q = encodeURIComponent(state.competitorAsin);
    state.competitor = await api(`/api/amazon-product?asin=${q}${force ? "&force=1" : ""}`);
    if (state.competitor?.priceUsd) {
      state.inputs.competitorPriceUsd = state.competitor.priceUsd;
      const el = document.getElementById("competitorPriceUsd");
      if (el) el.value = String(state.competitor.priceUsd);
    }
    paintPills();
    setStatus(
      state.competitor?.priceUsd != null
        ? `Product listing ${money(state.competitor.priceUsd)}.`
        : "No price parsed — enter Amazon product $ manually.",
    );
  } catch (err) {
    setError(err.message);
    setStatus("");
  }
}

async function price() {
  readFieldsFromDom();
  setError(null);
  setStatus("Calculating best undercut…");
  try {
    const payload = { ...state.inputs };
    const data = await api("/api/price", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.result = data.result;
    paintResults();
    setStatus(state.result?.competitive?.viable ? "Ready." : "Check warning — undercut blocked by cost floor.");
  } catch (err) {
    setError(err.message);
    setStatus("");
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
  paintResults();
  setTimeout(() => {
    state.copied = false;
    paintResults();
  }, 1600);
}

function renderShell() {
  const root = document.getElementById("app");
  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-kicker">Print Operations · Tool</div>
        <h1>Pricing Matrix</h1>
        <p>Slicer grams × bottle cost vs Amazon listing — undercut the listing and keep the highest profit above your floor.</p>
      </div>
      <div class="live-pill" id="resin-pill"></div>
    </header>

    <div class="layout">
      <section class="panel">
        <h2>1 · Real costs</h2>
        <div class="grid" id="fields"></div>

        <h2 style="margin-top:1.1rem">2 · Amazon product you compete with</h2>
        <div class="field full">
          <label for="competitorAsin">Amazon ASIN or product URL</label>
          <input id="competitorAsin" type="text" placeholder="B0XXXXXXXX or https://www.amazon.com/dp/..." value="" />
        </div>
        <p class="note" id="competitor-note"></p>

        <div class="actions">
          <button class="btn-primary" id="btn-price" type="button">Generate best price</button>
          <button class="btn-ghost" id="btn-comp" type="button">Fetch Amazon product</button>
          <button class="btn-ghost" id="btn-resin" type="button">Refresh resin bottle</button>
        </div>
        <p class="note" id="status-line"></p>
        <div class="warning" id="warn-line" hidden></div>
        <div class="warning" id="error-line" hidden></div>
      </section>

      <section class="panel">
        <h2>Best price</h2>
        <div id="results"></div>
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
      const n = Number(input.value);
      if (Number.isFinite(n)) state.inputs[key] = n;
    });
    wrap.appendChild(input);
    fieldsEl.appendChild(wrap);
  }

  document.getElementById("btn-price").addEventListener("click", () => price());
  document.getElementById("btn-comp").addEventListener("click", () => refreshCompetitor(true));
  document.getElementById("btn-resin").addEventListener("click", () => refreshResin(true));
  document.getElementById("competitorAsin").addEventListener("input", (e) => {
    state.competitorAsin = e.target.value.trim();
  });

  paintPills();
  paintResults();
}

renderShell();
// Instant local quote from defaults (no Amazon wait), then refresh resin in background.
price();
refreshResin(false);
