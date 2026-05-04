function doGet(e) {
  var key = e.parameter.key;
  if (key !== 'fc_manager_secret_2026') return ContentService.createTextOutput(JSON.stringify({error: 'Unauthorized'})).setMimeType(ContentService.MimeType.JSON);
  
  var action = e.parameter.action;
  if (action === 'getAll') {
    return ContentService.createTextOutput(JSON.stringify({
      members: getSheetData('data.new.ThanhVien'),
      matches: getSheetData('data.new.TranDau'),
      fundPayments: getSheetData('data.new.DongQuy'),
      fixtures: getSheetData('data.new.LichThiDau')
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'read') {
    var sheet = e.parameter.sheet;
    if (!sheet) return ContentService.createTextOutput(JSON.stringify({error: 'Missing sheet'})).setMimeType(ContentService.MimeType.JSON);
    return ContentService.createTextOutput(JSON.stringify(getSheetData(sheet))).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({error: 'Invalid action'})).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch(err) {}
  
  if (body.key !== 'fc_manager_secret_2026') return ContentService.createTextOutput(JSON.stringify({error: 'Unauthorized'})).setMimeType(ContentService.MimeType.JSON);
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(body.sheet);
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({error: 'Sheet not found'})).setMimeType(ContentService.MimeType.JSON);
  
  var ts = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
  
  if (body.action === 'create') {
    var row = body.data;
    if (row[0] === 'AUTO_TS') row[0] = ts;
    sheet.appendRow(row);
    return ContentService.createTextOutput(JSON.stringify({status: 'ok', timestamp: ts})).setMimeType(ContentService.MimeType.JSON);
  }
  
  if (body.action === 'update' || body.action === 'delete') {
    var matchColumn = body.matchColumn || 1; // 1-indexed column to search
    var matchValue = String(body.matchValue).trim();
    var data = sheet.getDataRange().getValues();
    var found = false;
    for (var i = 1; i < data.length; i++) {
      var cellVal = data[i][matchColumn-1];
      if (cellVal instanceof Date) cellVal = Utilities.formatDate(cellVal, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
      if (String(cellVal).trim() === matchValue) {
        if (body.action === 'delete') {
          sheet.deleteRow(i+1);
        } else if (body.action === 'update') {
          var updateData = body.data;
          for (var c = 0; c < updateData.length; c++) {
            if (updateData[c] !== undefined && updateData[c] !== null) {
              var val = updateData[c];
              if (val === 'AUTO_TS') val = ts;
              sheet.getRange(i+1, c+1).setValue(val);
            }
          }
        }
        found = true;
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({status: found ? 'ok' : 'not_found'})).setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({error: 'Invalid action'})).setMimeType(ContentService.MimeType.JSON);
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

function migrateData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ['data.new.ThanhVien','data.new.TranDau','data.new.DongQuy','data.new.LichThiDau'].forEach(function(n) {
    var s = ss.getSheetByName(n);
    if (s) ss.deleteSheet(s);
  });
  var old = ss.getSheets()[0];
  var data = old.getDataRange().getValues();
  var ts = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
  
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
