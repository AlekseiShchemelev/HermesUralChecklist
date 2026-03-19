function makeJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function makeJSONP(data, callback) {
  if (!callback || !/^[a-zA-Z0-9_]+$/.test(callback)) return makeJSON(data);
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(data) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function authenticateUser(fio, password, callback) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName('Пользователи');
    if (!userSheet) {
      return makeJSONP({result: 'error', message: 'Список пользователей не найден'}, callback);
    }
    
    const data = userSheet.getDataRange().getValues();
    const headers = data[0];
    const fioIndex = headers.indexOf('ФИО');
    const passIndex = headers.indexOf('ПАРОЛЬ');
    const roleIndex = headers.indexOf('РОЛЬ');
    
    if (fioIndex === -1 || passIndex === -1) {
      return makeJSONP({result: 'error', message: 'Неверная структура таблицы'}, callback);
    }
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][fioIndex] === fio && String(data[i][passIndex]) === String(password)) {
        const user = {fio: data[i][fioIndex], role: roleIndex !== -1 ? data[i][roleIndex] : 'user'};
        return makeJSONP({result: 'success', user: user}, callback);
      }
    }
    
    return makeJSONP({result: 'error', message: 'Неверный логин или пароль'}, callback);
  } catch (error) {
    return makeJSONP({result: 'error', message: error.toString()}, callback);
  }
}

function doGet(e) {
  try {
    // DEBUG: полный объект e
    console.log('Full e:', JSON.stringify(e));
    console.log('e.parameter:', JSON.stringify(e?.parameter));
    console.log('e.queryString:', JSON.stringify(e?.queryString));
    
    // Пробуем получить параметры из queryString если parameter не работает
    let params = e?.parameter;
    if (!params && e?.queryString) {
      params = {};
      const pairs = e.queryString.split('&');
      for (const pair of pairs) {
        const [key, value] = pair.split('=');
        params[key] = decodeURIComponent(value || '');
      }
    }
    
    console.log('Final params:', JSON.stringify(params));
    
    if (!params) return makeJSON({result: 'error', message: 'No parameters'});
    
    const action = params.action;
    const callback = params.callback;
    
    if (action === 'auth') {
      return authenticateUser(e.parameter.fio, e.parameter.password, callback);
    }
    
    if (action === 'get') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getActiveSheet();
      const data = sheet.getDataRange().getValues();
      const rows = [];
      
      for (let i = 1; i < data.length; i++) {
        const row = {id: String(data[i][0])};
        for (let j = 1; j < data[0].length; j++) {
          row[data[0][j]] = data[i][j];
        }
        rows.push(row);
      }
      return makeJSONP({result: 'success', data: rows}, callback);
    }
    
    return makeJSONP({result: 'error', message: 'Unknown action'}, callback);
  } catch (error) {
    return makeJSONP({result: 'error', message: error.toString()}, e?.parameter?.callback);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    
    if (data.__delete_id) {
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(data.__delete_id)) {
          sheet.deleteRow(i + 1);
          return makeJSON({result: 'success'});
        }
      }
      return makeJSON({result: 'error', message: 'Not found'});
    }
    
    if (data.id) {
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(data.id)) {
          sheet.getRange(i + 1, 2, 1, 4).setValues([[data.date, data.shift, data.shop, data.master]]);
          return makeJSON({result: 'success'});
        }
      }
    }
    
    const values = sheet.getDataRange().getValues();
    let maxId = 0;
    for (let i = 1; i < values.length; i++) {
      const id = parseInt(values[i][0]) || 0;
      if (id > maxId) maxId = id;
    }
    const newId = maxId + 1;
    
    sheet.appendRow([
      newId, data.date, data.shift, data.shop, data.master,
      data.plasma_people || 0, data.strozka_people || 0, data.zachistka_people || 0,
      data.avtosvarka_people || 0, data.poloter_people || 0, data.press_old_people || 0,
      data.italy_people || 0, data.press_new_people || 0, data.otbortovka_people || 0,
      data.kromko_people || 0, data.kotelshchik_people || 0, data.ruchsvarka_people || 0,
      data.total_people || 0, data.plasma_sheets || 0, data.strozka_segments || 0,
      data.avtosvarka_cards || 0, data.poloter_cleaned || 0, data.zachistka_cleaned || 0,
      data.stamped_old || 0, data.stamped_italy || 0, data.stamped_new || 0,
      data.combined || 0, data.repair || 0, data.flanged || 0, data.trimmed || 0,
      data.packed || 0, data.film_packs || 0, data.unloaded || 0, data.loaded || 0,
      data.small_furnace || 0, data.large_furnace || 0, data.breakdowns || '', new Date()
    ]);
    
    return makeJSON({result: 'success', id: newId});
  } catch (error) {
    return makeJSON({result: 'error', message: error.toString()});
  }
}
