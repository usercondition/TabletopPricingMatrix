const STORAGE_KEY = "tpm-pricing-v3";
const API_TIMEOUT_MS = 12_000;

const money = (n) =>
  Number(n ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

const defaultInputs = () => ({
  resinMassG: 85,
  resinVolumeMl: 0,
  quantity: 1,
  bottlePriceUsd: 28,
  bottleMassG: 1000,
  bottleVolumeMl: null,
  competitorPriceUsd: 0,
  undercutPercent: 0.05,
  undercutExtraUsd: 0,
  shippingUsd: 8,
  minMargin: 0.25,
  targetMargin: 0.4,
});

const state = {
  inputs: defaultInputs(),
  competitorAsin: "",
  competitor: null,
  market: null,
  result: null,
  status: "",
  error: null,
  copied: false,
  priceSeq: 0,
};

const fields = [
  ["resinMassG", "Slicer resin (g)"],
  ["quantity", "Quantity (units)"],
  ["bottlePriceUsd", "Bottle price $"],
  ["bottleMassG", "Bottle mass g"],
  ["shippingUsd", "Shipping $/order (added on top)"],
  ["undercutPercent", "Undercut % (0–1)"],
  ["undercutExtraUsd", "Extra undercut $"],
  ["minMargin", "Min margin (0–1)"],
  ["competitorPriceUsd", "Competitor RRP $/unit"],
];

function loadSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.inputs && typeof parsed.inputs === "object") {
      state.inputs = { ...defaultInputs(), ...parsed.inputs };
    }
    if (typeof parsed?.competitorAsin === "string") state.competitorAsin = parsed.competitorAsin;
  } catch {
    /* ignore corrupt session */
  }
}

function saveSession() {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        inputs: state.inputs,
        competitorAsin: state.competitorAsin,
      }),
    );
  } catch {
    /* private mode / quota */
  }
}

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
      throw new Error("Timed out waiting for Amazon/network. Enter the price manually and generate.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function readFieldsFromDom() {
  for (const [key] of fields) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.value === "") continue;
    const n = Number(el.value);
    if (Number.isFinite(n)) state.inputs[key] = n;
  }
  const asinEl = document.getElementById("competitorAsin");
  if (asinEl) state.competitorAsin = asinEl.value.trim();
  saveSession();
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

function paintPills() {
  const market = state.market;
  const pill = document.getElementById("resin-pill");
  if (pill) {
    pill.innerHTML = `
      <span class="dot ${market?.warning ? "warn" : ""}"></span>
      <span>Resin <strong>${money(market?.bottlePriceUsd ?? state.inputs.bottlePriceUsd)}</strong> / ${market?.bottleMassG || state.inputs.bottleMassG || 1000}g</span>
    `;
  }
  const note = document.getElementById("competitor-note");
  if (note) {
    const competitor = state.competitor;
    note.innerHTML = competitor
      ? `${competitor.title ? `<strong>${competitor.title}</strong><br>` : ""}Listing ${competitor.priceUsd != null ? money(competitor.priceUsd) : "—"} · ${competitor.source}${competitor.elapsedMs != null ? ` · ${competitor.elapsedMs}ms` : ""}${competitor.warning ? ` · ${competitor.warning}` : ""}`
      : `Fetch an ASIN <em>or</em> type Amazon product $/unit manually — Generate never waits on Amazon.`;
  }
  const warn = document.getElementById("warn-line");
  if (warn) {
    const bits = [market?.warning, state.competitor?.warning].filter(Boolean);
    warn.hidden = bits.length === 0;
    warn.textContent = bits.join(" · ");
  }
}

function paintResults() {
  const host = document.getElementById("results");
  if (!host) return;
  const result = state.result;
  const c = result?.competitive;
  const insights = result?.insights;
  if (!result || !c) {
    host.innerHTML = `<p class="note">Quote appears here instantly from your numbers. Amazon fetches never block Generate.</p>`;
    return;
  }

  const product = c.recommendedProductUsd ?? c.recommendedUsd;
  host.innerHTML = `
    <div class="hero-quote">
      <div class="label">${c.viable ? "Customer total (product + ship)" : "Blocked — floor + ship"}</div>
      <div class="amount">${money(c.recommendedUsd)}</div>
      <div class="meta">${money(product)} product · + ${money(c.shippingUsd)} ship · ${c.marginPercent}% margin on product · ${money(c.grossProfitUsd)} profit · resin cost ${money(c.costFloorUsd)}</div>
    </div>
    <p class="note">${c.message}</p>
    <div class="tiers">
      ${result.tiers
        .map(
          (t) => `
        <div class="tier ${Math.abs(t.amountUsd - product) < 0.009 ? "active" : ""}">
          <div class="name">${t.label}</div>
          <div class="val">${money(t.amountUsd)}</div>
          <div class="side">${t.marginPercent}% · ${money(t.grossProfitUsd)}</div>
        </div>`,
        )
        .join("")}
    </div>
    <h2>Compare (product, before shipping)</h2>
    <div class="costs">
      <div class="row"><span>Competitor RRP (order)</span><span>${c.amazonListingUsd != null ? money(c.amazonListingUsd) : "—"}</span></div>
      <div class="row"><span>Your undercut (product)</span><span>${c.undercutPriceUsd != null ? money(c.undercutPriceUsd) : "—"}</span></div>
      <div class="row"><span>Savings vs competitor</span><span>${c.savingsVsAmazonUsd != null ? `${money(c.savingsVsAmazonUsd)} (${c.savingsVsAmazonPercent}%)` : "—"}</span></div>
      <div class="row"><span>Min viable product floor</span><span>${money(c.minViableUsd)}</span></div>
      <div class="row"><span>+ Shipping (order)</span><span>${money(c.shippingUsd)}</span></div>
      <div class="row total"><span>Customer total</span><span>${money(c.recommendedUsd)}</span></div>
    </div>
    ${
      insights
        ? `<h2>Insights</h2>
      <div class="costs">
        <div class="row"><span>Max undercut still viable</span><span>${insights.maxViableUndercutPercent != null ? `${insights.maxViableUndercutPercent}%` : "—"}</span></div>
        <div class="row"><span>Competitor clears floor?</span><span>${insights.amazonBeatsFloor == null ? "—" : insights.amazonBeatsFloor ? "yes" : "no"}</span></div>
      </div>`
        : ""
    }
    <h2>Cost stack</h2>
    <div class="costs">
      <div class="row"><span>Resin material · ${state.inputs.resinMassG}g × ${result.costs.quantity}</span><span>${money(result.costs.materialUsd)}</span></div>
      <div class="row"><span>Shipping (added to final)</span><span>${money(result.costs.shippingUsd)}</span></div>
      <div class="row total"><span>Product cost (margin base)</span><span>${money(result.costs.costTotalUsd)}</span></div>
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

let priceTimer = null;
function schedulePrice() {
  clearTimeout(priceTimer);
  priceTimer = setTimeout(() => price(), 200);
}

async function refreshResin(force = false) {
  setError(null);
  setStatus(force ? "Refreshing Amazon resin…" : "Loading resin bottle…");
  try {
    state.market = await api(`/api/resin-market${force ? "?force=1" : ""}`);
    if (state.market?.bottlePriceUsd) {
      state.inputs.bottlePriceUsd = state.market.bottlePriceUsd;
      state.inputs.bottleMassG = state.market.bottleMassG || 1000;
      const bottle = document.getElementById("bottlePriceUsd");
      const mass = document.getElementById("bottleMassG");
      if (bottle && document.activeElement !== bottle) bottle.value = String(state.inputs.bottlePriceUsd);
      if (mass && document.activeElement !== mass) mass.value = String(state.inputs.bottleMassG);
      saveSession();
    }
    paintPills();
    setStatus(state.market?.cached ? "Resin price cached." : "Resin price updated.");
    schedulePrice();
  } catch (err) {
    setError(err.message);
    setStatus("Resin fetch failed — bottle $ field still works.");
  }
}

async function refreshCompetitor(force = false) {
  readFieldsFromDom();
  if (!state.competitorAsin) {
    setError("Paste an Amazon ASIN or product URL for the finished item.");
    return;
  }
  setError(null);
  setStatus("Fetching Amazon product…");
  try {
    const q = encodeURIComponent(state.competitorAsin);
    state.competitor = await api(`/api/amazon-product?asin=${q}${force ? "&force=1" : ""}`);
    if (state.competitor?.priceUsd) {
      state.inputs.competitorPriceUsd = state.competitor.priceUsd;
      const el = document.getElementById("competitorPriceUsd");
      if (el && document.activeElement !== el) el.value = String(state.competitor.priceUsd);
      saveSession();
    }
    paintPills();
    setStatus(
      state.competitor?.priceUsd != null
        ? `Product ${money(state.competitor.priceUsd)}.`
        : "No price parsed — type Amazon product $ manually.",
    );
    schedulePrice();
  } catch (err) {
    setError(err.message);
    setStatus("Product fetch failed — type the listing $ and generate.");
  }
}

async function price() {
  readFieldsFromDom();
  const seq = ++state.priceSeq;
  setError(null);
  setStatus("Calculating…");
  try {
    const data = await api("/api/price", {
      method: "POST",
      body: JSON.stringify(state.inputs),
    });
    if (seq !== state.priceSeq) return; // stale response
    state.result = data.result;
    paintResults();
    setStatus(state.result?.competitive?.viable ? "Ready." : "Undercut blocked by cost floor.");
  } catch (err) {
    if (seq !== state.priceSeq) return;
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
        <p>Slicer grams × bottle cost vs Warhammer/Amazon RRP — undercut the product, then add shipping on top. Amazon never blocks Generate.</p>
      </div>
      <div class="live-pill" id="resin-pill"></div>
    </header>

    <div class="layout">
      <section class="panel">
        <h2>1 · Real costs</h2>
        <div class="grid" id="fields"></div>

        <h2 style="margin-top:1.1rem">2 · Competitor price (Warhammer or Amazon)</h2>
        <div class="field full">
          <label for="wh-search">Search Warhammer catalog</label>
          <input id="wh-search" type="search" placeholder="e.g. Intercessors, Necron Warriors, Combat Patrol…" />
        </div>
        <div id="wh-results" class="wh-results"></div>
        <p class="note" id="wh-meta"></p>

        <div class="field full">
          <label for="competitorAsin">Or Amazon ASIN / product URL</label>
          <input id="competitorAsin" type="text" placeholder="B0XXXXXXXX or https://www.amazon.com/dp/..." />
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
      if (Number.isFinite(n)) {
        state.inputs[key] = n;
        saveSession();
        schedulePrice();
      }
    });
    wrap.appendChild(input);
    fieldsEl.appendChild(wrap);
  }

  const asin = document.getElementById("competitorAsin");
  asin.value = state.competitorAsin;
  asin.addEventListener("input", (e) => {
    state.competitorAsin = e.target.value.trim();
    saveSession();
  });

  document.getElementById("btn-price").addEventListener("click", () => price());
  document.getElementById("btn-comp").addEventListener("click", () => refreshCompetitor(true));
  document.getElementById("btn-resin").addEventListener("click", () => refreshResin(true));

  const wh = document.getElementById("wh-search");
  let whTimer = null;
  wh.addEventListener("input", () => {
    clearTimeout(whTimer);
    whTimer = setTimeout(() => searchWarhammer(wh.value), 180);
  });

  paintPills();
  paintResults();
  loadWarhammerMeta();
  searchWarhammer("");
}

async function loadWarhammerMeta() {
  try {
    const stats = await api("/api/warhammer/stats");
    const el = document.getElementById("wh-meta");
    if (el) {
      el.textContent = `Catalog: ${stats.total} kits · ${stats.factions} factions · unofficial RRP snapshot — verify before selling.`;
    }
  } catch {
    /* optional */
  }
}

async function searchWarhammer(query) {
  const host = document.getElementById("wh-results");
  if (!host) return;
  try {
    const data = await api(`/api/warhammer/search?q=${encodeURIComponent(query || "")}&limit=12`);
    if (!data.units?.length) {
      host.innerHTML = `<p class="note">No matches.</p>`;
      return;
    }
    host.innerHTML = data.units
      .map(
        (u) => `
      <button type="button" class="wh-row" data-id="${u.id}" data-price="${u.gwPriceUsd}">
        <span class="wh-name">${u.name}</span>
        <span class="wh-meta-line">${u.faction}${u.modelCount ? ` · ${u.modelCount} models` : ""}</span>
        <span class="wh-price">${money(u.gwPriceUsd)}</span>
      </button>`,
      )
      .join("");
    host.querySelectorAll(".wh-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        const priceVal = Number(btn.getAttribute("data-price"));
        const id = btn.getAttribute("data-id");
        if (!Number.isFinite(priceVal)) return;
        state.inputs.competitorPriceUsd = priceVal;
        state.selectedWarhammerId = id;
        const el = document.getElementById("competitorPriceUsd");
        if (el) el.value = String(priceVal);
        saveSession();
        setStatus(`Warhammer kit selected · RRP ${money(priceVal)} — generating undercut.`);
        schedulePrice();
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="note">Catalog unavailable: ${err.message}</p>`;
  }
}

loadSession();
renderShell();
price();
refreshResin(false);
