(() => {
  "use strict";

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
  let els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els = {
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

    bindGlobalEvents();

    loadData().catch((error) => {
      console.error(error);
      toast(error.message || "Erro ao carregar dados");
    });
  }

  function bindGlobalEvents() {
    els.addLocationBtn.addEventListener("click", () => {
      if (!data) {
        toast("Dados ainda não carregados");
        return;
      }

      collectAll();

      data.days[activeDay].locations.push(emptyLocation());
      renderDay();

      const cards = els.locationsBody.querySelectorAll(".location-card");
      const lastCard = cards[cards.length - 1];

      if (lastCard) {
        lastCard.scrollIntoView({ behavior: "smooth", block: "center" });

        const nameInput = lastCard.querySelector('[data-field="name"]');
        if (nameInput) {
          setTimeout(() => nameInput.focus(), 180);
        }
      }
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
  }

  function toast(message) {
    if (!els.toast) {
      alert(message);
      return;
    }

    els.toast.textContent = message;
    els.toast.classList.add("show");

    clearTimeout(toast._timer);

    toast._timer = setTimeout(() => {
      els.toast.classList.remove("show");
    }, 2400);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store",
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
    await loadBackups();
  }

  function normalizeData() {
    if (!data || typeof data !== "object") {
      data = {};
    }

    if (!data.settings || typeof data.settings !== "object") {
      data.settings = {};
    }

    if (!data.days || typeof data.days !== "object") {
      data.days = {};
    }

    dayOrder.forEach(([dayKey, label]) => {
      if (!data.days[dayKey] || typeof data.days[dayKey] !== "object") {
        data.days[dayKey] = {
          label,
          start_time: "07:30",
          start_variation: 0,
          locations: [],
        };
      }

      const day = data.days[dayKey];

      day.label = label;
      day.start_time = day.start_time || "07:30";
      day.start_variation = Number(day.start_variation || 0);

      if (!Array.isArray(day.locations)) {
        day.locations = [];
      }

      day.locations = day.locations.map((location) => ensureLocationDefaults(location));
    });
  }

  function ensureLocationDefaults(location) {
    const item = location && typeof location === "object" ? location : {};

    if (!item._id) {
      item._id = createId();
    }

    item.name = item.name ?? "";
    item.duration = Number(item.duration || 0);
    item.duration_variation = Number(item.duration_variation || 0);
    item.travel = Number(item.travel || 0);
    item.travel_variation = Number(item.travel_variation || 0);
    item.fixed_arrival = item.fixed_arrival ?? "";
    item.fixed_departure = item.fixed_departure ?? "";
    item.notes = item.notes ?? "";

    return item;
  }

  function createId() {
    if (window.crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    return `loc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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
      button.type = "button";
      button.className = key === activeDay ? "tab active" : "tab";
      button.textContent = label.replace("-FEIRA", "");

      button.addEventListener("click", () => {
        collectAll();
        activeDay = key;
        renderTabs();
        renderDay();
      });

      els.dayTabs.appendChild(button);
    });
  }

  function renderDay() {
    const day = data.days[activeDay];

    renderLocationSuggestions();

    els.dayTitle.textContent = day.label;
    els.startTime.value = day.start_time || "07:30";
    els.startVariation.value = Number(day.start_variation || 0);

    els.locationsBody.innerHTML = "";

    if (!day.locations.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `
        <strong>Nenhum local cadastrado neste dia.</strong><br>
        Clique em <b>Adicionar local</b> para criar o primeiro.
      `;
      els.locationsBody.appendChild(empty);
      return;
    }

    day.locations.forEach((location, index) => {
      ensureLocationDefaults(location);

      const card = document.createElement("article");
      card.className = "location-card";
      card.dataset.locationId = location._id;

      const fixedEnabled = Boolean(location.fixed_arrival || location.fixed_departure);
      const total = day.locations.length;
      const previewName = location.name.trim() || `Local ${index + 1}`;

      card.innerHTML = `
        <div class="location-head">
          <div class="location-title">
            <span class="location-number">${index + 1}</span>
            <span class="location-name-preview">${escapeHtml(previewName)}</span>
          </div>

          <div class="position-row" title="Mover rapidamente na lista">
            <span>Posição</span>
            <input
              data-action="position"
              type="range"
              min="1"
              max="${total}"
              value="${index + 1}"
              ${total <= 1 ? "disabled" : ""}
            >
            <span>${index + 1}/${total}</span>
          </div>

          <div class="location-actions">
            <button
              type="button"
              class="icon-btn drag-handle"
              data-action="drag"
              title="Arrastar"
              aria-label="Arrastar local"
            >↕</button>

            <button
              type="button"
              class="icon-btn"
              data-action="up"
              title="Mover para cima"
              aria-label="Mover para cima"
              ${index === 0 ? "disabled" : ""}
            >↑</button>

            <button
              type="button"
              class="icon-btn"
              data-action="down"
              title="Mover para baixo"
              aria-label="Mover para baixo"
              ${index >= total - 1 ? "disabled" : ""}
            >↓</button>
          </div>
        </div>

        <div class="location-body">
          <div class="location-main-grid">
            <label>
              Nome do local
              <input
                data-field="name"
                list="locationSuggestions"
                type="text"
                value="${escapeHtml(location.name)}"
                placeholder="Ex: Cliente A, Escritório"
              >
            </label>

            <label>
              Observação
              <input
                data-field="notes"
                type="text"
                value="${escapeHtml(location.notes)}"
                placeholder="Observações, detalhes do atendimento, etc."
              >
            </label>
          </div>

          <div class="panel-grid">
            <section class="mini-panel">
              <div class="mini-panel-title">Tempo no local</div>

              <label class="switch-line">
                <span>Usar horários fixos</span>

                <span class="switch">
                  <input
                    data-action="fixed-toggle"
                    type="checkbox"
                    ${fixedEnabled ? "checked" : ""}
                  >
                  <span class="slider-toggle"></span>
                </span>
              </label>

              <div class="field-row ${fixedEnabled ? "is-disabled" : ""}">
                <label>
                  Duração
                  <input
                    data-field="duration"
                    data-duration-input="true"
                    type="text"
                    value="${escapeHtml(minutesToDuration(location.duration))}"
                    placeholder="Ex: 90min, 1h30, 2h"
                    ${fixedEnabled ? "disabled" : ""}
                  >
                  <span class="help">Formato: 90min, 1h30, 2h ou 45</span>
                </label>

                <label>
                  Variação, min
                  <input
                    data-field="duration_variation"
                    type="number"
                    min="0"
                    step="1"
                    value="${Number(location.duration_variation || 0)}"
                    ${fixedEnabled ? "disabled" : ""}
                  >
                </label>
              </div>

              <div class="fixed-row" ${fixedEnabled ? "" : "hidden"}>
                <label>
                  Chegada fixa
                  <input
                    data-field="fixed_arrival"
                    type="time"
                    value="${escapeHtml(location.fixed_arrival)}"
                  >
                </label>

                <label>
                  Saída fixa
                  <input
                    data-field="fixed_departure"
                    type="time"
                    value="${escapeHtml(location.fixed_departure)}"
                  >
                </label>
              </div>
            </section>

            <section class="mini-panel">
              <div class="mini-panel-title">Deslocamento</div>

              <div class="field-row">
                <label>
                  Deslocamento
                  <input
                    data-field="travel"
                    data-duration-input="true"
                    type="text"
                    value="${escapeHtml(minutesToDuration(location.travel))}"
                    placeholder="Ex: 15min, 30min"
                  >
                  <span class="help">Tempo para chegar ao próximo local</span>
                </label>

                <label>
                  Variação, min
                  <input
                    data-field="travel_variation"
                    type="number"
                    min="0"
                    step="1"
                    value="${Number(location.travel_variation || 0)}"
                  >
                </label>
              </div>
            </section>
          </div>

          <button
            type="button"
            class="remove-full"
            data-action="remove"
          >
            Remover local
          </button>
        </div>
      `;

      bindLocationCardEvents(card, location, index, day);
      els.locationsBody.appendChild(card);
    });

    initDragAndDrop();
  }

  function bindLocationCardEvents(card, location, index, day) {
    card.querySelectorAll("input[data-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.field;

        if (input.dataset.durationInput === "true") {
          location[field] = durationToMinutes(input.value);
          return;
        }

        if (isNumericField(field)) {
          location[field] = Number(input.value || 0);
          return;
        }

        location[field] = input.value;

        if (field === "name") {
          const preview = card.querySelector(".location-name-preview");
          preview.textContent = input.value.trim() || `Local ${index + 1}`;
          renderLocationSuggestions();
        }
      });

      input.addEventListener("blur", () => {
        if (input.dataset.durationInput === "true") {
          const field = input.dataset.field;
          input.value = minutesToDuration(location[field]);
        }
      });
    });

    const fixedToggle = card.querySelector('[data-action="fixed-toggle"]');
    fixedToggle.addEventListener("change", () => {
      if (!fixedToggle.checked) {
        location.fixed_arrival = "";
        location.fixed_departure = "";
      }

      renderDay();
    });

    const removeBtn = card.querySelector('[data-action="remove"]');
    removeBtn.addEventListener("click", () => {
      if (!confirm(`Remover Local ${index + 1}?`)) {
        return;
      }

      day.locations.splice(index, 1);
      renderDay();
    });

    const upBtn = card.querySelector('[data-action="up"]');
    const downBtn = card.querySelector('[data-action="down"]');

    upBtn.addEventListener("click", () => moveLocation(index, index - 1));
    downBtn.addEventListener("click", () => moveLocation(index, index + 1));

    const positionRange = card.querySelector('[data-action="position"]');
    positionRange.addEventListener("change", () => {
      const targetIndex = Number(positionRange.value) - 1;
      moveLocation(index, targetIndex);
    });
  }

  function isNumericField(field) {
    return [
      "duration",
      "duration_variation",
      "travel",
      "travel_variation",
    ].includes(field);
  }

  function moveLocation(fromIndex, toIndex) {
    const day = data.days[activeDay];

    if (toIndex < 0 || toIndex >= day.locations.length || fromIndex === toIndex) {
      return;
    }

    collectAll();

    const item = day.locations.splice(fromIndex, 1)[0];
    day.locations.splice(toIndex, 0, item);

    renderDay();
  }

  function initDragAndDrop() {
    let draggedCard = null;

    els.locationsBody.querySelectorAll(".location-card").forEach((card) => {
      const handle = card.querySelector(".drag-handle");

      handle.addEventListener("pointerdown", () => {
        card.draggable = true;
      });

      card.addEventListener("dragstart", (event) => {
        draggedCard = card;
        card.classList.add("dragging");

        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", card.dataset.locationId);
        }
      });

      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        card.draggable = false;
        draggedCard = null;
        syncOrderFromDom();
      });

      card.addEventListener("dragover", (event) => {
        event.preventDefault();

        if (!draggedCard || draggedCard === card) {
          return;
        }

        const box = card.getBoundingClientRect();
        const middle = box.top + box.height / 2;

        if (event.clientY < middle) {
          els.locationsBody.insertBefore(draggedCard, card);
        } else {
          els.locationsBody.insertBefore(draggedCard, card.nextSibling);
        }
      });
    });
  }

  function syncOrderFromDom() {
    const ids = Array.from(
      els.locationsBody.querySelectorAll(".location-card")
    ).map((card) => card.dataset.locationId);

    if (!ids.length) {
      return;
    }

    const day = data.days[activeDay];

    day.locations.sort((a, b) => {
      return ids.indexOf(a._id) - ids.indexOf(b._id);
    });

    renderDay();
  }

  function collectDay() {
    const day = data.days[activeDay];

    day.start_time = els.startTime.value || "07:30";
    day.start_variation = Number(els.startVariation.value || 0);
  }

  function collectAll() {
    if (!data) {
      return;
    }

    collectDay();
    collectSettings();
  }

  async function saveData() {
    collectAll();

    const result = await api("api/data", {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (result.data) {
      data = result.data;
      normalizeData();
      renderDay();
    }

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

    els.reportText.value = result.report || "";

    if (!els.emailSubject.value.trim()) {
      els.emailSubject.value = `Relatório semanal - Journée - ${els.reportPeriod.value}`;
    }

    toast("Relatório gerado");
  }

  async function copyReport() {
    if (!els.reportText.value.trim()) {
      await generateReport();
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(els.reportText.value);
    } else {
      els.reportText.select();
      document.execCommand("copy");
    }

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

    const backups = Array.isArray(result.backups) ? result.backups : [];

    backups.forEach((backup) => {
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

    const suggestedName = filename.replace(/\.json$/i, "");
    const newName = prompt("Novo nome para o backup:", suggestedName);

    if (!newName || !newName.trim()) {
      return;
    }

    const result = await api("api/backup/rename", {
      method: "POST",
      body: JSON.stringify({
        filename,
        new_name: newName.trim(),
      }),
    });

    await loadBackups();

    if (result.new_file) {
      els.backupList.value = result.new_file;
    }

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
    if (!els.locationSuggestions || !data) {
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

  function durationToMinutes(value) {
    const raw = String(value || "")
      .trim()
      .toLowerCase()
      .replace(",", ".")
      .replace(/\s+/g, "");

    if (!raw) {
      return 0;
    }

    if (/^\d+$/.test(raw)) {
      return Number(raw);
    }

    let total = 0;

    const hourMatch = raw.match(/(\d+(?:\.\d+)?)h/);
    const minuteMatch = raw.match(/(\d+)m/);

    if (hourMatch) {
      total += Math.round(Number(hourMatch[1]) * 60);
    }

    if (minuteMatch) {
      total += Number(minuteMatch[1]);
    }

    if (!hourMatch && !minuteMatch) {
      const numeric = Number(raw.replace(/[^\d.]/g, ""));
      return Number.isFinite(numeric) ? Math.round(numeric) : 0;
    }

    return Math.max(0, total);
  }

  function minutesToDuration(minutes) {
    const value = Number(minutes || 0);

    if (!value) {
      return "";
    }

    const hours = Math.floor(value / 60);
    const mins = value % 60;

    if (hours && mins) {
      return `${hours}h${String(mins).padStart(2, "0")}`;
    }

    if (hours) {
      return `${hours}h`;
    }

    return `${mins}min`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
})();
