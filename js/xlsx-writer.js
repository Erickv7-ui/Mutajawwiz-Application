/**
 * xlsx-writer.js — Generator file Excel (.xlsx) murni JavaScript, TANPA library.
 * Bikin workbook dengan styling persis template resmi (contoh.xlsx):
 *   - Header: No | Name Of Offenders (B:C) | Date | Class | Room | Speaking (G:H) | Group (I:J)
 *   - Fill kuning (No/Date/Class/Room/Group) + merah (Name/Speaking)
 *   - Font header: Times New Roman 11 bold | Data: Calibri 12
 *   - Border tipis semua sel, merge B:C, G:H, I:J di tiap baris
 *   - Tinggi baris 23 (header) / 20 (data), format tanggal mm-dd-yy
 * Zip ditulis manual (metode STORED + CRC32) — jadi jalan di browser & Node.
 */
(function (global) {
  'use strict';

  // ============================ CRC32 ============================
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xffffffff;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ============================ ZIP (stored) ============================
  function u16(v) { return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]); }
  function u32(v) { return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]); }

  function cat(arrs) {
    var n = 0, i;
    for (i = 0; i < arrs.length; i++) n += arrs[i].length;
    var out = new Uint8Array(n);
    var p = 0;
    for (i = 0; i < arrs.length; i++) { out.set(arrs[i], p); p += arrs[i].length; }
    return out;
  }

  function makeZip(files) {
    var enc = new TextEncoder();
    var parts = [];
    var centralParts = [];
    var offset = 0;
    var count = files.length;

    files.forEach(function (f) {
      var nameB = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);

      var local = cat([
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0x0000), u16(0x2182),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameB.length), u16(0),
        nameB, data
      ]);
      parts.push(local);

      centralParts.push(cat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0x0000), u16(0x2182),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0),
        u32(offset), nameB
      ]));
      offset += local.length;
    });

    var cd = cat(centralParts);
    var eocd = cat([
      u32(0x06054b50), u16(0), u16(0), u16(count), u16(count),
      u32(cd.length), u32(offset), u16(0)
    ]);

    return new Blob([cat(parts), cd, eocd], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function textToU8(s) { return new TextEncoder().encode(s); }

  // ============================ XML helpers ============================
  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  var COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  function cellRef(colIdx, row) { return COLS[colIdx] + row; }

  function strCell(colIdx, row, style, val) {
    return '<c r="' + cellRef(colIdx, row) + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(val) + '</t></is></c>';
  }

  /** Sel angka (angka bulat, mis. kolom Class = 1 / Room = 2) */
  function numCell(colIdx, row, style, val) {
    return '<c r="' + cellRef(colIdx, row) + '" s="' + style + '"><v>' + val + '</v></c>';
  }

  /** Pilih sel angka kalau nilainya angka, kalau bukan -> teks */
  function autoCell(colIdx, row, style, val) {
    if (val === '' || val === null || val === undefined) return strCell(colIdx, row, style, '');
    var n = Number(val);
    if (!isNaN(n) && String(val).trim() !== '' && isFinite(n)) {
      return numCell(colIdx, row, style, Math.round(n));
    }
    return strCell(colIdx, row, style, val);
  }

  /** Serial number Excel untuk tanggal 'YYYY-MM-DD' (hari sejak 1899-12-30) */
  function dateToSerial(dateStr) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(dateStr || ''));
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var e = Date.UTC(1899, 11, 30);
    return Math.round((t - e) / 86400000);
  }

  // ============================ STYLES ============================
  // Indeks style (s="..."):
  //   0 = default | 1 = header kuning center | 2 = header merah center
  //   3 = data center border | 4 = data kiri border | 5 = tanggal center border (mm-dd-yy)
  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="mm-dd-yy"/></numFmts>' +
    '<fonts count="2">' +
    '<font><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color theme="1"/><name val="Times New Roman"/><family val="1"/></font>' +
    '</fonts>' +
    '<fills count="4">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>' +
    '<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  // ============================ WORKSHEET ============================
  /**
   * rows: array of { nama, date, kelas, kamar, speaking, group }
   */
  function buildSheetXml(rows) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<cols>' +
      '<col min="1" max="1" width="6.63" customWidth="1"/>' +
      '<col min="2" max="3" width="9.36" customWidth="1"/>' +
      '<col min="4" max="4" width="12.18" customWidth="1"/>' +
      '<col min="5" max="6" width="6.45" customWidth="1"/>' +
      '<col min="7" max="8" width="10.63" customWidth="1"/>' +
      '<col min="9" max="10" width="9.36" customWidth="1"/>' +
      '</cols>' +
      '<sheetData>';

    // ---- header ----
    xml += '<row r="1" ht="23" customHeight="1" spans="1:10">';
    xml += strCell(0, 1, 1, 'No');
    xml += strCell(1, 1, 2, 'Name Of Offenders');
    xml += '<c r="C1" s="2"/>';
    xml += strCell(3, 1, 1, 'Date');
    xml += strCell(4, 1, 1, 'Class');
    xml += strCell(5, 1, 1, 'Room');
    xml += strCell(6, 1, 2, 'Speaking');
    xml += '<c r="H1" s="2"/>';
    xml += strCell(8, 1, 1, 'Group');
    xml += '<c r="J1" s="1"/>';
    xml += '</row>';

    var merges = ['B1:C1', 'G1:H1', 'I1:J1'];

    // ---- data ----
    for (var i = 0; i < rows.length; i++) {
      var r = i + 2;
      var d = rows[i];
      var serial = dateToSerial(d.date);

      xml += '<row r="' + r + '" ht="20" customHeight="1" spans="1:10">';
      xml += '<c r="A' + r + '" s="3"><v>' + (i + 1) + '</v></c>';
      xml += strCell(1, r, 4, d.nama || '');
      xml += '<c r="C' + r + '" s="4"/>';
      if (serial !== null) {
        xml += '<c r="D' + r + '" s="5"><v>' + serial + '</v></c>';
      } else {
        xml += strCell(3, r, 5, d.date || '');
      }
      xml += autoCell(4, r, 3, d.kelas);
      xml += autoCell(5, r, 3, d.kamar === '' || d.kamar === null || d.kamar === undefined ? '-' : d.kamar);
      xml += strCell(6, r, 3, d.speaking || '');
      xml += '<c r="H' + r + '" s="3"/>';
      xml += strCell(8, r, 3, d.group || '');
      xml += '<c r="J' + r + '" s="3"/>';
      xml += '</row>';

      merges.push('B' + r + ':C' + r, 'G' + r + ':H' + r, 'I' + r + ':J' + r);
    }

    xml += '</sheetData>';
    xml += '<mergeCells count="' + merges.length + '">';
    for (var m = 0; m < merges.length; m++) xml += '<mergeCell ref="' + merges[m] + '"/>';
    xml += '</mergeCells>';
    xml += '</worksheet>';
    return xml;
  }

  // ============================ NAMA SHEET ============================
  var MONTHS_ID = ['januari', 'februari', 'maret', 'april', 'mei', 'juni',
    'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];

  /** '2026-05-03' -> '3 mei 2026' (format nama sheet template) */
  function sheetNameForDate(dateStr) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(dateStr || ''));
    if (!m) return String(dateStr || 'Sheet');
    return (+m[3]) + ' ' + MONTHS_ID[+m[2] - 1] + ' ' + m[1];
  }

  function sanitizeSheetName(name, used) {
    var n = String(name || 'Sheet').replace(/[\[\]:\*\?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
    var base = n, i = 2;
    while (used[n]) { n = (base + ' (' + i + ')').slice(0, 31); i++; }
    used[n] = true;
    return n;
  }

  // ============================ WORKBOOK ============================
  /**
   * sheets: [{ name: '3 mei 2026', rows: [{nama, date, kelas, kamar, speaking, group}] }]
   * return: Blob (.xlsx)
   */
  function buildWorkbook(sheets) {
    sheets = sheets || [];
    var used = {};
    var files = [];
    var i;

    // [Content_Types].xml
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
    for (i = 0; i < sheets.length; i++) {
      ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    ct += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    ct += '</Types>';
    files.push({ name: '[Content_Types].xml', data: textToU8(ct) });

    // _rels/.rels
    files.push({
      name: '_rels/.rels',
      data: textToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>')
    });

    // workbook.xml + rels
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    for (i = 0; i < sheets.length; i++) {
      var nm = sanitizeSheetName(sheets[i].name, used);
      wb += '<sheet name="' + xmlEsc(nm) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      wbRels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    }
    var stylesId = 'rId' + (sheets.length + 1);
    wbRels += '<Relationship Id="' + stylesId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    wb += '</sheets></workbook>';
    wbRels += '</Relationships>';

    files.push({ name: 'xl/workbook.xml', data: textToU8(wb) });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: textToU8(wbRels) });
    files.push({ name: 'xl/styles.xml', data: textToU8(STYLES_XML) });

    for (i = 0; i < sheets.length; i++) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: textToU8(buildSheetXml(sheets[i].rows)) });
    }

    return makeZip(files);
  }

  // ============================ DOWNLOAD ============================
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ============================ EXPORT ============================
  global.AbsensiXLSX = {
    buildWorkbook: buildWorkbook,
    sheetNameForDate: sheetNameForDate,
    downloadBlob: downloadBlob
  };

})(typeof window !== 'undefined' ? window : globalThis);
