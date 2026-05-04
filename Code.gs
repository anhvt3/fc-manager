/**
 * FC Manager — Apps Script Data Driver
 *
 * NOTE: SCRIPT_KEY hardcoded ở đây phải khớp với Vercel env APPS_SCRIPT_KEY.
 * Nếu rotate key: update cả 2 nơi cùng lúc rồi redeploy.
 */
var SCRIPT_KEY = 'fc_manager_secret_2026';

function doGet(e) {
  var key = e.parameter.key;
  if (key !== SCRIPT_KEY) return jsonOut({error: 'Unauthorized'});

  var action = e.parameter.action;
  if (action === 'getAll') {
    return jsonOut({
      members: getSheetData('data.new.ThanhVien'),
      matches: getSheetData('data.new.TranDau'),
      fundPayments: getSheetData('data.new.DongQuy'),
      fixtures: getSheetData('data.new.LichThiDau')
    });
  }

  if (action === 'read') {
    var sheet = e.parameter.sheet;
    if (!sheet) return jsonOut({error: 'Missing sheet'});
    return jsonOut(getSheetData(sheet));
  }
  return jsonOut({error: 'Invalid action'});
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch(err) {}

  if (body.key !== SCRIPT_KEY) return jsonOut({error: 'Unauthorized'});

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(body.sheet);
  if (!sheet) return jsonOut({error: 'Sheet not found: ' + body.sheet});

  var ts = nowStr();

  // CREATE — append a new row
  if (body.action === 'create') {
    var row = body.data || [];
    if (row[0] === 'AUTO_TS') row[0] = ts;
    sheet.appendRow(row);
    return jsonOut({status: 'ok', timestamp: ts});
  }

  // UPDATE / DELETE — match by single column
  if (body.action === 'update' || body.action === 'delete') {
    var matchColumn = body.matchColumn || 1;
    var matchValue = String(body.matchValue == null ? '' : body.matchValue).trim();
    var data = sheet.getDataRange().getValues();
    var found = false;
    var renamePayload = null;

    for (var i = 1; i < data.length; i++) {
      var cellVal = data[i][matchColumn-1];
      if (cellVal instanceof Date) cellVal = Utilities.formatDate(cellVal, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
      if (String(cellVal).trim() === matchValue) {
        if (body.action === 'delete') {
          sheet.deleteRow(i+1);
        } else {
          var updateData = body.data || [];
          for (var c = 0; c < updateData.length; c++) {
            if (updateData[c] !== undefined && updateData[c] !== null) {
              var val = updateData[c];
              if (val === 'AUTO_TS') val = ts;
              sheet.getRange(i+1, c+1).setValue(val);
            }
          }
          // Cascade member rename: nếu update sheet ThanhVien và đổi tên ở cột 2,
          // cập nhật DongQuy.member theo (cột 3) để fund không mất link.
          if (body.sheet === 'data.new.ThanhVien' && matchColumn === 2 && updateData[1] && String(updateData[1]).trim() !== matchValue) {
            renamePayload = { from: matchValue, to: String(updateData[1]).trim() };
          }
        }
        found = true;
        break;
      }
    }

    if (renamePayload) cascadeMemberRename(renamePayload.from, renamePayload.to);
    return jsonOut({status: found ? 'ok' : 'not_found'});
  }

  // UPSERT — match across multiple columns (AND). Update if found, insert if not.
  if (body.action === 'upsert') {
    var cols = body.matchColumns || [];
    var vals = (body.matchValues || []).map(function(v){ return String(v == null ? '' : v).trim(); });
    if (cols.length !== vals.length || cols.length === 0) return jsonOut({error: 'matchColumns/matchValues mismatch'});
    var data = sheet.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) {
      var allMatch = true;
      for (var k = 0; k < cols.length; k++) {
        var v = data[i][cols[k]-1];
        if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
        if (String(v).trim() !== vals[k]) { allMatch = false; break; }
      }
      if (allMatch) { rowIdx = i+1; break; }
    }
    var rowData = (body.data || []).map(function(v){ return v === 'AUTO_TS' ? ts : v; });
    if (rowIdx > 0) {
      for (var c = 0; c < rowData.length; c++) {
        if (rowData[c] !== undefined && rowData[c] !== null) sheet.getRange(rowIdx, c+1).setValue(rowData[c]);
      }
      return jsonOut({status: 'ok', mode: 'updated'});
    } else {
      sheet.appendRow(rowData);
      return jsonOut({status: 'ok', mode: 'inserted', timestamp: ts});
    }
  }

  // DELETE COMPOSITE — match across multiple columns
  if (body.action === 'deleteComposite') {
    var cols = body.matchColumns || [];
    var vals = (body.matchValues || []).map(function(v){ return String(v == null ? '' : v).trim(); });
    if (cols.length !== vals.length || cols.length === 0) return jsonOut({error: 'matchColumns/matchValues mismatch'});
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var allMatch = true;
      for (var k = 0; k < cols.length; k++) {
        var v = data[i][cols[k]-1];
        if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
        if (String(v).trim() !== vals[k]) { allMatch = false; break; }
      }
      if (allMatch) { sheet.deleteRow(i+1); return jsonOut({status: 'ok'}); }
    }
    return jsonOut({status: 'not_found'});
  }

  return jsonOut({error: 'Invalid action'});
}

function cascadeMemberRename(fromName, toName) {
  if (!fromName || !toName || fromName === toName) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dq = ss.getSheetByName('data.new.DongQuy');
  if (!dq) return;
  var data = dq.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim() === fromName) {
      dq.getRange(i+1, 3).setValue(toName);
    }
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function nowStr() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
}

function getSheetData(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      var val = row[i];
      if (val instanceof Date) val = Utilities.formatDate(val, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
      obj[h] = val;
    });
    return obj;
  });
}

function getOrCreate(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * DESTRUCTIVE: drops 4 sheets and rebuilds from old structure.
 * Có guard tránh chạy nhầm — phải xác nhận qua dialog.
 */
function migrateData() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert('⚠️ Migrate sẽ XÓA 4 sheet data.new.* hiện tại và build lại từ sheet đầu tiên. Tiếp tục?', ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) { ui.alert('Đã hủy.'); return; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ['data.new.ThanhVien','data.new.TranDau','data.new.DongQuy','data.new.LichThiDau'].forEach(function(n) {
    var s = ss.getSheetByName(n);
    if (s) ss.deleteSheet(s);
  });
  var old = ss.getSheets()[0];
  var data = old.getDataRange().getValues();
  var ts = nowStr();

  var sheetTV = getOrCreate('data.new.ThanhVien', ['timestamp','name','role','number','size','status']);
  var sheetTD = getOrCreate('data.new.TranDau', ['timestamp','date','opponent','venue','result','cost','note']);
  var sheetDQ = getOrCreate('data.new.DongQuy', ['timestamp','period','member','amount','note']);
  var sheetFX = getOrCreate('data.new.LichThiDau', ['timestamp','date','opponent','venue','kitColor','status','note']);
  var pn = ['Đợt 1','Đợt 2','Đợt 3','Đợt 4','Đợt 5','Đợt 6','Đợt 7','Quỹ T4/2026'];
  var mc = 0;
  for (var r = 3; r < 25 && r < data.length; r++) {
    var g = data[r][6];
    var h = data[r][7];
    if (typeof g !== 'number' || !h) continue;
    var rawName = String(h).trim();
    if (!rawName || rawName.length < 2) continue;

    var role = 'Đi làm';
    var name = rawName;
    if (rawName.toLowerCase().indexOf('s.viên') >= 0 || rawName.toLowerCase().indexOf('sinh viên') >= 0) {
      role = 'Sinh viên';
      name = rawName.replace(/\(s\.viên\)/i, '').replace(/s\.viên/i, '').replace(/sinh viên/i, '').trim();
    }

    var num = data[r][8] || 0;
    var sz = String(data[r][9] || 'M');
    if (['S','M','L','XL'].indexOf(sz) < 0) sz = 'M';
    var st = 'active';
    for (var c = 10; c <= 17; c++) {
      var v = data[r][c];
      if (typeof v === 'string' && v.length > 3 && v.toLowerCase().indexOf('ngh') >= 0) st = 'paused';
    }
    sheetTV.appendRow([ts, name, role, num, sz, st]);
    mc++;
    for (var p = 0; p < 8; p++) {
      var val = data[r][10 + p];
      if (typeof val === 'number' && val > 0) sheetDQ.appendRow([ts, pn[p], name, val, '']);
    }
  }
  var tc = 0;
  for (var r = 3; r < data.length; r++) {
    var a = data[r][0];
    if (typeof a !== 'number') continue;
    var dateVal = data[r][1];
    var dateStr = '';
    if (dateVal instanceof Date) {
      dateStr = Utilities.formatDate(dateVal, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    } else if (dateVal) {
      try { var d = new Date(dateVal); if (!isNaN(d.getTime())) dateStr = Utilities.formatDate(d, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd'); } catch(e) {}
    }
    if (!dateStr) continue;
    var resultRaw = data[r][3] ? String(data[r][3]).trim() : '';
    var cost = 0;
    if (typeof data[r][4] === 'number') cost = data[r][4];
    else if (data[r][4]) cost = parseFloat(String(data[r][4]).replace(/[^\d]/g, '')) || 0;
    var resultClean = resultRaw;
    var rl = resultRaw.toLowerCase();

    if (rl.indexOf('đối thắng') >= 0 || rl.indexOf('doi thang') >= 0) resultClean = 'Thua';
    else if (rl.indexOf('đối thua') >= 0 || rl.indexOf('doi thua') >= 0) resultClean = 'Thắng';
    else if (rl.indexOf('thắng') >= 0 || rl.indexOf('thang') >= 0) resultClean = 'Thắng';
    else if (rl.indexOf('thua') >= 0) resultClean = 'Thua';
    else if (rl.indexOf('hòa') >= 0 || rl.indexOf('hoà') >= 0 || rl.indexOf('hoa') >= 0) resultClean = 'Hòa';
    var note = data[r][5] || '';
    if (note instanceof Date) note = '';
    sheetTD.appendRow([ts, dateStr, resultRaw, '', resultClean, cost, String(note)]);
    tc++;
  }

  var fc = 0;
  for (var r = 40; r < data.length; r++) {
    var stt = data[r][9];
    if (typeof stt === 'number' && stt > 0) {
      var d = String(data[r][10]||'').trim();
      var opp = String(data[r][11]||'').trim();
      var ven = String(data[r][12]||'').trim();
      var color = String(data[r][13]||'').trim();
      var res = String(data[r][14]||'').trim();
      var nte = String(data[r][15]||'').trim();

      if (opp && opp.length > 1) {
        var fixTs = Utilities.formatDate(new Date(new Date().getTime() - fc*1000), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
        var dStr = d;
        if (d.indexOf('/') > 0) {
           var parts = d.split('/');
           dStr = new Date().getFullYear() + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0');
        }
        var stat = res ? 'completed' : 'upcoming';
        sheetFX.appendRow([fixTs, dStr, opp, ven, color, stat, nte]);
        fc++;
      }
    }
  }

  for (var i = 1; i <= 7; i++) { sheetTV.autoResizeColumn(i); sheetTD.autoResizeColumn(i); sheetDQ.autoResizeColumn(i); sheetFX.autoResizeColumn(i); }
  ss.toast('Members: ' + mc + ', Matches: ' + tc + ', Fixtures: ' + fc, 'Migration Done', 10);
}
