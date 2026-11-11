/**
 * app.js — UI Logic & State Management
 * Tema: Neo-Brutalisme (shadows tebal, border hitam, warna kontras, font bold)
 * Search-as-you-type pakai <datalist> native
 */

// ============================ STATE ============================
let masterData = [];
let logData = [];   // data mentah 1 tanggal (dari API / demo)
let viewData = [];  // hasil filter (bahasa) -> yang ditampilkan
let selectedMember = null;
let namaToMember = {};
let labelToMember = {};

// ============================ DOM REFS ============================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  apiUrlInput: $('#api-url'),
  adminPass: $('#admin-pass'),
  adminExportBtn: $('#admin-export'),
  adminClearBtn: $('#admin-clear'),
  saveApiBtn:  $('#save-api'),
  testApiBtn:  $('#test-api'),
  clearApiBtn: $('#clear-api'),
  statusDot:   $('#status-dot'),
  statusText:  $('#status-text'),

  infoPopup:   $('#info-popup'),
  popupClose:  $('#popup-close'),
  infoBtn:     $('#info-btn'),

  searchInput: $('#search-nama'),
  namaList:    $('#nama-list'),
  kelasInput:  $('#kelas'),
  kamarInput:  $('#kamar'),
  bahasaInput: $('#bahasa'),
  ucapanInput: $('#ucapan'),
  pengabsenInput: $('#pengabsen'),

  submitBtn:   $('#submit-btn'),
  resetBtn:    $('#reset-btn'),

  filterDate:  $('#filter-date'),
  filterKelas: $('#filter-kelas'),
  filterBahasa: $('#filter-bahasa'),
  filterNama:  $('#filter-nama'),
  onlyDup:     $('#only-dup'),
  refreshLogBtn: $('#refresh-log'),
  exportBtn:   $('#export-csv'),
  logTable:    $('#log-table'),
  logCards:    $('#log-cards'),
  logCount:    $('#log-count'),

  statTotal:   $('#stat-total'),
  statUnique:  $('#stat-unique'),
  statDup:     $('#stat-dup'),
  statClass:   $('#stat-class'),

  toast:       $('#toast'),
  toastMsg:    $('#toast-msg'),

  // panel export XLSX
  xlsxFrom:    $('#xlsx-from'),
  xlsxTo:      $('#xlsx-to'),
  xlsxKelas:   $('#xlsx-kelas'),
  xlsxBahasa:  $('#xlsx-bahasa'),
  xlsxNama:    $('#xlsx-nama'),
  xlsxDup:     $('#xlsx-dup'),
  xlsxAll:     $('#xlsx-all'),
  xlsxPass:    $('#xlsx-pass'),
  xlsxBtn:     $('#xlsx-download'),
};

// ============================ INIT ============================
// Versi cache: kalau naik, data lokal versi lama dibuang supaya ga numpuk.
const CACHE_VERSION = 'v3-2026-11-10';

function clearStaleCache() {
  try {
    const prev = localStorage.getItem('absensi_cache_version');
    if (prev !== CACHE_VERSION) {
      localStorage.removeItem('absensi_logs_local');
      localStorage.setItem('absensi_cache_version', CACHE_VERSION);
    }
  } catch (e) { /* localStorage tidak tersedia */ }
}

document.addEventListener('DOMContentLoaded', async () => {
  loadApiUrl();

  // Event listeners
  els.saveApiBtn.addEventListener('click', saveApiUrl);
  els.testApiBtn.addEventListener('click', testApiConnection);
  els.clearApiBtn.addEventListener('click', clearApiUrl);
  els.adminExportBtn.addEventListener('click', adminExportAll);
  els.adminClearBtn.addEventListener('click', adminClearAll);
  els.searchInput.addEventListener('input', handleSearchInput);
  els.submitBtn.addEventListener('click', handleSubmit);
  els.resetBtn.addEventListener('click', resetForm);
  els.refreshLogBtn.addEventListener('click', loadLog);
  els.filterDate.addEventListener('change', loadLog);
  els.filterKelas.addEventListener('change', renderView);
  els.filterBahasa.addEventListener('change', renderView);
  els.filterNama.addEventListener('input', renderView);
  els.onlyDup.addEventListener('change', renderView);
  els.exportBtn.addEventListener('click', exportCSV);

  // Panel XLSX
  els.xlsxBtn.addEventListener('click', exportXLSX);
  els.xlsxAll.addEventListener('change', syncXlsxControls);
  els.xlsxFrom.addEventListener('change', syncXlsxControls);
  els.xlsxTo.addEventListener('change', syncXlsxControls);

  // Kolom 6 "Language Improvement Section" -> otomatis huruf kapital
  els.pengabsenInput.addEventListener('input', (e) => {
    const el = e.target;
    const up = el.value.toUpperCase();
    if (up !== el.value) {
      const pos = el.selectionStart;
      el.value = up;
      try { el.setSelectionRange(pos, pos); } catch (err) {}
    }
  });

  // Popup info
  els.popupClose.addEventListener('click', hideInfoPopup);
  els.infoBtn.addEventListener('click', showInfoPopup);
  els.infoPopup.addEventListener('click', (e) => {
    if (e.target === els.infoPopup) hideInfoPopup();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.infoPopup.hidden) hideInfoPopup();
  });

  // Set default filter date = hari ini SEBELUM load data
  els.filterDate.value = todayStr();
  els.xlsxFrom.value = todayStr();
  els.xlsxTo.value = todayStr();

  clearStaleCache();
  syncXlsxControls();

  // Popup muncul saat pertama buka web (per sesi browser)
  if (!sessionStorage.getItem('absensi_info_shown')) {
    sessionStorage.setItem('absensi_info_shown', '1');
    setTimeout(showInfoPopup, 400);
  }

  await initApp();
});

// ============================ POPUP INFO ============================
function showInfoPopup() {
  els.infoPopup.hidden = false;
  requestAnimationFrame(() => els.infoPopup.classList.add('is-open'));
}

function hideInfoPopup() {
  els.infoPopup.classList.remove('is-open');
  setTimeout(() => { els.infoPopup.hidden = true; }, 200);
}

// ============================ API URL ============================
function loadApiUrl() {
  const saved = localStorage.getItem('absensi_api_url');
  const shown = saved === null ? '/api' : saved;
  els.apiUrlInput.value = shown === 'local' ? '' : shown;
  window.ABSENSI_API_URL = '';
  // Jangan buru-buru bilang "Terhubung" — dicek beneran dulu sama initApp()
  updateStatus('checking');
}

function saveApiUrl() {
  const url = els.apiUrlInput.value.trim() || '/api';
  localStorage.setItem('absensi_api_url', url);
  window.ABSENSI_API_URL = '';
  updateStatus('connected');
  showToast('API URL disimpan: ' + url);
  initApp();
}

async function testApiConnection() {
  const raw = els.apiUrlInput.value.trim() || '/api';

  const sep = raw.includes('?') ? '&' : '?';
  els.testApiBtn.disabled = true;
  els.testApiBtn.textContent = 'TES...';

  try {
    const pingRes = await fetch(raw + sep + 'action=ping', { cache: 'no-store' });
    if (!pingRes.ok) throw new Error('HTTP ' + pingRes.status);
    const ping = await pingRes.json();
    if (!ping.ok) throw new Error(ping.error || 'respon tidak valid');

    const mRes = await fetch(raw + sep + 'action=master', { cache: 'no-store' });
    const m = await mRes.json();
    if (!m.ok) throw new Error(m.error || 'gagal baca master');

    showToast('API OK! ' + (m.count || (m.data || []).length) + ' anggota terbaca.');
    updateStatus('connected');
  } catch (err) {
    showToast('API gagal: ' + err.message, true);
    updateStatus('fallback');
  } finally {
    els.testApiBtn.disabled = false;
    els.testApiBtn.textContent = 'TES';
  }
}

function clearApiUrl() {
  // 'local' = sentinel: paksa mode lokal (data cuma di browser ini)
  els.apiUrlInput.value = '';
  localStorage.setItem('absensi_api_url', 'local');
  window.ABSENSI_API_URL = '';
  updateStatus('demo');
  showToast('Mode Lokal aktif — data cuma tersimpan di browser ini');
  initApp();
}

function updateStatus(state) {
  if (state === 'connected') {
    els.statusDot.className = 'w-4 h-4 rounded-full bg-green-500 border-2 border-black';
    els.statusText.textContent = 'Terhubung';
    els.statusText.className = 'font-bold text-green-700';
  } else if (state === 'checking') {
    els.statusDot.className = 'w-4 h-4 rounded-full bg-gray-300 border-2 border-black';
    els.statusText.textContent = 'Menghubungkan…';
    els.statusText.className = 'font-bold text-gray-600';
  } else if (state === 'fallback') {
    els.statusDot.className = 'w-4 h-4 rounded-full bg-orange-400 border-2 border-black';
    els.statusText.textContent = 'Mode Lokal (API gagal)';
    els.statusText.className = 'font-bold text-orange-700';
  } else {
    els.statusDot.className = 'w-4 h-4 rounded-full bg-yellow-400 border-2 border-black';
    els.statusText.textContent = 'Mode Demo';
    els.statusText.className = 'font-bold text-yellow-700';
  }
}

// ============================ FILTER ============================
// Filter yang bisa dipakai barengan: tanggal (server/API) + bahasa (client)
function applyFilters(rows) {
  let out = rows.slice();

  // 1) filter bahasa ucapan
  const bahasa = els.filterBahasa ? els.filterBahasa.value : '';
  if (bahasa) {
    const b = bahasa.toLowerCase();
    out = out.filter((r) => String(r.bahasa || '').toLowerCase() === b);
  }

  // 2) filter tingkat kelas (1/2/3/4)
  const kelas = els.filterKelas ? els.filterKelas.value : '';
  if (kelas) {
    out = out.filter((r) => tingkatOf(r) === parseInt(kelas, 10));
  }

  // 3) filter cari nama (mengandung teks, case-insensitive)
  const cari = els.filterNama ? els.filterNama.value.trim().toLowerCase() : '';
  if (cari) {
    out = out.filter((r) => String(r.nama || '').toLowerCase().indexOf(cari) !== -1);
  }

  // 4) filter kelipatan: hanya nama yang absen lebih dari 1x
  if (els.onlyDup && els.onlyDup.checked) {
    const counter = {};
    out.forEach((r) => {
      const k = String(r.nama || '').trim().toLowerCase();
      counter[k] = (counter[k] || 0) + 1;
    });
    out = out.filter((r) => counter[String(r.nama || '').trim().toLowerCase()] > 1);
  }

  return out;
}

/** Render ulang dari data yang sudah ada (tanpa fetch) */
function renderView() {
  viewData = applyFilters(logData);
  renderLogTable();
  updateStats();
}

// ============================ MASTER DATA ============================
async function initApp() {
  try {
    const res = await window.apiGet('master');
    masterData = res.data || [];

    // API aktif tapi sheet Master_Anggota masih kosong -> upload daftar anggota dari web
    if (!res.fallback && window.getApiBase && window.getApiBase() && masterData.length === 0) {
      masterData = (window.DEMO_MASTER || []).slice();
      try {
        await window.apiPost({
          action: 'syncmaster',
          members: JSON.stringify(masterData.map((m) => [m.id, m.nama, m.kelas, m.kamar, m.bahasa_default])),
        });
        showToast(masterData.length + ' anggota disiapkan di server.');
      } catch (err) {
        showToast('Gagal upload anggota: ' + err.message, true);
      }
    }

    buildDatalist();
    buildKelasOptions();
    buildXlsxKelasOptions();

    // Status panel atas: hijau HANYA kalau API benar-benar hidup.
    // Kalau tidak, data input berisiko tidak tersimpan -> kasih tahu user.
    if (res.fallback || res.mode === 'lokal') {
      updateStatus('fallback');
      showToast('API tidak bisa dihubungi — pakai data lokal. Kosongkan Koneksi API untuk Mode Lokal.', true);
    } else {
      updateStatus('connected');
    }

    await loadLog();
  } catch (err) {
    updateStatus('fallback');
    showToast('Gagal load master: ' + err.message, true);
    console.error(err);
  }
}

function buildKelasOptions() {
  if (!els.filterKelas) return;
  const set = {};
  masterData.forEach((m) => {
    const t = m.tingkat || tingkatFromKelas(m.kelas);
    if (t) set[t] = true;
  });

  const list = Object.keys(set).map(Number).sort((a, b) => a - b);

  const current = els.filterKelas.value;
  els.filterKelas.innerHTML = '<option value="">Semua Kelas</option>' +
    list.map((k) => `<option value="${k}">${k}</option>`).join('');
  els.filterKelas.value = current;
}

function buildXlsxKelasOptions() {
  if (!els.xlsxKelas) return;
  const set = {};
  masterData.forEach((m) => {
    const t = m.tingkat || tingkatFromKelas(m.kelas);
    if (t) set[t] = true;
  });

  const list = Object.keys(set).map(Number).sort((a, b) => a - b);

  const current = els.xlsxKelas.value;
  els.xlsxKelas.innerHTML = '<option value="">Semua Kelas</option>' +
    list.map((k) => `<option value="${k}">${k}</option>`).join('');
  els.xlsxKelas.value = current;
}

function buildDatalist() {
  els.namaList.innerHTML = '';
  namaToMember = {};
  labelToMember = {};

  masterData.forEach((m) => {
    const label = m.label || m.nama;
    const opt = document.createElement('option');
    opt.value = label;
    opt.dataset.id = m.id;
    opt.dataset.kelas = m.kelas;
    opt.dataset.kamar = m.kamar;
    opt.dataset.bahasa = m.bahasa_default;
    els.namaList.appendChild(opt);

    labelToMember[String(label).trim().toLowerCase()] = m;

    // Index nama polos (buat sinkron kelas/kamar di rekap lama).
    // Kalau nama dobel -> ambil yang pertama, sisanya tetap bisa dipilih via label.
    const key = String(m.nama || '').trim().toLowerCase();
    if (!namaToMember[key]) namaToMember[key] = m;
  });
}

// ============================ SEARCH ============================
function handleSearchInput(e) {
  const q = e.target.value.toLowerCase().trim();

  // Datalist sudah filter native; kita cuma perlu autofill saat user memilih
  // Gunakan event 'change' pada input (native) tapi kita cek di sini juga
  if (q.length < 2) return;

  // Cari yang persis cocok (untuk autofill otomatis)
  const exact = masterData.find(m => (m.label || m.nama).toLowerCase() === q);
  if (exact) {
    selectMember(exact);
  }
}

// Input 'change' event trigger saat user memilih dari datalist
els.searchInput.addEventListener('change', () => {
  const val = els.searchInput.value.trim();
  if (!val) return;

  // Cari exact match (label atau nama)
  const m = masterData.find(x => (x.label || x.nama) === val) ||
            masterData.find(x => x.nama === val);
  if (m) selectMember(m);
});

function selectMember(m) {
  selectedMember = m;
  const t = m.tingkat || tingkatFromKelas(m.kelas);
  els.kelasInput.value = t || '';
  els.kelasInput.title = m.kelas || '';
  els.kamarInput.value = m.kamar;
  els.bahasaInput.value = m.bahasa_default;
}

// ============================ SUBMIT ============================
async function handleSubmit() {
  if (!selectedMember) {
    showToast('Pilih nama dulu!', true);
    return;
  }

  const payload = {
    pengabsen: (els.pengabsenInput.value.trim() || 'LIS 26-27').toUpperCase(),
    nama: selectedMember.nama,
    kelas: selectedMember.kelas,
    tingkat: selectedMember.tingkat || tingkatFromKelas(selectedMember.kelas),
    kamar: selectedMember.kamar,
    bahasa: els.bahasaInput.value,
    ucapan: els.ucapanInput.value.trim(),
  };

  // Pengaman: kalau API belum terhubung, data berisiko hilang -> konfirmasi dulu
  if (els.statusText.textContent !== 'Terhubung') {
    const lanjut = confirm(
      'Status saat ini BUKAN "Terhubung".\n\n' +
      'Kalau API tidak aktif, data yang dikirim bisa TIDAK tersimpan di cloud.\n' +
      'Lanjut kirim(absensi)?'
    );
    if (!lanjut) return;
  }

  if (!payload.ucapan) {
    showToast('Isi ucapan dulu!', true);
    return;
  }

  // Cek absen ganda hari ini (berdasarkan log yang sudah dimuat)
  const date = els.filterDate.value; // hari yang difilter
  const dup = logData.find(r => r.nama === payload.nama && r.timestamp && r.timestamp.indexOf(date) === 0);
  if (dup) {
    if (!confirm(`"${payload.nama}" sudah absen tanggal ${date}. Tetap kirim lagi?`)) return;
  }

  setLoading(true);

  try {
    const res = await window.apiPost(payload);
    showToast('Berhasil! ID: ' + res.id_log);
    resetForm();
    await loadLog();
  } catch (err) {
    showToast('Gagal submit: ' + err.message, true);
    console.error(err);
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  els.submitBtn.disabled = on;
  els.submitBtn.textContent = on ? 'Mengirim...' : 'KIRIM ABSENSI';
  els.submitBtn.classList.toggle('opacity-50', on);
}

function resetForm() {
  els.searchInput.value = '';
  els.kelasInput.value = '';
  els.kamarInput.value = '';
  els.bahasaInput.value = 'Indonesian';
  els.ucapanInput.value = '';
  selectedMember = null;
}


// ============================ SINKRON KELAS ============================
// Ambil kelas & kamar TERBARU dari master berdasarkan nama.
// Jadi kalau data anggota berubah (naik kelas / pindah kamar),
// rekap lama ikut menyesuaikan otomatis.
function memberOf(nama) {
  const key = String(nama || '').trim().toLowerCase();
  return namaToMember[key] || null;
}

function kelasOf(row) {
  const m = memberOf(row.nama);
  return m && m.kelas ? m.kelas : (row.kelas || '');
}

function kamarOf(row) {
  const m = memberOf(row.nama);
  return m && m.kamar ? m.kamar : (row.kamar || '');
}

// ============================ TINGKAT KELAS ============================
// Kolom "Kelas" di master = "I A".."IV G" (romawi + huruf).
// Tapi buat filter & laporan kita cuma butuh tingkatnya: 1, 2, 3, 4.
const ROMAN_TINGKAT = { I: 1, II: 2, III: 3, IV: 4 };

function tingkatFromKelas(kelas) {
  const k = String(kelas || '').trim().toUpperCase();
  const m = /^([IV]{1,3}|IV)\b/.exec(k);
  if (m && ROMAN_TINGKAT[m[1]]) return ROMAN_TINGKAT[m[1]];
  const n = /^(\d)/.exec(k);
  if (n) return parseInt(n[1], 10);
  return 0;
}

/** Tingkat kelas (1-4) untuk sebuah baris log */
function tingkatOf(row) {
  if (row && row.tingkat) return parseInt(row.tingkat, 10);
  const m = memberOf(row.nama);
  if (m && m.tingkat) return m.tingkat;
  return tingkatFromKelas(kelasOf(row));
}

// ============================ LOG TABLE ============================
async function loadLog() {
  const date = els.filterDate.value;
  if (!date) return;

  try {
    const res = await window.apiGet('log', { date });
    logData = res.data || [];
    renderView();
  } catch (err) {
    showToast('Gagal load log: ' + err.message, true);
    console.error(err);
  }
}

function renderLogTable() {
  // Table (desktop)
  els.logTable.innerHTML = '';

  // Cards (mobile)
  els.logCards.innerHTML = '';

  if (viewData.length === 0) {
    els.logTable.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-gray-500">Belum ada data</td></tr>';
    els.logCards.innerHTML = '<div class="nb-card p-6 text-center text-gray-500">Belum ada data untuk tanggal ini</div>';
    els.logCount.textContent = '0 entri';
    return;
  }

  viewData.forEach((row) => {
    // Table row
    const tr = document.createElement('tr');
    tr.className = 'border-b-2 border-black hover:bg-yellow-100 transition-colors';
    tr.innerHTML = `
      <td class="p-3 font-mono text-xs">${esc(row.id_log)}</td>
      <td class="p-3 font-mono text-xs">${esc(row.timestamp)}</td>
      <td class="p-3 font-bold">${esc(row.nama)}</td>
      <td class="p-3" title="${esc(kelasOf(row))}">${esc(tingkatOf(row))}</td>
      <td class="p-3">${esc(kamarOf(row))}</td>
      <td class="p-3">${esc(row.bahasa)}</td>
      <td class="p-3 italic">${esc(row.ucapan)}</td>
    `;
    els.logTable.appendChild(tr);

    // Card (mobile)
    const card = document.createElement('div');
    card.className = 'nb-card p-4 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]';
    card.innerHTML = `
      <div class="flex justify-between items-start mb-2">
        <span class="font-bold text-lg">${esc(row.nama)}</span>
        <span class="nb-chip bg-purple-300 text-xs">${esc(row.bahasa)}</span>
      </div>
      <div class="grid grid-cols-2 gap-1 text-sm font-mono mb-2">
        <div>Kelas: <span class="font-bold">${esc(tingkatOf(row))}</span></div>
        <div>Kamar: <span class="font-bold">${esc(kamarOf(row))}</span></div>
        <div>Timestamp: <span class="font-bold">${esc(row.timestamp)}</span></div>
        <div>ID: <span class="font-bold">${esc(row.id_log)}</span></div>
      </div>
      <div class="italic border-t-2 border-black pt-2">${esc(row.ucapan)}</div>
    `;
    els.logCards.appendChild(card);
  });

  els.logCount.textContent = viewData.length + ' entri';
}

function updateStats() {
  const total = viewData.length;
  const uniqueNames = new Set(viewData.map(r => r.nama)).size;
  const uniqueClasses = new Set(viewData.map(r => tingkatOf(r)).filter(Boolean)).size;

  els.statTotal.textContent = total;
  els.statUnique.textContent = uniqueNames;
  els.statDup.textContent = Math.max(total - uniqueNames, 0);
  els.statClass.textContent = uniqueClasses;
}

// ============================ EXPORT CSV ============================
const CSV_COLS = [
  { key: 'id_log',    label: 'id_log' },
  { key: 'timestamp', label: 'timestamp' },
  { key: 'pengabsen', label: 'Language Improvement Section' },
  { key: 'nama',      label: 'nama' },
  { key: 'tingkat',   label: 'kelas' },
  { key: 'kelas_rinci', label: 'kelas_rinci' },
  { key: 'kamar',     label: 'kamar' },
  { key: 'bahasa',    label: 'bahasa' },
  { key: 'ucapan',    label: 'ucapan' },
];

function buildCSV(rows) {
  const body = rows.map((r) => {
    const resolved = Object.assign({}, r, {
      tingkat: tingkatOf(r),
      kelas_rinci: kelasOf(r),
      kamar: kamarOf(r),
    });
    return CSV_COLS.map((c) => {
      const v = String(resolved[c.key] !== undefined ? resolved[c.key] : '');
      return v.includes(',') || v.includes('"') || v.includes('\n')
        ? '"' + v.replace(/"/g, '""') + '"'
        : v;
    }).join(',');
  });
  return [CSV_COLS.map((c) => c.label).join(','), ...body].join('\n');
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCSV() {
  if (!viewData.length) {
    showToast('Tidak ada data untuk diekspor', true);
    return;
  }
  downloadText(buildCSV(viewData), 'Log_Harian_' + els.filterDate.value + '.csv');
  showToast('CSV berhasil diunduh!');
}

// ============================ EXPORT XLSX ============================
// Template resmi (contoh.xlsx): No | Name | Date | Class | Room | Speaking | Group
// Group = Extreme kalau bahasa Javanese, Medium kalau Indonesian (sesuai template).
// Speaking ditulis "Indonesian Language" / "Javanese Language".
// 1 sheet per tanggal.

function syncXlsxControls() {
  const all = els.xlsxAll.checked;
  els.xlsxFrom.disabled = all;
  els.xlsxTo.disabled = all;
  els.xlsxPass.disabled = !all;
  els.xlsxPass.parentElement.classList.toggle('opacity-50', !all);
}

function xlsxRoomOf(row) {
  const m = memberOf(row.nama);
  if (m) {
    if (m.kamar_no) return String(m.kamar_no);
    if (m.rayon === 'MTQ') return 'MTQ';
    return '-';
  }
  // fallback: ambil angka dari string kamar lama
  const raw = String(row.kamar || '').trim();
  const num = /(\d+)\s*$/.exec(raw);
  if (num) return num[1];
  if (/mtq/i.test(raw)) return 'MTQ';
  return '-';
}

function xlsxGroupOf(row) {
  const b = String(row.bahasa || '').toLowerCase();
  return b.indexOf('jav') !== -1 ? 'Extreme' : 'Medium';
}

function xlsxSpeakingOf(row) {
  const b = String(row.bahasa || 'Indonesian');
  if (b.toLowerCase().indexOf('jav') !== -1) return 'Javanese Language';
  return 'Indonesian Language';
}

async function exportXLSX() {
  const allDates = els.xlsxAll.checked;
  const from = els.xlsxFrom.value;
  const to = els.xlsxTo.value;
  const kelasF = els.xlsxKelas.value;
  const bahasaF = els.xlsxBahasa.value;
  const namaF = els.xlsxNama ? els.xlsxNama.value.trim().toLowerCase() : '';
  const dupOnly = els.xlsxDup.checked;

  if (!allDates) {
    if (!from || !to) { showToast('Pilih rentang tanggal dulu', true); return; }
    if (from > to) { showToast('Tanggal awal harus lebih dulu dari tanggal akhir', true); return; }
  } else if (!els.xlsxPass.value.trim()) {
    showToast('Isi password admin untuk mode SEMUA TANGGAL', true);
    return;
  }

  els.xlsxBtn.disabled = true;
  els.xlsxBtn.textContent = 'MENYIAPKAN...';

  try {
    let rows = [];
    if (allDates) {
      const res = await window.apiPost({ action: 'export', password: els.xlsxPass.value.trim() });
      rows = res.data || [];
    } else {
      const res = await window.apiGet('logs', { from, to });
      if (res.fallback) {
        showToast('API tidak terhubung — data yang diunduh hanya data lokal browser', true);
      }
      rows = res.data || [];
    }

    // ---- filter ----
    let filtered = rows.filter((r) => {
      if (kelasF && tingkatOf(r) !== parseInt(kelasF, 10)) return false;
      if (bahasaF && String(r.bahasa || '') !== bahasaF) return false;
      if (namaF && String(r.nama || '').toLowerCase().indexOf(namaF) === -1) return false;
      return true;
    });

    // hitung kelipatan per tanggal
    const perDate = {};
    filtered.forEach((r) => {
      const d = String(r.timestamp || '').slice(0, 10);
      const k = String(r.nama || '').trim().toLowerCase();
      perDate[d] = perDate[d] || {};
      perDate[d][k] = (perDate[d][k] || 0) + 1;
    });

    if (dupOnly) {
      filtered = filtered.filter((r) => {
        const d = String(r.timestamp || '').slice(0, 10);
        const k = String(r.nama || '').trim().toLowerCase();
        return (perDate[d] && perDate[d][k]) > 1;
      });
    }

    if (!filtered.length) {
      showToast('Tidak ada data untuk filter ini', true);
      return;
    }

    // ---- group per tanggal -> sheet ----
    const byDate = {};
    filtered.forEach((r) => {
      const d = String(r.timestamp || '').slice(0, 10);
      (byDate[d] = byDate[d] || []).push(r);
    });

    const sheets = Object.keys(byDate).sort().map((d) => {
      const list = byDate[d].slice().sort((a, b) =>
        String(a.timestamp || '').localeCompare(String(b.timestamp || ''))
      );
      return {
        name: window.AbsensiXLSX.sheetNameForDate(d),
        rows: list.map((r) => ({
          nama: r.nama,
          date: d,
          kelas: tingkatOf(r),
          kamar: xlsxRoomOf(r),
          speaking: xlsxSpeakingOf(r),
          group: xlsxGroupOf(r),
        })),
      };
    });

    const blob = window.AbsensiXLSX.buildWorkbook(sheets);
    const stamp = todayStr().replace(/-/g, '');
    const fname = allDates
      ? 'Absensi_Semua_Tanggal_' + stamp + '.xlsx'
      : 'Absensi_' + from + '_sd_' + to + '.xlsx';

    window.AbsensiXLSX.downloadBlob(blob, fname);
    showToast(sheets.length + ' sheet, ' + filtered.length + ' baris diunduh');
  } catch (err) {
    const msg = String(err.message || '');
    showToast(msg.indexOf('401') !== -1 ? 'Password admin salah' : 'Gagal buat XLSX: ' + msg, true);
    console.error(err);
  } finally {
    els.xlsxBtn.disabled = false;
    els.xlsxBtn.textContent = 'UNDUH XLSX';
  }
}

// ============================ PANEL ADMIN ============================
function adminPassword() {
  const pw = (els.adminPass.value || '').trim();
  if (!pw) {
    showToast('Isi password admin dulu', true);
    return '';
  }
  return pw;
}

async function adminExportAll() {
  const pw = adminPassword();
  if (!pw) return;

  els.adminExportBtn.disabled = true;
  els.adminExportBtn.textContent = 'MENGUNDUH...';

  try {
    const res = await window.apiPost({ action: 'export', password: pw });
    const rows = res.data || [];
    if (!rows.length) {
      showToast('Belum ada data di cloud', true);
      return;
    }
    const stamp = todayStr().replace(/-/g, '');
    downloadText(buildCSV(rows), 'SEMUA_Log_Absensi_' + stamp + '.csv');
    downloadText(JSON.stringify(rows, null, 2), 'BACKUP_Absensi_' + stamp + '.json', 'application/json');
    showToast(rows.length + ' data diunduh (CSV + backup JSON)');
  } catch (err) {
    const msg = String(err.message || '');
    showToast(msg.indexOf('401') !== -1 ? 'Password admin salah' : 'Gagal unduh: ' + msg, true);
  } finally {
    els.adminExportBtn.disabled = false;
    els.adminExportBtn.textContent = 'UNDUH SEMUA DATA';
  }
}

async function adminClearAll() {
  const pw = adminPassword();
  if (!pw) return;

  if (!confirm('HAPUS SEMUA DATA absensi di cloud?\n\nSebaiknya klik UNDUH SEMUA DATA dulu buat backup.')) return;
  if (!confirm('Yakin 100%? Semua rekap absensi akan hilang permanen.')) return;

  els.adminClearBtn.disabled = true;
  els.adminClearBtn.textContent = 'MENGHAPUS...';

  try {
    const res = await window.apiPost({ action: 'clearall', password: pw });
    showToast((res.deleted || 0) + ' data dihapus dari cloud');
    await loadLog();
  } catch (err) {
    const msg = String(err.message || '');
    showToast(msg.indexOf('401') !== -1 ? 'Password admin salah' : 'Gagal hapus: ' + msg, true);
  } finally {
    els.adminClearBtn.disabled = false;
    els.adminClearBtn.textContent = 'HAPUS SEMUA DATA';
  }
}

// ============================ UTILS ============================
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function showToast(msg, isError = false) {
  els.toastMsg.textContent = msg;
  els.toast.className =
    'fixed bottom-6 right-6 px-6 py-4 border-4 border-black font-bold text-lg shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all duration-300 transform translate-y-0 ' +
    (isError
      ? 'bg-red-400 text-black'
      : 'bg-green-400 text-black');

  els.toast.classList.remove('translate-y-32', 'opacity-0');

  setTimeout(() => {
    els.toast.classList.add('translate-y-32', 'opacity-0');
  }, 3000);
}