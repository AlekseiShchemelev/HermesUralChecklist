// Google Apps Script для сменного чек-листа
// Разверните как веб-приложение с доступом "Все"

function doGet(e) {
  if (e?.parameter?.action === 'get') {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = sheet.getDataRange().getValues();
    const rows = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = {};
      for (let j = 0; j < data[0].length; j++) {
        row[data[0][j]] = data[i][j];
      }
      row.id = String(data[i][0]);
      rows.push(row);
    }
    
    const callback = e.parameter.callback;
    const response = JSON.stringify({result: 'success', data: rows});
    
    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + response + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    
    return ContentService
      .createTextOutput(response)
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    if (data.__delete_id) {
      return deleteRecord(data.__delete_id);
    }
    
    if (data.__update_id) {
      return updateRecord(data.__update_id, data);
    }
    
    return addRecord(data);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({result: 'error', message: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function addRecord(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // Генерируем ID по порядку (1, 2, 3...)
  let id;
  if (data.id) {
    id = String(data.id);
  } else {
    const sheetData = sheet.getDataRange().getValues();
    let maxId = 0;
    for (let i = 1; i < sheetData.length; i++) {
      const rowId = parseInt(sheetData[i][0]) || 0;
      if (rowId > maxId) maxId = rowId;
    }
    id = String(maxId + 1);
  }
  
  sheet.appendRow([
    id,
    data.date || '',
    data.shift || '',
    data.shop || '',
    data.master || '',
    Number(data.plasma_people) || 0,
    Number(data.strozka_people) || 0,
    Number(data.zachistka_people) || 0,
    Number(data.avtosvarka_people) || 0,
    Number(data.poloter_people) || 0,
    Number(data.press_old_people) || 0,
    Number(data.italy_people) || 0,
    Number(data.press_new_people) || 0,
    Number(data.otbortovka_people) || 0,
    Number(data.kromko_people) || 0,
    Number(data.kotelshchik_people) || 0,
    Number(data.ruchsvarka_people) || 0,
    Number(data.total_people) || 0,
    Number(data.plasma_sheets) || 0,
    Number(data.strozka_segments) || 0,
    Number(data.avtosvarka_cards) || 0,
    Number(data.poloter_cleaned) || 0,
    Number(data.zachistka_cleaned) || 0,
    Number(data.stamped_old) || 0,
    Number(data.stamped_italy) || 0,
    Number(data.stamped_new) || 0,
    Number(data.combined) || 0,
    Number(data.repair) || 0,
    Number(data.flanged) || 0,
    Number(data.trimmed) || 0,
    Number(data.packed) || 0,
    Number(data.film_packs) || 0,
    Number(data.unloaded) || 0,
    Number(data.loaded) || 0,
    Number(data.small_furnace) || 0,
    Number(data.large_furnace) || 0,
    data.breakdowns || '',
    new Date()
  ]);
  
  return ContentService
    .createTextOutput(JSON.stringify({result: 'success', id: id}))
    .setMimeType(ContentService.MimeType.JSON);
}

function updateRecord(id, data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const sheetData = sheet.getDataRange().getValues();
  
  for (let i = 1; i < sheetData.length; i++) {
    if (String(sheetData[i][0]) === String(id)) {
      const rowData = [
        id,
        data.date || sheetData[i][1],
        data.shift || sheetData[i][2],
        data.shop || sheetData[i][3],
        data.master || sheetData[i][4],
        Number(data.plasma_people) || 0,
        Number(data.strozka_people) || 0,
        Number(data.zachistka_people) || 0,
        Number(data.avtosvarka_people) || 0,
        Number(data.poloter_people) || 0,
        Number(data.press_old_people) || 0,
        Number(data.italy_people) || 0,
        Number(data.press_new_people) || 0,
        Number(data.otbortovka_people) || 0,
        Number(data.kromko_people) || 0,
        Number(data.kotelshchik_people) || 0,
        Number(data.ruchsvarka_people) || 0,
        Number(data.total_people) || 0,
        Number(data.plasma_sheets) || 0,
        Number(data.strozka_segments) || 0,
        Number(data.avtosvarka_cards) || 0,
        Number(data.poloter_cleaned) || 0,
        Number(data.zachistka_cleaned) || 0,
        Number(data.stamped_old) || 0,
        Number(data.stamped_italy) || 0,
        Number(data.stamped_new) || 0,
        Number(data.combined) || 0,
        Number(data.repair) || 0,
        Number(data.flanged) || 0,
        Number(data.trimmed) || 0,
        Number(data.packed) || 0,
        Number(data.film_packs) || 0,
        Number(data.unloaded) || 0,
        Number(data.loaded) || 0,
        Number(data.small_furnace) || 0,
        Number(data.large_furnace) || 0,
        data.breakdowns || '',
        new Date()
      ];
      
      sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      return ContentService
        .createTextOutput(JSON.stringify({result: 'success', message: 'Updated'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  return addRecord(data);
}

function deleteRecord(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return ContentService
        .createTextOutput(JSON.stringify({result: 'success'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({result: 'error', message: 'Not found'}))
    .setMimeType(ContentService.MimeType.JSON);
}
