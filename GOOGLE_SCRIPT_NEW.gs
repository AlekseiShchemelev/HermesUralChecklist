// МИНИМАЛЬНЫЙ рабочий скрипт - просто скопируйте всё

function doGet(e) {
  var callback = e && e.parameter && e.parameter.callback;
  var action = e && e.parameter && e.parameter.action;
  
  if (action !== 'get') {
    return makeOutput({result: 'ok', message: 'Use ?action=get&callback=xxx'}, callback);
  }
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    var data = sheet.getDataRange().getValues();
    
    var rows = [];
    var headers = data[0] || [];
    
    for (var i = 1; i < data.length; i++) {
      var row = {};
      for (var j = 0; j < headers.length; j++) {
        var key = headers[j];
        if (key === 'ID') key = 'id';
        else if (key === 'ДАТА') key = 'date';
        else if (key === 'СМЕНА') key = 'shift';
        else if (key === 'ЦЕХ') key = 'shop';
        else if (key === 'ФИО_МАСТЕРА') key = 'master';
        row[key] = data[i][j];
      }
      row.id = String(data[i][0] || i);
      rows.push(row);
    }
    
    return makeOutput({result: 'success', data: rows}, callback);
    
  } catch (err) {
    return makeOutput({result: 'error', message: String(err)}, callback);
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    
    if (data.__delete_id) {
      return deleteRow(data.__delete_id);
    }
    
    return saveRow(data);
    
  } catch (err) {
    return makeOutput({result: 'error', message: String(err)});
  }
}

function saveRow(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var values = sheet.getDataRange().getValues();
  
  // Ищем существующий ID или генерируем новый
  var id = data.id;
  var existingRow = -1;
  
  if (id) {
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(id)) {
        existingRow = i + 1;
        break;
      }
    }
  }
  
  if (existingRow > 0) {
    // Обновляем
    sheet.getRange(existingRow, 2, 1, 4).setValues([[
      data.date || '',
      data.shift || '',
      data.shop || '',
      data.master || ''
    ]]);
    return makeOutput({result: 'success', message: 'Updated', id: id});
  }
  
  // Добавляем новую строку
  var maxId = 0;
  for (var i = 1; i < values.length; i++) {
    var rowId = parseInt(values[i][0]) || 0;
    if (rowId > maxId) maxId = rowId;
  }
  var newId = maxId + 1;
  
  sheet.appendRow([
    newId,
    data.date || '',
    data.shift || '',
    data.shop || '',
    data.master || '',
    data.plasma_people || 0,
    data.strozka_people || 0,
    data.zachistka_people || 0,
    data.avtosvarka_people || 0,
    data.poloter_people || 0,
    data.press_old_people || 0,
    data.italy_people || 0,
    data.press_new_people || 0,
    data.otbortovka_people || 0,
    data.kromko_people || 0,
    data.kotelshchik_people || 0,
    data.ruchsvarka_people || 0,
    data.total_people || 0,
    data.plasma_sheets || 0,
    data.strozka_segments || 0,
    data.avtosvarka_cards || 0,
    data.poloter_cleaned || 0,
    data.zachistka_cleaned || 0,
    data.stamped_old || 0,
    data.stamped_italy || 0,
    data.stamped_new || 0,
    data.combined || 0,
    data.repair || 0,
    data.flanged || 0,
    data.trimmed || 0,
    data.packed || 0,
    data.film_packs || 0,
    data.unloaded || 0,
    data.loaded || 0,
    data.small_furnace || 0,
    data.large_furnace || 0,
    data.breakdowns || '',
    new Date()
  ]);
  
  return makeOutput({result: 'success', id: newId});
}

function deleteRow(id) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var values = sheet.getDataRange().getValues();
  
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return makeOutput({result: 'success', message: 'Deleted'});
    }
  }
  
  return makeOutput({result: 'error', message: 'Not found'});
}

function makeOutput(data, callback) {
  var json = JSON.stringify(data);
  
  if (callback && /^[a-zA-Z0-9_]+$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
