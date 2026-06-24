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
  renderTabs();
  renderSettings();
  renderDay();
  loadBackups();
}

function renderSettings() {
  els.reportPeriod.value = data.settings.report_period || "";
  els.randomize.checked = Boolean(data.settings.randomize);
  els.emailSubject.value = `Relatório semanal - Journée - ${els.reportPeriod.value}`;
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
  return {
    name: "",
    duration: 0,
    duration_variation: 0,
    travel: 0,
    travel_variation: 0,
    fixed_arrival: "",
    fixed_departure: "",
    notes: "",
  };
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

  day.locations.forEach((location, index) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><input data-field="name" list="locationSuggestions" type="text" value="${escapeHtml(location.name || "")}"></td>
      <td><input data-field="duration" type="number" min="0" step="1" value="${location.duration || 0}"></td>
      <td><input data-field="duration_variation" type="number" min="0" step="1" value="${location.duration_variation || 0}"></td>
      <td><input data-field="travel" type="number" min="0" step="1" value="${location.travel || 0}"></td>
      <td><input data-field="travel_variation" type="number" min="0" step="1" value="${location.travel_variation || 0}"></td>
      <td><input data-field="fixed_arrival" type="time" value="${location.fixed_arrival || ""}"></td>
      <td><input data-field="fixed_departure" type="time" value="${location.fixed_departure || ""}"></td>
      <td><input data-field="notes" type="text" value="${escapeHtml(location.notes || "")}"></td>
      <td>
        <button data-action="up">↑</button>
        <button data-action="down">↓</button>
        <button data-action="remove" class="danger">×</button>
      </td>
    `;

    tr.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.field;
        const numericFields = ["duration", "duration_variation", "travel", "travel_variation"];
    
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
    

    tr.querySelector('[data-action="remove"]').addEventListener("click", () => {
      day.locations.splice(index, 1);
      renderDay();
    });

    tr.querySelector('[data-action="up"]').addEventListener("click", () => {
      if (index === 0) return;

      const item = day.locations.splice(index, 1)[0];
      day.locations.splice(index - 1, 0, item);
      renderDay();
    });

    tr.querySelector('[data-action="down"]').addEventListener("click", () => {
      if (index >= day.locations.length - 1) return;

      const item = day.locations.splice(index, 1)[0];
      day.locations.splice(index + 1, 0, item);
      renderDay();
    });

    els.locationsBody.appendChild(tr);
  });
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

  result.backups.forEach((filename) => {
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
  renderSettings();
  renderTabs();
  renderDay();

  toast("Backup restaurado");
}

function escapeHtml(value) {
  return String(value)
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
