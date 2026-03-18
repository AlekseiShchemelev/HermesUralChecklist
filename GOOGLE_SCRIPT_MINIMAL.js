// МИНИМАЛЬНЫЙ рабочий Google Script
// Просто скопируйте этот код полностью

function doGet(e) {
  try {
    const callback = e?.parameter?.callback;
    const action = e?.parameter?.action;
    
    if (action !== 'get') {
      const response = {result: 'error', message: 'Use ?action=get'};
      return output(response, callback);
    }
    
    // Получаем данные из таблицы
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    const data = sheet.getDataRange().getValues();
    
    const rows = [];
    const headers = data[0] || [];
    
    for (let i = 1; i < data.length; i++) {
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = data[i][j];
      }
      row.id = String(data[i][0] || i);
      rows.push(row);
    }
    
    return output({result: 'success', data: rows}, callback);
    
  } catch (error) {
    return output({result: 'error', message: error.toString()}, e?.parameter?.callback);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    if (data.__delete_id) {
      return deleteRow(data.__delete_id);
    }
    
    if (data.id && !data.__new) {
      return updateRow(data.id, data);
    }
    
    return addRow(data);
    
  } catch (error) {
    return output({result: 'error', message: error.toString()});
  }
}

function addRow(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const values = sheet.getDataRange().getValues();
  
  // Генерируем ID
  let maxId = 0;
  for (let i = 1; i < values.length; i++) {
    const id = parseInt(values[i][0]) || 0;
    if (id > maxId) maxId = id;
  }
  const newId = maxId + 1;
  
  // Добавляем строку
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
  
  return output({result: 'success', id: newId});
}

function updateRow(id, data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const values = sheet.getDataRange().getValues();
  
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      // Обновляем существующую строку
      const rowNum = i + 1;
      sheet.getRange(rowNum, 2).setValue(data.date || values[i][1]);
      sheet.getRange(rowNum, 3).setValue(data.shift || values[i][2]);
      sheet.getRange(rowNum, 4).setValue(data.shop || values[i][3]);
      sheet.getRange(rowNum, 5).setValue(data.master || values[i][4]);
      return output({result: 'success', message: 'Updated'});
    }
  }
  
  return addRow(data);
}

function deleteRow(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const values = sheet.getDataRange().getValues();
  
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return output({result: 'success', message: 'Deleted'});
    }
  }
  
  return output({result: 'error', message: 'Not found'});
}

// Вспомогательная функция для вывода (JSON или JSONP)
function output(data, callback) {
  const json = JSON.stringify(data);
  
  if (callback && /^[a-zA-Z0-9_]+$/.test(callback)) {
    // JSONP
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  
  // Обычный JSON
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
