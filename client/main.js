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
    laborMinutes: 45,
    laborRatePerHour: 35,
    printHours: 6,
    machineRatePerHour: 2.5,
    packagingUsd: 4,
    shippingUsd: 8,
    failureRate: 0.08,
    floorMargin: 0.25,
    targetMargin: 0.4,
    stretchMargin: 0.55,
  },
  market: null,
  result: null,
  busy: false,
  copied: false,
  error: null,
};

const fields = [
  ["resinMassG", "Resin mass (g)", "from slicer / CTB"],
  ["printHours", "Print hours", "machine time"],
  ["laborMinutes", "Labor minutes", "wash, cure, pack, QA"],
  ["laborRatePerHour", "Labor rate ($/hr)", ""],
  ["machineRatePerHour", "Machine rate ($/hr)", "amortization + power"],
  ["packagingUsd", "Packaging ($)", ""],
  ["shippingUsd", "Shipping ($)", ""],
  ["failureRate", "Failure buffer (0–1)", "e.g. 0.08 = 8%"],
  ["bottlePriceUsd", "Bottle price ($)", "live Amazon or manual"],
  ["bottleMassG", "Bottle mass (g)", "usually 1000"],
  ["targetMargin", "Target margin (0–1)", "Print Ops default 0.40"],
  ["stretchMargin", "Stretch margin (0–1)", ""],
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

async function refreshMarket(force = false) {
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

async function price() {
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
  const result = state.result;
  const recommended = result?.recommended;

  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-kicker">Print Operations · Tool</div>
        <h1>Pricing Matrix</h1>
        <p>Turn resin mass, machine time, and live bottle cost into a quote that clears your target margin — with market bands for a sanity check.</p>
      </div>
      <div class="live-pill" title="${market?.warning || "Resin market feed"}">
        <span class="dot ${market?.warning ? "warn" : ""}"></span>
        <span>Resin ${market ? `<strong>${money(market.bottlePriceUsd)}</strong> / ${market.bottleMassG}g` : "loading…"}</span>
        <span>· ${market?.source || "—"}</span>
      </div>
    </header>

    <div class="layout">
      <section class="panel">
        <h2>Job inputs</h2>
        <div class="grid" id="fields"></div>
        <div class="actions">
          <button class="btn-primary" id="btn-price" ${state.busy ? "disabled" : ""}>${state.busy ? "Working…" : "Generate quote"}</button>
          <button class="btn-ghost" id="btn-refresh" ${state.busy ? "disabled" : ""}>Refresh Amazon resin</button>
        </div>
        ${market?.warning ? `<div class="warning">${market.warning}</div>` : ""}
        ${state.error ? `<div class="warning">${state.error}</div>` : ""}
        <p class="note">Defaults match Print Operations: 40% target margin, labor + machine rolled into <code>print_labor_cost</code> for HubSpot.</p>
      </section>

      <section class="panel">
        <h2>Best quote</h2>
        ${
          recommended
            ? `
          <div class="hero-quote">
            <div class="label">Recommended · ${recommended.label}</div>
            <div class="amount">${money(recommended.amountUsd)}</div>
            <div class="meta">${recommended.marginPercent}% margin · ${money(recommended.grossProfitUsd)} gross · cost ${money(result.costs.costTotalUsd)}</div>
          </div>
          <div class="tiers">
            ${result.tiers
              .map(
                (t) => `
              <div class="tier ${t.id === recommended.id ? "active" : ""}">
                <div class="name">${t.label}</div>
                <div class="val">${money(t.amountUsd)}</div>
                <div class="side">${t.marginPercent}% · ${money(t.grossProfitUsd)}</div>
              </div>`,
              )
              .join("")}
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
          <h2>Market bands</h2>
          <div class="market">
            ${result.marketBands
              .map(
                (b) => `
              <div class="row"><span>${b.label}</span><span>${money(b.lowUsd)} – ${money(b.highUsd)}</span></div>
              <div class="note" style="margin:0 0 0.4rem">${b.basis}</div>`,
              )
              .join("")}
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
            : `<p class="note">Enter the job and generate a quote to see floor / target / stretch pricing against live resin cost.</p>`
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
    input.addEventListener("change", () => {
      state.inputs[key] = Number(input.value);
    });
    wrap.appendChild(input);
    fieldsEl.appendChild(wrap);
  }

  document.getElementById("btn-price")?.addEventListener("click", () => price());
  document.getElementById("btn-refresh")?.addEventListener("click", () => refreshMarket(true));
  document.getElementById("btn-copy")?.addEventListener("click", () => copyHubspot());
}

render();
refreshMarket(false).then(() => price());
