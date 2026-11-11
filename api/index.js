const { put, list, get, del } = require('@vercel/blob');
const { randomBytes } = require('crypto');
const MASTER_ANGGOTA = require('../data/master.json');

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const LOG_PREFIX = 'logs/';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LIS26-27';

function send(res, status, obj) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  // Anti-cache: data absensi & master harus selalu fresh (biar ga numpuk cache lama)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(status).end(JSON.stringify(obj));
}

function nowWIB() {
  const d = new Date();
  // WIB = UTC+7, getTimezoneOffset is in minutes (local minus UTC)
  // Server usually runs UTC so offset is 0.
  // Force +7 offset.
  const offsetMs = 7 * 60 * 60 * 1000;
  const wib = new Date(d.getTime() + offsetMs);
  return wib.toISOString().replace('T', ' ').substring(0, 19);
}

function todayWIB() {
  return nowWIB().split(' ')[0];
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

async function readBlob(pathname) {
  const r = await get(pathname, { access: 'private', token: TOKEN });
  if (!r || !r.stream) return null;
  // get() returns a ReadableStream (not a Response)
  const text = await new Response(r.stream).text();
  return JSON.parse(text);
}

function isAdmin(pw) {
  return String(pw || '').trim() === ADMIN_PASSWORD;
}

/** Ambil SEMUA blob log (semua tanggal), sudah dipaginasi */
async function listAllLogs() {
  let page = await list({ prefix: LOG_PREFIX, token: TOKEN });
  let blobs = [...page.blobs];
  while (page.cursor) {
    page = await list({ prefix: LOG_PREFIX, token: TOKEN, cursor: page.cursor });
    blobs.push(...page.blobs);
  }
  return blobs;
}

/** Baca banyak blob paralel (dibatasi per batch biar nggak kena rate limit) */
async function readMany(blobs) {
  const out = [];
  const CHUNK = 40;
  for (let i = 0; i < blobs.length; i += CHUNK) {
    const slice = blobs.slice(i, i + CHUNK);
    const res = await Promise.all(
      slice.map(async (b) => {
        try { return await readBlob(b.pathname); } catch { return null; }
      })
    );
    res.forEach((r) => { if (r) out.push(r); });
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(res, 204, {});
  }

  const url = new URL(req.url, 'http://localhost');
  let action = url.searchParams.get('action') || '';
  let body = {};

  if (req.method === 'POST') {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    try {
      if (ct.includes('application/x-www-form-urlencoded')) {
        const raw = await getRawBody(req);
        const p = new URLSearchParams(raw);
        p.forEach((v, k) => (body[k] = v));
      } else if (ct.includes('application/json')) {
        const raw = await getRawBody(req);
        body = JSON.parse(raw);
      } else {
        // fallback: try to parse whatever
        const raw = await getRawBody(req);
        try { body = JSON.parse(raw); } catch { body = Object.fromEntries(new URLSearchParams(raw)); }
      }
    } catch {}
    if (!action) action = body.action || '';
  }

  action = String(action).trim();
  // POST tanpa action = simpan absensi (kompatibel dengan frontend lama)
  if (!action && req.method === 'POST') action = 'save';

  // ---------- GET ----------
  if (req.method === 'GET') {
    if (!action || action === 'ping') {
      return send(res, 200, { ok: true, mode: 'vercel', ts: nowWIB() });
    }

    if (action === 'master') {
      return send(res, 200, { ok: true, count: MASTER_ANGGOTA.length, data: MASTER_ANGGOTA });
    }

    // Log untuk rentang tanggal (dipakai panel export XLSX)
    if (action === 'logs') {
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      try {
        const blobs = await listAllLogs();
        // pathname: logs/YYYY-MM-DD/LOG-xxx.json
        const picked = blobs.filter((b) => {
          const m = /logs\/(\d{4}-\d{2}-\d{2})\//.exec(b.pathname);
          if (!m) return false;
          if (from && m[1] < from) return false;
          if (to && m[1] > to) return false;
          return true;
        });
        const data = await readMany(picked);
        data.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
        return send(res, 200, { ok: true, count: data.length, data });
      } catch (err) {
        return send(res, 500, { ok: false, error: 'Gagal membaca data: ' + err.message });
      }
    }

    if (action === 'log') {
      const date = url.searchParams.get('date') || todayWIB();
      const prefix = `${LOG_PREFIX}${date}/`;
      try {
        let page = await list({ prefix, token: TOKEN });
        let blobs = [...page.blobs];
        while (page.cursor) {
          page = await list({ prefix, token: TOKEN, cursor: page.cursor });
          blobs.push(...page.blobs);
        }
        const data = [];
        const readErrors = [];
        for (const b of blobs) {
          try {
            const rec = await readBlob(b.pathname);
            if (rec) data.push(rec);
          } catch (e) {
            readErrors.push({ pathname: b.pathname, err: e.message });
          }
        }
        data.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        return send(res, 200, { ok: true, data, _debug: { count: blobs.length, readErrors } });
      } catch (err) {
        return send(res, 500, { ok: false, error: 'Gagal membaca data: ' + err.message });
      }
    }

    return send(res, 404, { ok: false, error: 'Action tidak dikenal' });
  }

  // ---------- POST ----------
  if (req.method === 'POST') {
    if (action === 'save') {
      if (!body.nama) {
        return send(res, 400, { ok: false, error: 'Nama wajib diisi' });
      }
      const ts = nowWIB();
      const date = ts.split(' ')[0];
      const id = 'LOG-' + Date.now() + '-' + randomBytes(3).toString('hex').toUpperCase();
      const rec = {
        id_log: id,
        timestamp: ts,
        pengabsen: body.pengabsen || 'Admin',
        nama: body.nama,
        kelas: body.kelas || '',
        tingkat: body.tingkat || '',
        kamar: body.kamar || '',
        bahasa: body.bahasa || 'Indonesian',
        ucapan: body.ucapan || '',
      };
      try {
        await put(`${LOG_PREFIX}${date}/${id}.json`, JSON.stringify(rec), {
          access: 'private',
          token: TOKEN,
          contentType: 'application/json',
          addRandomSuffix: false,
        });
        return send(res, 200, { ok: true, id_log: id, timestamp: ts });
      } catch (err) {
        return send(res, 500, { ok: false, error: 'Gagal menyimpan: ' + err.message });
      }
    }

    if (action === 'syncmaster') {
      return send(res, 200, { ok: true, received: true, count: MASTER_ANGGOTA.length });
    }

    if (action === 'export') {
      if (!isAdmin(body.password)) {
        return send(res, 401, { ok: false, error: 'Password admin salah' });
      }
      try {
        const blobs = await listAllLogs();
        const data = await readMany(blobs);
        data.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
        return send(res, 200, { ok: true, count: data.length, data });
      } catch (err) {
        return send(res, 500, { ok: false, error: 'Gagal export: ' + err.message });
      }
    }

    if (action === 'clearall') {
      if (!isAdmin(body.password)) {
        return send(res, 401, { ok: false, error: 'Password admin salah' });
      }
      try {
        const blobs = await listAllLogs();
        if (blobs.length) {
          await del(blobs.map((b) => b.pathname), { token: TOKEN });
        }
        return send(res, 200, { ok: true, deleted: blobs.length });
      } catch (err) {
        return send(res, 500, { ok: false, error: 'Gagal hapus: ' + err.message });
      }
    }

    return send(res, 404, { ok: false, error: 'Action tidak dikenal' });
  }

  return send(res, 405, { ok: false, error: 'Method tidak didukung' });
};
