/**
 * script.js — API transport layer
 * Komunikasi ke backend cloud (Vercel Functions + Vercel Blob)
 * atau penyimpanan lokal browser (mode offline / lokal).
 * Semua UI logic ada di app.js.
 */

// Master data lokal (724 anggota) dari js/master-data.js
const DEMO_MASTER = (window.MASTER_ANGGOTA || []).map((m) => ({
  id: m.id,
  stambuk: m.stambuk || '',
  nama: m.nama,
  label: m.label || m.nama,
  kelas: m.kelas,
  tingkat: m.tingkat || 0,
  rayon: m.rayon || '',
  kamar: m.kamar,
  kamar_no: m.kamar_no || '',
  bahasa_default: m.bahasa_default || 'Indonesian',
  status: m.status || 'Aktif',
}));

const LS_LOGS = 'absensi_logs_local';

function pad2(n) { return String(n).padStart(2, '0'); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nowStamp() {
  const d = new Date();
  return `${todayStr()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Log contoh (hanya dipakai kalau localStorage masih kosong)
const DEMO_LOGS = [
  { id_log: 'LOG-DEMO-0001', timestamp: `${todayStr()} 06:30:00`, pengabsen: 'LIS 26-27', nama: 'Abdullah Rafif Ahmad', kelas: 'I A', kamar: 'Madinah - Kamar 2', bahasa: 'Indonesian', ucapan: 'Selamat pagi, semangat belajar!' },
  { id_log: 'LOG-DEMO-0002', timestamp: `${todayStr()} 06:31:00`, pengabsen: 'LIS 26-27', nama: 'Abinaya Baskara Winata', kelas: 'I A', kamar: 'MTQ', bahasa: 'Indonesian', ucapan: 'Selamat pagi, jaga kesehatan ya!' },
  { id_log: 'LOG-DEMO-0003', timestamp: `${todayStr()} 06:32:00`, pengabsen: 'LIS 26-27', nama: 'Syabil Ghaizan Syakur', kelas: 'IV G', kamar: 'Ampel (1) - Kamar 2', bahasa: 'Javanese', ucapan: 'Sugeng enjing, mboten kesupen sinau.' },
];

/* ---------------- penyimpanan lokal ---------------- */

function localLogs() {
  try {
    const raw = localStorage.getItem(LS_LOGS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveLocalLogs(arr) {
  try {
    localStorage.setItem(LS_LOGS, JSON.stringify(arr));
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------- transport ---------------- */

// Backend cloud default: /api (Vercel Function di project yang sama).
// Isi 'local' di localStorage buat maksa mode lokal tanpa API.
const DEFAULT_API_BASE = '/api';

function getApiBase() {
  const override = window.ABSENSI_API_URL;
  const stored = localStorage.getItem('absensi_api_url');
  const raw = (override !== undefined && override !== null && override !== '')
    ? override
    : (stored === null ? DEFAULT_API_BASE : stored);

  const v = String(raw || '').trim();
  if (v === 'local') return '';
  return v;
}

function apiUrl(action, params = {}) {
  const base = getApiBase();
  if (!base) return '';

  const q = new URLSearchParams({ action });
  Object.keys(params).forEach((k) => {
    if (params[k] !== undefined && params[k] !== null) q.set(k, params[k]);
  });

  const sep = base.includes('?') ? '&' : '?';
  return base + sep + q.toString();
}

/**
 * GET data dari Apps Script.
 * Kalau API URL belum diisi -> pakai data lokal.
 * Kalau API diisi tapi gagal (CORS / URL salah / offline) -> tetap pakai data lokal.
 */
async function apiGet(action, params = {}) {
  const url = apiUrl(action, params);

  if (!url) return localGet(action);

  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' dari server');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Server mengembalikan error');
    return json;
  } catch (err) {
    // API tidak bisa dihubungi -> app tetap jalan pakai data lokal
    const local = localGet(action, params);
    local.fallback = true;
    local.error = err.message || 'tidak bisa menghubungi API';
    return local;
  }
}

/** Data lokal (tanpa jaringan) */
function localGet(action, params = {}) {
  if (action === 'master') return { ok: true, data: [...DEMO_MASTER], mode: 'lokal' };
  if (action === 'log') {
    const logs = localLogs();
    return { ok: true, data: logs.length ? logs : [...DEMO_LOGS], mode: 'lokal' };
  }
  if (action === 'logs') {
    const from = params.from || '';
    const to = params.to || '';
    const src = localLogs();
    const data = (src.length ? src : [...DEMO_LOGS]).filter((r) => {
      const d = String(r.timestamp || '').slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    return { ok: true, count: data.length, data, mode: 'lokal' };
  }
  return { ok: true, data: [], mode: 'lokal' };
}

/**
 * POST absensi baru.
 * Kalau API URL belum diisi -> simpan ke localStorage (mode lokal).
 */
async function apiPost(payload) {
  // Backend butuh field action; default = simpan absensi
  if (!payload || !payload.action) payload = Object.assign({ action: 'save' }, payload || {});
  const url = getApiBase();

  if (!url) {
    // syncmaster tanpa API = tidak perlu apa-apa
    if (payload.action === 'syncmaster') return { ok: true, skipped: true, mode: 'lokal' };

    // mode lokal: export & clear pakai data browser
    if (payload.action === 'export') {
      const rows = localLogs();
      return { ok: true, count: rows.length, data: rows, mode: 'lokal' };
    }
    if (payload.action === 'clearall') {
      const n = localLogs().length;
      localStorage.removeItem(LS_LOGS);
      return { ok: true, deleted: n, mode: 'lokal' };
    }

    const logs = localLogs();
    const rec = {
      id_log: 'LOG-' + Date.now(),
      timestamp: nowStamp(),
      pengabsen: payload.pengabsen || 'Admin',
      nama: payload.nama || '',
      kelas: payload.kelas || '',
      kamar: payload.kamar || '',
      bahasa: payload.bahasa || 'Indonesian',
      ucapan: payload.ucapan || '',
    };
    logs.push(rec);
    if (!saveLocalLogs(logs)) throw new Error('Penyimpanan browser penuh / diblokir');
    return { ok: true, id_log: rec.id_log, timestamp: rec.timestamp, mode: 'lokal' };
  }

  const body = new URLSearchParams();
  Object.keys(payload).forEach((k) => {
    body.append(k, payload[k] === undefined || payload[k] === null ? '' : String(payload[k]));
  });

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (e) {
    throw new Error('API tidak bisa dihubungi. Data BELUM tersimpan — kosongkan Koneksi API untuk pakai Mode Lokal.');
  }

  if (!res.ok) throw new Error('HTTP ' + res.status + ' dari server');
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Server mengembalikan error');
  return json;
}

/** Hapus semua log lokal (buat reset demo) */
function apiResetLocal() {
  localStorage.removeItem(LS_LOGS);
  return { ok: true };
}

// Expose ke global scope untuk app.js
window.apiGet = apiGet;
window.apiPost = apiPost;
window.apiUrl = apiUrl;
window.apiResetLocal = apiResetLocal;
window.DEMO_MASTER = DEMO_MASTER;
window.DEMO_LOGS = DEMO_LOGS;
window.getApiBase = getApiBase;
