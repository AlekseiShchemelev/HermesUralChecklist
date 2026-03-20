const COLUMN_MAP = {
  ID: "id",
  ДАТА: "date",
  СМЕНА: "shift",
  ДЕНЬ_НОЧЬ: "shift_type",
  ЦЕХ: "shop",
  ФИО_МАСТЕРА: "master",
  ПЛАЗМА_ЧЕЛ: "plasma_people",
  СТРОЖКА_ЧЕЛ: "strozka_people",
  ЗАЧИСТКА_ПОД_СВАРКУ_ЧЕЛ: "zachistka_people",
  АВТ_СВАРКА_ЧЕЛ: "avtosvarka_people",
  ПОЛОТЕР_ЧЕЛ: "poloter_people",
  ШТАМП_500Т_СТАРЫЙ_ЧЕЛ: "press_old_people",
  ИТАЛЬЯНЕЦ_ЧЕЛ: "italy_people",
  ШТАМП_500Т_НОВЫЙ_ЧЕЛ: "press_new_people",
  ОТБОРТОВКА_ЧЕЛ: "otbortovka_people",
  КРОМКООБРЕЗНОЙ_СТАНОК_ЧЕЛ: "kromko_people",
  КОТЕЛЬЩИК_ПРИЕМКА_ЧЕЛ: "kotelshchik_people",
  РУЧНАЯ_СВАРКА_ЧЕЛ: "ruchsvarka_people",
  ВСЕГО_ЧЕЛ: "total_people",
  ПЛАЗМА_ЛИСТЫ: "plasma_sheets",
  СТРОЖКА_ОТСТРОГАНО_СЕГМЕНТОВ: "strozka_segments",
  АВТ_СВАРКА_ЗАВАРЕНО_КАРТ: "avtosvarka_cards",
  ПОЛОТЕР_ПОЧИЩЕНО_КАРТ: "poloter_cleaned",
  ЗАЧИСТКА_ПОД_СВАРКУ_ПОЧИЩЕНО_КАРТ: "zachistka_cleaned",
  ОТШТАМПОВАНО_ПРЕСС_СТАРЫЙ: "stamped_old",
  ОТШТАМПОВАНО_ИТАЛЬЯНЕЦ: "stamped_italy",
  ОТШТАМПОВАНО_ПРЕСС_НОВЫЙ: "stamped_new",
  КАЛИБРОВАННЫХ_ДНИЩ: "combined",
  РЕМОНТНЫХ_ДНИЩ: "repair",
  ОТБОРТОВАННЫХ_ДНИЩ: "flanged",
  ОБРЕЗАННЫХ_ДНИЩ: "trimmed",
  УПАКОВАННЫХ_ДНИЩ: "packed",
  ПАЧЕК_В_ПЛЕНКУ: "film_packs",
  РАЗГРУЖЕННЫХ_МАШИН: "unloaded",
  ОТГРУЖЕННЫХ_МАШИН: "loaded",
  САДОК_МАЛАЯ_ПЕЧЬ: "small_furnace",
  САДОК_БОЛЬШАЯ_ПЕЧЬ: "large_furnace",
  ПОЛОМКИ_И_ПРОСТОИ: "breakdowns",
  TIMESTAMP: "timestamp",
};

/**
 * Проверяет и исправляет заголовки таблицы
 */
function ensureHeaders(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Если первая колонка пустая - добавляем ID
  if (!headers[0] || headers[0].toString().trim() === "") {
    sheet.getRange(1, 1).setValue("ID");
  }

  // Проверяем наличие колонки ДЕНЬ_НОЧЬ (после СМЕНА)
  const shiftIndex = headers.indexOf("СМЕНА");
  if (shiftIndex !== -1) {
    const dayNightIndex = shiftIndex + 1;
    if (headers[dayNightIndex] !== "ДЕНЬ_НОЧЬ") {
      // Вставляем колонку ДЕНЬ_НОЧЬ
      sheet.insertColumnAfter(shiftIndex + 1);
      sheet.getRange(1, dayNightIndex + 1).setValue("ДЕНЬ_НОЧЬ");
    }
  }
}

function doGet(e) {
  try {
    const params = e?.parameter || {};
    const action = params.action;
    const callback = params.callback;

    if (action === "auth") {
      return authenticateUser(params.fio, params.password, callback);
    }

    if (action === "get") {
      return getData(callback);
    }

    if (action === "getBreakdowns") {
      const result = getBreakdowns();
      if (callback) {
        return makeJSONP(JSON.parse(result.getContent()), callback);
      }
      return result;
    }

    if (action === "getSectors") {
      const result = getSectors();
      if (callback) {
        return makeJSONP(JSON.parse(result.getContent()), callback);
      }
      return result;
    }

    if (action === "getEquipment") {
      const result = getEquipment();
      if (callback) {
        return makeJSONP(JSON.parse(result.getContent()), callback);
      }
      return result;
    }

    // GET запросы для изменения данных (для JSONP)
    if (action === "updateBreakdown") {
      try {
        const data = {
          id: params.id,
          sector: decodeURIComponent(params.sector || ""),
          equipment: decodeURIComponent(params.equipment || ""),
          dateFrom: params.dateFrom,
          dateTo: params.dateTo || "",
          downtime: parseFloat(params.downtime) || 0,
          reason: decodeURIComponent(params.reason || "")
        };
        const result = updateBreakdown(data);
        // Если callback есть - оборачиваем в JSONP
        if (callback) {
          const json = result.getContent();
          return ContentService.createTextOutput(`${callback}(${json});`).setMimeType(
            ContentService.MimeType.JAVASCRIPT,
          );
        }
        return result;
      } catch (err) {
        return makeJSONP({ result: "error", message: err.toString() }, callback);
      }
    }

    return makeJSONP({ result: "error", message: "Unknown action" }, callback);
  } catch (error) {
    return makeJSONP({ result: "error", message: error.toString() }, "");
  }
}

function authenticateUser(fio, password, callback) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName("Пользователи");

    if (!userSheet) {
      return makeJSONP(
        { result: "error", message: 'Лист "Пользователи" не найден' },
        callback,
      );
    }

    const data = userSheet.getDataRange().getValues();
    const headers = data[0];
    const fioIndex = headers.indexOf("ФИО");
    const passIndex = headers.indexOf("ПАРОЛЬ");
    const roleIndex = headers.indexOf("РОЛЬ");

    if (fioIndex === -1 || passIndex === -1) {
      return makeJSONP(
        { result: "error", message: "Колонки ФИО или ПАРОЛЬ не найдены" },
        callback,
      );
    }

    for (let i = 1; i < data.length; i++) {
      if (
        data[i][fioIndex] === fio &&
        String(data[i][passIndex]) === String(password)
      ) {
        const user = {
          fio: data[i][fioIndex],
          role: roleIndex !== -1 ? data[i][roleIndex] : "user",
        };
        return makeJSONP({ result: "success", user }, callback);
      }
    }

    return makeJSONP(
      { result: "error", message: "Неверный логин или пароль" },
      callback,
    );
  } catch (error) {
    return makeJSONP({ result: "error", message: error.toString() }, callback);
  }
}

function getData(callback) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();

    // Проверяем и исправляем заголовки
    ensureHeaders(sheet);

    const data = sheet.getDataRange().getValues();
    const rows = [];
    const headers = data[0];

    // Логируем заголовки для отладки
    console.log("Sheet headers:", headers.join(", "));

    for (let i = 1; i < data.length; i++) {
      const row = { id: String(data[i][0]) };
      for (let j = 1; j < headers.length; j++) {
        row[headers[j]] = data[i][j];
      }
      rows.push(row);
    }

    return makeJSONP({ result: "success", data: rows }, callback);
  } catch (error) {
    return makeJSONP({ result: "error", message: error.toString() }, callback);
  }
}

function makeJSONP(data, callback) {
  const json = JSON.stringify(data);
  if (!callback || !/^[a-zA-Z0-9_]+$/.test(callback)) {
    return ContentService.createTextOutput(json).setMimeType(
      ContentService.MimeType.JSON,
    );
  }
  return ContentService.createTextOutput(`${callback}(${json});`).setMimeType(
    ContentService.MimeType.JAVASCRIPT,
  );
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Обработка действий для поломок
    if (data.action === "addBreakdown") {
      return addBreakdown(data);
    }
    if (data.action === "deleteBreakdown") {
      return deleteBreakdown(data.id);
    }
    if (data.action === "updateBreakdown") {
      return updateBreakdown(data);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();

    // Проверяем и исправляем заголовки
    ensureHeaders(sheet);

    if (data.__delete_id) {
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(data.__delete_id)) {
          sheet.deleteRow(i + 1);
          return makeJSON({ result: "success" });
        }
      }
      return makeJSON({ result: "error", message: "Not found" });
    }

    if (data.id) {
      const values = sheet.getDataRange().getValues();
      const headers = values[0];

      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(data.id)) {
          const rowNum = i + 1;
          // Обновляем все поля по порядку колонок
          const updates = [
            data.date,
            data.shift,
            data.shift_type || "",
            data.shop,
            data.master,
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
            data.breakdowns || "",
            new Date(),
          ];
          sheet.getRange(rowNum, 2, 1, updates.length).setValues([updates]);
          return makeJSON({ result: "success" });
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
      newId,
      data.date,
      data.shift,
      data.shift_type || "",
      data.shop,
      data.master,
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
      data.breakdowns || "",
      new Date(),
    ]);

    return makeJSON({ result: "success", id: newId });
  } catch (error) {
    return makeJSON({ result: "error", message: error.toString() });
  }
}

function makeJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/**
 * ==================== РАБОТА С ПОЛОМКАМИ ====================
 */

/**
 * Добавляет запись о поломке
 */
function addBreakdown(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Поломки");

    // Создаём лист если не существует
    if (!sheet) {
      sheet = ss.insertSheet("Поломки");
      sheet.appendRow([
        "ID",
        "Участок",
        "Оборудование",
        "Дата_выхода_из_строя",
        "Дата_устранения",
        "Время_простоя_часов",
        "Причина",
        "TIMESTAMP",
      ]);
    }

    // Генерируем ID
    const lastId =
      sheet.getLastRow() > 1
        ? Math.max(
            ...sheet
              .getRange(2, 1, sheet.getLastRow() - 1, 1)
              .getValues()
              .flat(),
          )
        : 0;
    const newId = lastId + 1;

    sheet.appendRow([
      newId,
      data.sector,
      data.equipment,
      data.dateFrom,
      data.dateTo || "",
      parseFloat(data.downtime),
      data.reason,
      new Date(),
    ]);

    return makeJSON({ result: "success", id: newId });
  } catch (error) {
    return makeJSON({ result: "error", message: error.toString() });
  }
}

/**
 * Получает список поломок
 */
function getBreakdowns() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Поломки");

    if (!sheet || sheet.getLastRow() < 2) {
      return makeJSON({ breakdowns: [] });
    }

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    const breakdowns = data.map((row) => ({
      id: row[0],
      sector: row[1],
      equipment: row[2],
      dateFrom: formatDate(row[3]),
      dateTo: formatDate(row[4]),
      downtime: row[5],
      reason: row[6],
    }));

    return makeJSON({ breakdowns: breakdowns.reverse() }); // Сначала новые
  } catch (error) {
    return makeJSON({
      result: "error",
      message: error.toString(),
      breakdowns: [],
    });
  }
}

/**
 * Удаляет запись о поломке
 */
function deleteBreakdown(id) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Поломки");

    if (!sheet) return makeJSON({ result: "error", message: "Лист не найден" });

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] == id) {
        sheet.deleteRow(i + 2);
        return makeJSON({ result: "success" });
      }
    }

    return makeJSON({ result: "error", message: "Запись не найдена" });
  } catch (error) {
    return makeJSON({ result: "error", message: error.toString() });
  }
}

/**
 * Обновляет запись о поломке
 */
function updateBreakdown(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Поломки");

    if (!sheet) return makeJSON({ result: "error", message: "Лист не найден" });

    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] == data.id) {
        const rowNum = i + 2;
        sheet
          .getRange(rowNum, 2, 1, 7)
          .setValues([
            [
              data.sector,
              data.equipment,
              data.dateFrom,
              data.dateTo || "",
              parseFloat(data.downtime),
              data.reason,
              new Date(),
            ],
          ]);
        return makeJSON({ result: "success" });
      }
    }

    return makeJSON({ result: "error", message: "Запись не найдена" });
  } catch (error) {
    return makeJSON({ result: "error", message: error.toString() });
  }
}

/**
 * Получает список участков
 */
function getSectors() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Участки");

    if (!sheet || sheet.getLastRow() < 2) {
      return makeJSON({ sectors: [] });
    }

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    const sectors = data.map((row) => ({
      id: row[0],
      name: row[1],
    }));

    return makeJSON({ sectors: sectors });
  } catch (error) {
    return makeJSON({
      result: "error",
      message: error.toString(),
      sectors: [],
    });
  }
}

/**
 * Получает список оборудования
 */
function getEquipment() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Оборудование");

    if (!sheet || sheet.getLastRow() < 2) {
      return makeJSON({ equipment: [] });
    }

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    const equipment = data.map((row) => ({
      id: row[0],
      sector_id: row[1],
      name: row[2],
    }));

    return makeJSON({ equipment: equipment });
  } catch (error) {
    return makeJSON({
      result: "error",
      message: error.toString(),
      equipment: [],
    });
  }
}

/**
 * Форматирует дату
 */
function formatDate(date) {
  if (!date) return "";
  if (typeof date === "string") return date;
  return Utilities.formatDate(
    new Date(date),
    Session.getScriptTimeZone(),
    "dd.MM.yyyy HH:mm",
  );
}
