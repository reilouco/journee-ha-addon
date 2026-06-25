const dayOrder = [
  ["segunda", "SEGUNDA-FEIRA"],
  ["terca", "TERÇA-FEIRA"],
  ["quarta", "QUARTA-FEIRA"],
  ["quinta", "QUINTA-FEIRA"],
  ["sexta", "SEXTA-FEIRA"],
  ["sabado", "SÁBADO"],
];

let data = null;
let activeDay = "segunda";

const els = {
  dayTabs: document.getElementById("dayTabs"),
  dayTitle: document.getElementById("dayTitle"),
  startTime: document.getElementById("startTime"),
  startVariation: document.getElementById("startVariation"),
  locationsBody: document.getElementById("locationsBody"),
  addLocationBtn: document.getElementById("addLocationBtn"),
  saveBtn: document.getElementById("saveBtn"),
  reportBtn: document.getElementById("reportBtn"),
  reportText: document.getElementById("reportText"),
  copyBtn: document.getElementById("copyBtn"),
  emailBtn: document.getElementById("emailBtn"),
  emailSubject: document.getElementById("emailSubject"),
  emailRecipients: document.getElementById("emailRecipients"),
  reportPeriod: document.getElementById("reportPeriod"),
  randomize: document.getElementById("randomize"),
  backupName: document.getElementById("backupName"),
  backupBtn: document.getElementById("backupBtn"),
  backupList: document.getElementById("backupList"),
  restoreBtn: document.getElementById("restoreBtn"),
  toast: document.getElementById("toast"),
  locationSuggestions: document.getElementById("locationSuggestions"),
};

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");

  setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2300);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.detail || "Erro inesperado");
  }

  return payload;
}

async function loadData() {
  data = await api("api/data");

  normalizeData();

  renderTabs();
  renderSettings();
  renderDay();
  setupBackupButtons();
  loadBackups();
}

function normalizeData() {
  if (!data.settings) {
    data.settings = {};
  }

  dayOrder.forEach(([dayKey, label]) => {
    if (!data.days[dayKey]) {
      data.days[dayKey] = {
        label,
        start_time: "07:30",
        start_variation: 0,
        locations: [],
      };
    }

    if (!Array.isArray(data.days[dayKey].locations)) {
      data.days[dayKey].locations = [];
    }

    data.days[dayKey].locations.forEach((location) => {
      ensureLocationDefaults(location);
    });
  });
}

function ensureLocationDefaults(location) {
  if (!location._id) {
    location._id = createId();
  }

  if (location.name === undefined) {
    location.name = "";
  }

  if (location.duration === undefined) {
    location.duration = 0;
  }

  if (location.duration_variation === undefined) {
    location.duration_variation = 0;
  }

  if (location.travel === undefined) {
    location.travel = 0;
  }

  if (location.travel_variation === undefined) {
    location.travel_variation = 0;
  }

  if (location.fixed_arrival === undefined) {
    location.fixed_arrival = "";
  }

  if (location.fixed_departure === undefined) {
    location.fixed_departure = "";
  }

  if (location.notes === undefined) {
    location.notes = "";
  }

  return location;
}

function createId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `loc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function renderSettings() {
  els.reportPeriod.value = data.settings.report_period || "";
  els.randomize.checked = Boolean(data.settings.randomize);

  if (!els.emailSubject.value.trim()) {
    els.emailSubject.value = `Relatório semanal - Journée - ${els.reportPeriod.value}`;
  }
}

function collectSettings() {
  data.settings.report_period = els.reportPeriod.value;
  data.settings.randomize = els.randomize.checked;
}

function renderTabs() {
  els.dayTabs.innerHTML = "";

  dayOrder.forEach(([key, label]) => {
    const button = document.createElement("button");
    button.className = key === activeDay ? "tab active" : "tab";
    button.textContent = label.replace("-FEIRA", "");

    button.addEventListener("click", () => {
      collectDay();
      activeDay = key;
      renderTabs();
      renderDay();
    });

    els.dayTabs.appendChild(button);
  });
}

function emptyLocation() {
  return ensureLocationDefaults({
    _id: createId(),
    name: "",
    duration: 0,
    duration_variation: 0,
    travel: 0,
    travel_variation: 0,
    fixed_arrival: "",
    fixed_departure: "",
    notes: "",
  });
}

function getKnownLocationNames() {
  const names = new Set();

  dayOrder.forEach(([dayKey]) => {
    const day = data.days[dayKey];

    if (!day || !Array.isArray(day.locations)) {
      return;
    }

    day.locations.forEach((location) => {
      const name = String(location.name || "").trim();

      if (name) {
        names.add(name);
      }
    });
  });

  return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function renderLocationSuggestions() {
  if (!els.locationSuggestions) {
    return;
  }

  const names = getKnownLocationNames();

  els.locationSuggestions.innerHTML = "";

  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    els.locationSuggestions.appendChild(option);
  });
}

function renderDay() {
  renderLocationSuggestions();

  const day = data.days[activeDay];

  els.dayTitle.textContent = day.label;
  els.startTime.value = day.start_time || "07:30";
  els.startVariation.value = day.start_variation || 0;

  els.locationsBody.innerHTML = "";

  day.locations.forEach((location) => {
    ensureLocationDefaults(location);
  });

  day.locations.forEach((location, index) => {
    const row = document.createElement("tr");
    row.className = "location-card-row";
    row.dataset.locationId = location._id;

    const fixedEnabled = Boolean(location.fixed_arrival || location.fixed_departure);

    row.innerHTML = `
      <td colspan="9">
        <article class="location-card" data-location-id="${escapeHtml(location._id)}">
          <header class="location-header">
            <div class="location-title">
              <span class="location-number">${index + 1}</span>
              <strong>Local ${index + 1}</strong>
            </div>

            <div class="location-actions">
              <button
                type="button"
                class="drag-handle"
                data-action="drag"
                title="Segure e arraste para mudar a posição"
                aria-label="Arrastar local"
              >
                ↕
              </button>

              <button
                type="button"
                class="move-btn"
                data-action="up"
                title="Mover para cima"
                aria-label="Mover para cima"
                ${index === 0 ? "disabled" : ""}
              >
                ↑
              </button>

              <button
                type="button"
                class="move-btn"
                data-action="down"
                title="Mover para baixo"
                aria-label="Mover para baixo"
                ${index >= day.locations.length - 1 ? "disabled" : ""}
              >
                ↓
              </button>
            </div>
          </header>

          <div class="location-grid">
            <div class="field field-name">
              <label>Nome do Local</label>
              <input
                data-field="name"
                list="locationSuggestions"
                type="text"
                value="${escapeHtml(location.name || "")}"
                placeholder="Ex: 33 Poniatowski"
              >
            </div>

            <div class="field field-notes">
              <label>Observação</label>
              <input
                data-field="notes"
                type="text"
                value="${escapeHtml(location.notes || "")}"
                placeholder="Observações opcional"
              >
            </div>
          </div>

          <section class="location-section">
            <div class="location-section-title">Tempo no Local</div>

            <div class="switch-row">
              <span>Usar horários fixos, substitui duração</span>

              <label class="switch">
                <input
                  data-field="fixed_enabled"
                  type="checkbox"
                  ${fixedEnabled ? "checked" : ""}
                >
                <span class="switch-slider"></span>
              </label>
            </div>

            <div class="location-grid two-columns">
              <div class="field">
                <label>Duração</label>
                <input
                  data-field="duration"
                  type="number"
                  min="0"
                  step="1"
                  value="${location.duration || 0}"
                  ${fixedEnabled ? "disabled" : ""}
                >
                <small>Em minutos. Ex: 90, 120, 150</small>
              </div>

              <div class="field">
                <label>Variação ± min</label>
                <input
                  data-field="duration_variation"
                  type="number"
                  min="0"
                  step="1"
                  value="${location.duration_variation || 0}"
                  ${fixedEnabled ? "disabled" : ""}
                >
              </div>
            </div>

            <div class="location-grid two-columns fixed-time-fields ${fixedEnabled ? "" : "hidden"}">
              <div class="field">
                <label>Chegada fixa</label>
                <input
                  data-field="fixed_arrival"
                  type="time"
                  value="${location.fixed_arrival || ""}"
                >
              </div>

              <div class="field">
                <label>Saída fixa</label>
                <input
                  data-field="fixed_departure"
                  type="time"
                  value="${location.fixed_departure || ""}"
                >
              </div>
            </div>
          </section>

          <section class="location-section">
            <div class="location-section-title">Deslocamento</div>

            <div class="location-grid two-columns">
              <div class="field">
                <label>Deslocamento</label>
                <input
                  data-field="travel"
                  type="number"
                  min="0"
                  step="1"
                  value="${location.travel || 0}"
                >
                <small>Tempo para chegar ao próximo local, em minutos</small>
              </div>

              <div class="field">
                <label>Variação ± min</label>
                <input
                  data-field="travel_variation"
                  type="number"
                  min="0"
                  step="1"
                  value="${location.travel_variation || 0}"
                >
              </div>
            </div>
          </section>

          <button
            type="button"
            class="remove-location-btn danger"
            data-action="remove"
          >
            Remover Local
          </button>
        </article>
      </td>
    `;

    bindLocationRowEvents(row, location, index, day);

    els.locationsBody.appendChild(row);
  });

  initLocationDrag();
}

function bindLocationRowEvents(row, location, index, day) {
  row.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      const field = input.dataset.field;
      const numericFields = [
        "duration",
        "duration_variation",
        "travel",
        "travel_variation",
      ];

      if (field === "fixed_enabled") {
        const enabled = input.checked;

        if (!enabled) {
          location.fixed_arrival = "";
          location.fixed_departure = "";
        }

        renderDay();
        return;
      }

      if (numericFields.includes(field)) {
        location[field] = Number(input.value || 0);
      } else {
        location[field] = input.value;
      }

      if (field === "name") {
        renderLocationSuggestions();
      }
    });
  });

  const removeBtn = row.querySelector('[data-action="remove"]');
  const upBtn = row.querySelector('[data-action="up"]');
  const downBtn = row.querySelector('[data-action="down"]');

  removeBtn.addEventListener("click", () => {
    if (!confirm(`Remover Local ${index + 1}?`)) {
      return;
    }

    day.locations.splice(index, 1);
    renderDay();
  });

  upBtn.addEventListener("click", () => {
    moveLocation(index, -1);
  });

  downBtn.addEventListener("click", () => {
    moveLocation(index, 1);
  });
}

function moveLocation(index, direction) {
  const day = data.days[activeDay];
  const newIndex = index + direction;

  if (newIndex < 0 || newIndex >= day.locations.length) {
    return;
  }

  const item = day.locations.splice(index, 1)[0];
  day.locations.splice(newIndex, 0, item);

  renderDay();
}

function initLocationDrag() {
  const container = els.locationsBody;

  if (!container) {
    return;
  }

  let draggedRow = null;
  let pointerId = null;

  container.querySelectorAll(".drag-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      draggedRow = handle.closest(".location-card-row");

      if (!draggedRow) {
        return;
      }

      pointerId = event.pointerId;

      try {
        handle.setPointerCapture(pointerId);
      } catch {
        // Alguns navegadores/WebViews podem não suportar bem.
      }

      draggedRow.classList.add("dragging");
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!draggedRow) {
        return;
      }

      const targetRow = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest(".location-card-row");

      if (!targetRow || targetRow === draggedRow || !container.contains(targetRow)) {
        return;
      }

      const targetBox = targetRow.getBoundingClientRect();
      const targetMiddle = targetBox.top + targetBox.height / 2;

      if (event.clientY < targetMiddle) {
        container.insertBefore(draggedRow, targetRow);
      } else {
        container.insertBefore(draggedRow, targetRow.nextSibling);
      }
    });

    handle.addEventListener("pointerup", () => {
      finishDrag(container);
    });

    handle.addEventListener("pointercancel", () => {
      finishDrag(container);
    });
  });

  function finishDrag(containerElement) {
    if (!draggedRow) {
      return;
    }

    draggedRow.classList.remove("dragging");

    const newOrderIds = Array.from(
      containerElement.querySelectorAll(".location-card-row")
    ).map((row) => row.dataset.locationId);

    const day = data.days[activeDay];

    day.locations.sort((a, b) => {
      return newOrderIds.indexOf(a._id) - newOrderIds.indexOf(b._id);
    });

    draggedRow = null;
    pointerId = null;

    renderDay();
  }
}

function collectDay() {
  const day = data.days[activeDay];

  day.start_time = els.startTime.value || "07:30";
  day.start_variation = Number(els.startVariation.value || 0);
}

function collectAll() {
  collectDay();
  collectSettings();
}

async function saveData() {
  collectAll();

  await api("api/data", {
    method: "POST",
    body: JSON.stringify(data),
  });

  toast("Dados salvos");
}

async function generateReport() {
  await saveData();

  const result = await api("api/report/week", {
    method: "POST",
    body: JSON.stringify({
      force_random: data.settings.randomize,
    }),
  });

  els.reportText.value = result.report;

  if (!els.emailSubject.value.trim()) {
    els.emailSubject.value = `Relatório semanal - Journée - ${els.reportPeriod.value}`;
  }

  toast("Relatório gerado");
}

async function copyReport() {
  if (!els.reportText.value.trim()) {
    await generateReport();
  }

  await navigator.clipboard.writeText(els.reportText.value);
  toast("Relatório copiado");
}

async function sendReportEmail() {
  if (!els.reportText.value.trim()) {
    await generateReport();
  }

  const recipients = els.emailRecipients.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  await api("api/email/send", {
    method: "POST",
    body: JSON.stringify({
      subject: els.emailSubject.value,
      recipients,
      body: els.reportText.value,
    }),
  });

  toast("Email enviado");
}

async function createBackup() {
  await saveData();

  const name = els.backupName.value || undefined;

  await api("api/backup/create", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

  els.backupName.value = "";
  await loadBackups();

  toast("Backup criado");
}

async function loadBackups() {
  const result = await api("api/backup/list");

  els.backupList.innerHTML = "";

  result.backups.forEach((backup) => {
    const filename = typeof backup === "string" ? backup : backup.filename || backup.name;

    if (!filename) {
      return;
    }

    const option = document.createElement("option");
    option.value = filename;
    option.textContent = filename;
    els.backupList.appendChild(option);
  });
}

async function restoreBackup() {
  const filename = els.backupList.value;

  if (!filename) {
    toast("Nenhum backup selecionado");
    return;
  }

  if (!confirm(`Restaurar backup ${filename}?`)) {
    return;
  }

  const result = await api("api/backup/restore", {
    method: "POST",
    body: JSON.stringify({ filename }),
  });

  data = result.data;

  normalizeData();
  renderSettings();
  renderTabs();
  renderDay();

  toast("Backup restaurado");
}

function setupBackupButtons() {
  if (!els.backupList || !els.restoreBtn) {
    return;
  }

  if (document.getElementById("renameBackupBtn")) {
    return;
  }

  const renameBtn = document.createElement("button");
  renameBtn.id = "renameBackupBtn";
  renameBtn.type = "button";
  renameBtn.textContent = "Renomear Backup";
  renameBtn.className = "secondary";

  const deleteBtn = document.createElement("button");
  deleteBtn.id = "deleteBackupBtn";
  deleteBtn.type = "button";
  deleteBtn.textContent = "Excluir Backup";
  deleteBtn.className = "danger";

  els.restoreBtn.insertAdjacentElement("afterend", renameBtn);
  renameBtn.insertAdjacentElement("afterend", deleteBtn);

  renameBtn.addEventListener("click", () => {
    renameBackup().catch((error) => toast(error.message));
  });

  deleteBtn.addEventListener("click", () => {
    deleteBackup().catch((error) => toast(error.message));
  });
}

async function renameBackup() {
  const filename = els.backupList.value;

  if (!filename) {
    toast("Nenhum backup selecionado");
    return;
  }

  const newName = prompt("Novo nome para o backup:", filename);

  if (!newName || !newName.trim()) {
    return;
  }

  await api("api/backup/rename", {
    method: "POST",
    body: JSON.stringify({
      filename,
      new_name: newName.trim(),
    }),
  });

  await loadBackups();

  els.backupList.value = newName.trim();

  toast("Backup renomeado");
}

async function deleteBackup() {
  const filename = els.backupList.value;

  if (!filename) {
    toast("Nenhum backup selecionado");
    return;
  }

  if (!confirm(`Excluir definitivamente o backup ${filename}?`)) {
    return;
  }

  await api("api/backup/delete", {
    method: "DELETE",
    body: JSON.stringify({ filename }),
  });

  await loadBackups();

  toast("Backup excluído");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

els.addLocationBtn.addEventListener("click", () => {
  data.days[activeDay].locations.push(emptyLocation());
  renderDay();
});

els.saveBtn.addEventListener("click", () => {
  saveData().catch((error) => toast(error.message));
});

els.reportBtn.addEventListener("click", () => {
  generateReport().catch((error) => toast(error.message));
});

els.copyBtn.addEventListener("click", () => {
  copyReport().catch((error) => toast(error.message));
});

els.emailBtn.addEventListener("click", () => {
  sendReportEmail().catch((error) => toast(error.message));
});

els.backupBtn.addEventListener("click", () => {
  createBackup().catch((error) => toast(error.message));
});

els.restoreBtn.addEventListener("click", () => {
  restoreBackup().catch((error) => toast(error.message));
});

loadData().catch((error) => {
  toast(error.message);
});
