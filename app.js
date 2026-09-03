/**
 * Unit Farmasi Klinik Kesihatan Sik — Standalone Temperature Web App Script
 */

const CONFIG = {
  unit: 'UNIT FARMASI KLINIK KESIHATAN SIK',
  defaultUrl: 'https://script.google.com/macros/s/AKfycbx84PC4_XAKuYaT9NGZgq4-wZbafTlal7h4YmURvX0rZ5-6zQrRpM_FcxAbt-HMo28/exec',
  adminPin: '2104',
  ranges: {
    PETI_SEJUK: { min: -4, max: 17, targetMin: 2, targetMax: 8, label: 'Peti Sejuk (Cold Chain: 2.0°C ke 8.0°C)' },
    BILIK:      { min: 12, max: 34, targetMin: 20, targetMax: 25, label: 'Bilik Suhu Ambien (12.0°C ke 34.0°C)' },
    SUBSTOR:    { min: 12, max: 34, targetMin: 20, targetMax: 25, label: 'Substor Suhu Ambien (12.0°C ke 34.0°C)' }
  },
  perkara: {
    PETI_SEJUK: [
      { value: '', label: '-- Tiada Masalah / Normal --' },
      { value: 'A', label: 'A - TIADA PRODUK/BAHAN RANGKAIAN SEJUK DISIMPAN' },
      { value: 'B', label: 'B - TIDAK CUKUP BEKALAN ELEKTRIK' },
      { value: 'C', label: 'C - PETI SEJUK TIDAK BERFUNGSI DENGAN BETUL' },
      { value: 'D', label: 'D - PEMBANTU TEKNIK DIPANGGIL UNTUK PENAMBAHBAIKAN' },
      { value: 'E', label: 'E - PETI SEJUK DALAM PEMBAIKAN' }
    ],
    BILIK: [
      { value: '', label: '-- Tiada Masalah / Normal --' },
      { value: 'A', label: 'A - TIADA BEKALAN ELEKTRIK' },
      { value: 'B', label: 'B - PENGHAWA DINGIN TIDAK BERFUNGSI DENGAN BETUL' },
      { value: 'C', label: 'C - PENGHAWA DINGIN DALAM PEMBAIKAN' }
    ],
    SUBSTOR: [
      { value: '', label: '-- Tiada Masalah / Normal --' },
      { value: 'A', label: 'A - TIADA BEKALAN ELEKTRIK' },
      { value: 'B', label: 'B - PENGHAWA DINGIN TIDAK BERFUNGSI DENGAN BETUL' },
      { value: 'C', label: 'C - PENGHAWA DINGIN DALAM PEMBAIKAN' }
    ]
  }
};

let currentLokasi = 'PETI_SEJUK';
let logs = JSON.parse(localStorage.getItem('kk_sik_temp_logs') || '[]');
let webAppUrl = localStorage.getItem('kk_sik_web_app_url') || CONFIG.defaultUrl;
let tempChart = null;

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  document.getElementById('webAppUrl').value = webAppUrl;

  // Set default date & time
  const now = new Date();
  const isoDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  document.getElementById('dateInput').value = isoDate;
  document.getElementById('incidentDate').value = isoDate;
  document.getElementById('incidentTime').value = timeStr;

  // Set AM / PM based on current hour
  const hour = now.getHours();
  const autoSlot = hour >= 14 ? 'PM' : 'AM';
  const slotRadio = document.querySelector(`input[name="slot"][value="${autoSlot}"]`);
  if (slotRadio) slotRadio.checked = true;

  // Event Listeners for Date & Slot to calculate Target Row
  document.getElementById('dateInput').addEventListener('change', updateCalculatedRow);
  document.querySelectorAll('input[name="slot"]').forEach(r => {
    r.addEventListener('change', () => {
      updateCalculatedRow();
      checkTimeWindow();
    });
  });

  // Event Listeners for Temperature Inputs
  ['min', 'semasa', 'max'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => validateTemperatureInput(id));
    }
  });

  // Switch to initial location
  switchLokasi('PETI_SEJUK');
  updateCalculatedRow();
  checkTimeWindow();
  renderLogs();
  initChart();
}

/** Switch Location (Peti Sejuk, Bilik, Substor) */
function switchLokasi(lokasiKey) {
  currentLokasi = lokasiKey;

  // Sync tab UI buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.getAttribute('data-lokasi') === lokasiKey) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update Section Headers & Badges
  const cfg = CONFIG.ranges[lokasiKey];
  document.getElementById('activeLocationTitle').textContent = lokasiKey.replace('_', ' ');
  document.getElementById('locationRangeBadge').textContent = cfg.label;

  // Populate Perkara Select Options
  const select = document.getElementById('perkaraSelect');
  select.innerHTML = '';
  const options = CONFIG.perkara[lokasiKey] || [];
  options.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  });

  // Re-validate inputs for new location limits
  ['min', 'semasa', 'max'].forEach(id => validateTemperatureInput(id));

  renderLogs();
  updateChart();
}

/** Calculate Target Row in Google Sheets based on user date + slot */
function updateCalculatedRow() {
  const dateStr = document.getElementById('dateInput').value;
  const slotEl = document.querySelector('input[name="slot"]:checked');
  const slot = slotEl ? slotEl.value : 'AM';
  const rowBadge = document.getElementById('targetRowPill');

  if (!dateStr) {
    rowBadge.innerHTML = '📊 Baris Google Sheets: -';
    return;
  }

  const targetRow = calculateTargetRow(dateStr, slot);
  if (targetRow > 0) {
    rowBadge.innerHTML = `📊 Target Google Sheets: <b>Baris ${targetRow}</b> (${slot})`;
  } else {
    rowBadge.innerHTML = `⚠️ Tarikh Luar Julat (2025 - 2036)`;
  }
}

/** Calculation formula matching rowFor_(date, slot) */
function calculateTargetRow(isoDate, slot) {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return -1;
  const year = d.getFullYear();
  if (year < 2025 || year > 2036) return -1;

  d.setHours(0,0,0,0);
  const base = new Date(2025, 0, 1);
  const days = Math.floor((d.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
  const offset = (String(slot).toUpperCase() === 'PM') ? 1 : 0;
  return 2 + (days * 2) + offset;
}

/** Check AM / PM Time Window Warnings */
function checkTimeWindow() {
  const hour = new Date().getHours();
  const slotEl = document.querySelector('input[name="slot"]:checked');
  const slot = slotEl ? slotEl.value : 'AM';
  const windowPill = document.getElementById('timeWindowPill');

  if (slot === 'AM') {
    if (hour >= 7 && hour < 13) {
      windowPill.className = 'info-pill in-window';
      windowPill.innerHTML = '🟢 Dalam Sesi AM Rasmi (07:00 AM - 01:00 PM)';
    } else {
      windowPill.className = 'info-pill out-window';
      windowPill.innerHTML = '⚠️ Luar Waktu AM Rasmi (07:00 AM - 01:00 PM)';
    }
  } else {
    if (hour >= 14 && hour <= 18) {
      windowPill.className = 'info-pill in-window';
      windowPill.innerHTML = '🟢 Dalam Sesi PM Rasmi (02:00 PM - 06:00 PM)';
    } else {
      windowPill.className = 'info-pill out-window';
      windowPill.innerHTML = '⚠️ Luar Waktu PM Rasmi (02:00 PM - 06:00 PM)';
    }
  }
}

/** Validate individual temp inputs */
function validateTemperatureInput(id) {
  const val = parseFloat(document.getElementById(id).value);
  const badge = document.getElementById(id + 'Badge');
  if (!badge) return;

  if (isNaN(val)) {
    badge.className = 'temp-badge hidden';
    return;
  }

  const cfg = CONFIG.ranges[currentLokasi];

  if (val >= cfg.targetMin && val <= cfg.targetMax) {
    badge.className = 'temp-badge ok';
    badge.textContent = `✅ Selamat (${val}°C)`;
  } else if (val >= cfg.min && val <= cfg.max) {
    badge.className = 'temp-badge warn';
    badge.textContent = `⚠️ Perhatian (${val}°C)`;
  } else {
    badge.className = 'temp-badge warn';
    badge.textContent = `🚨 Luar Julat Sah (${cfg.min}°C ke ${cfg.max}°C)!`;
    // Auto-open incident report form
    document.getElementById('incidentYes').checked = true;
    toggleIncidentForm(true);
  }
}

function toggleIncidentForm(show) {
  const box = document.getElementById('incidentFieldsBox');
  if (box) box.classList.toggle('hidden', !show);
}

/** Form Submission Handler */
document.getElementById('tempForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const submitBtn = document.getElementById('submitBtn');

  const payload = {
    lokasi: currentLokasi,
    date: fd.get('date'),
    slot: fd.get('slot'),
    min: fd.get('min'),
    semasa: fd.get('semasa'),
    max: fd.get('max'),
    perkara: fd.get('perkara'),
    nama: fd.get('nama')
  };

  if (document.getElementById('incidentYes').checked) {
    payload.incident = {
      enabled: true,
      date: document.getElementById('incidentDate').value || payload.date,
      time: document.getElementById('incidentTime').value || '',
      officer: document.getElementById('incidentOfficer').value || payload.nama || '',
      note: document.getElementById('incidentNote').value || ''
    };
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Menghantar...';

  let success = false;
  let responseData = null;

  if (webAppUrl) {
    try {
      // Google Apps Script returns a 302 redirect on POST.
      // Cross-origin fetch in 'cors' mode cannot follow this redirect,
      // so we use 'no-cors' mode with redirect:'follow' to allow the
      // browser to follow the redirect and deliver the payload.
      // The trade-off: we cannot read the response body in 'no-cors' mode,
      // so we treat a successful fetch (no thrown error) as success.
      const res = await fetch(webAppUrl, {
        method: 'POST',
        mode: 'no-cors',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      // In 'no-cors' mode, res.type will be 'opaque' and status will be 0.
      // If we get here without error, the request was sent successfully.
      success = true;
    } catch (err) {
      console.error('Fetch to Google Apps Script failed:', err);
      success = false;
    }
  }

  // Save to LocalStorage
  logs.unshift({
    ...payload,
    id: Date.now(),
    timestamp: new Date().toISOString(),
    synced: success
  });
  localStorage.setItem('kk_sik_temp_logs', JSON.stringify(logs));

  submitBtn.disabled = false;
  submitBtn.textContent = '🚀 Hantar Rekod Suhu';

  showSuccessModal(success);
  resetForm();
  renderLogs();
  updateChart();
});

/** Overwrite Modal Handlers */
function showOverwriteModal(payload, row) {
  const modal = document.getElementById('overwriteModal');
  document.getElementById('overwriteDataText').textContent = 
    `Rekod bagi ${payload.lokasi} pada ${payload.date} (${payload.slot}) sudah wujud pada Baris ${row}. Adakah anda pasti untuk mengemas kini (overwrite)?`;
  modal.classList.add('active');

  document.getElementById('confirmOverwriteBtn').onclick = () => {
    modal.classList.remove('active');
    payload.overwrite = true;
    document.getElementById('tempForm').dispatchEvent(new Event('submit'));
  };
}

function closeOverwriteModal() {
  document.getElementById('overwriteModal').classList.remove('active');
}

/** Render Recent Logs Table */
function renderLogs() {
  const tbody = document.getElementById('logTableBody');
  const filtered = logs.filter(l => l.lokasi === currentLokasi);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">Tiada rekod disimpan untuk ${currentLokasi.replace('_',' ')} lagi.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.slice(0, 15).map(r => `
    <tr>
      <td><b>${r.date}</b></td>
      <td><span class="range-pill">${r.slot}</span></td>
      <td>${r.min !== '' ? r.min + ' °C' : '-'}</td>
      <td><b>${r.semasa !== '' ? r.semasa + ' °C' : '-'}</b></td>
      <td>${r.max !== '' ? r.max + ' °C' : '-'}</td>
      <td>${r.perkara || '-'}</td>
      <td>${r.nama || '-'}</td>
      <td>${r.synced ? '<span style="color:var(--success);">✅ Synced</span>' : '<span style="color:var(--warning);">💾 Offline</span>'}</td>
    </tr>
  `).join('');
}

/** Reset Form */
function resetForm() {
  document.getElementById('tempForm').reset();
  document.getElementById('incidentNo').checked = true;
  toggleIncidentForm(false);
  initApp();
}

/** Modal & Settings Functions */
function openAdminSettings() {
  document.getElementById('pinBox').classList.remove('hidden');
  document.getElementById('urlBox').classList.add('hidden');
  document.getElementById('adminPin').value = '';
  document.getElementById('settingsModal').classList.add('active');
}

function unlockAdmin() {
  const pin = document.getElementById('adminPin').value;
  if (pin === CONFIG.adminPin) {
    document.getElementById('pinBox').classList.add('hidden');
    document.getElementById('urlBox').classList.remove('hidden');
  } else {
    alert('PIN Admin Salah!');
  }
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

function saveSettings() {
  webAppUrl = document.getElementById('webAppUrl').value.trim();
  localStorage.setItem('kk_sik_web_app_url', webAppUrl);
  closeSettings();
  alert('Google Apps Script URL Berjaya Disimpan!');
}

function showSuccessModal(isSynced) {
  const modal = document.getElementById('successModal');
  document.getElementById('successText').textContent = isSynced
    ? 'Rekod suhu telah berjaya disinkronkan ke Google Spreadsheet (Unit Farmasi KK Sik)!'
    : 'Rekod telah disimpan secara tempatan (Local Storage).';
  modal.classList.add('active');
  setTimeout(() => modal.classList.remove('active'), 2200);
}

/** Export CSV Data */
function exportCSV() {
  if (logs.length === 0) {
    alert('Tiada data untuk dieksport.');
    return;
  }

  const headers = ['Lokasi', 'Tarikh', 'Slot', 'Suhu Min (°C)', 'Suhu Semasa (°C)', 'Suhu Max (°C)', 'Perkara', 'Pencatat', 'Synced'];
  const rows = logs.map(l => [
    l.lokasi,
    l.date,
    l.slot,
    l.min,
    l.semasa,
    l.max,
    `"${(l.perkara || '').replace(/"/g, '""')}"`,
    `"${(l.nama || '').replace(/"/g, '""')}"`,
    l.synced ? 'YA' : 'TIDAK'
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Rekod_Suhu_Farmasi_KKSik_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Chart.js Trend Visualizer */
function initChart() {
  const ctx = document.getElementById('tempChart');
  if (!ctx) return;

  tempChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Suhu Min (°C)', borderColor: '#0284c7', backgroundColor: 'rgba(2, 132, 199, 0.1)', data: [], fill: false, tension: 0.3 },
        { label: 'Suhu Semasa (°C)', borderColor: '#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.2)', data: [], fill: true, tension: 0.3 },
        { label: 'Suhu Max (°C)', borderColor: '#dc2626', backgroundColor: 'rgba(220, 38, 38, 0.1)', data: [], fill: false, tension: 0.3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        title: { display: true, text: 'Trend Bacaan Suhu' }
      },
      scales: {
        y: { title: { display: true, text: 'Suhu (°C)' } }
      }
    }
  });

  updateChart();
}

function updateChart() {
  if (!tempChart) return;
  const filtered = logs.filter(l => l.lokasi === currentLokasi).slice(0, 10).reverse();

  tempChart.data.labels = filtered.map(f => `${f.date} (${f.slot})`);
  tempChart.data.datasets[0].data = filtered.map(f => parseFloat(f.min) || null);
  tempChart.data.datasets[1].data = filtered.map(f => parseFloat(f.semasa) || null);
  tempChart.data.datasets[2].data = filtered.map(f => parseFloat(f.max) || null);

  tempChart.options.plugins.title.text = `Trend Bacaan Suhu — ${currentLokasi.replace('_',' ')}`;
  tempChart.update();
}
