/**
 * Конфигурация приложения
 */
'use strict';

const CONFIG = {
  // URL Google Apps Script для отправки/получения данных
  // ВАЖНО: Замените на ваш URL при развёртывании
  appsScriptUrl:
    "https://script.google.com/macros/s/AKfycbwK7OIqM7-NXaaEHi7TjPRX77UlEZfmGdtF3hG4omttQqWSxMcrHX8Oku9S1Ucg2sf8OQ/exec",

  // Валидация URL (базовая проверка)
  get isValidUrl() {
    return (
      this.appsScriptUrl &&
      this.appsScriptUrl.startsWith("https://script.google.com/macros/s/")
    );
  },

  // Настройки приложения
  appName: "Сменный чек-лист",
  version: "2.0",

  // Секции данных


  sections: {
    people: [
      { id: "plasma_people", label: "Плазма", russianKey: "ПЛАЗМА_ЧЕЛ" },
      { id: "strozka_people", label: "Строжка", russianKey: "СТРОЖКА_ЧЕЛ" },
      { id: "zachistka_people", label: "Зачистка под сварку", russianKey: "ЗАЧИСТКА_ПОД_СВАРКУ_ЧЕЛ" },
      { id: "avtosvarka_people", label: "Авт. сварка", russianKey: "АВТ_СВАРКА_ЧЕЛ" },
      { id: "poloter_people", label: "Полотер", russianKey: "ПОЛОТЕР_ЧЕЛ" },
      { id: "press_old_people", label: "Штамп 500т старый", russianKey: "ШТАМП_500Т_СТАРЫЙ_ЧЕЛ" },
      { id: "italy_people", label: "Итальянец", russianKey: "ИТАЛЬЯНЕЦ_ЧЕЛ" },
      { id: "press_new_people", label: "Штамп 500т новый", russianKey: "ШТАМП_500Т_НОВЫЙ_ЧЕЛ" },
      { id: "otbortovka_people", label: "Отбортовка", russianKey: "ОТБОРТОВКА_ЧЕЛ" },
      { id: "kromko_people", label: "Кромкообрезной станок", russianKey: "КРОМКООБРЕЗНОЙ_СТАНОК_ЧЕЛ" },
      { id: "kotelshchik_people", label: "Котельщик приемка", russianKey: "КОТЕЛЬЩИК_ПРИЕМКА_ЧЕЛ" },
      { id: "ruchsvarka_people", label: "Ручная сварка", russianKey: "РУЧНАЯ_СВАРКА_ЧЕЛ" },
    ],
    production: [
      { id: "plasma_sheets", label: "Плазма: порезано листов", russianKey: "ПЛАЗМА_ЛИСТЫ" },
      { id: "strozka_segments", label: "Строжка: отстрогано сегментов", russianKey: "СТРОЖКА_ОТСТРОГАНО_СЕГМЕНТОВ" },
      { id: "avtosvarka_cards", label: "Авт. сварка: заварено карт", russianKey: "АВТ_СВАРКА_ЗАВАРЕНО_КАРТ" },
      { id: "poloter_cleaned", label: "Полотер: почищено карт", russianKey: "ПОЛОТЕР_ПОЧИЩЕНО_КАРТ" },
      { id: "zachistka_cleaned", label: "Зачистка под сварку: почищено карт", russianKey: "ЗАЧИСТКА_ПОД_СВАРКУ_ПОЧИЩЕНО_КАРТ" },
    ],
    ends: [
      { id: "stamped_old", label: "Отштамповано (пресс старый)", russianKey: "ОТШТАМПОВАНО_ПРЕСС_СТАРЫЙ" },
      { id: "stamped_italy", label: "Отштамповано (Итальянец)", russianKey: "ОТШТАМПОВАНО_ИТАЛЬЯНЕЦ" },
      { id: "stamped_new", label: "Отштамповано (пресс новый)", russianKey: "ОТШТАМПОВАНО_ПРЕСС_НОВЫЙ" },
      { id: "combined", label: "Колиброванных днищ", russianKey: "КОЛИБРОВАННЫХ_ДНИЩ" },
      { id: "repair", label: "Ремонтных днищ", russianKey: "РЕМОНТНЫХ_ДНИЩ" },
      { id: "flanged", label: "Отбортованных днищ", russianKey: "ОТБОРТОВАННЫХ_ДНИЩ" },
      { id: "trimmed", label: "Обрезанных днищ", russianKey: "ОБРЕЗАННЫХ_ДНИЩ" },
      { id: "packed", label: "Упакованных днищ", russianKey: "УПАКОВАННЫХ_ДНИЩ" },
      { id: "film_packs", label: "Пачек в плёнку", russianKey: "ПАЧЕК_В_ПЛЕНКУ" },
    ],
    logistics: [
      { id: "unloaded", label: "Разгруженных машин", russianKey: "РАЗГРУЖЕННЫХ_МАШИН" },
      { id: "loaded", label: "Отгруженных машин", russianKey: "ОТГРУЖЕННЫХ_МАШИН" },
      { id: "small_furnace", label: "Садок малая печь", russianKey: "САДОК_МАЛАЯ_ПЕЧЬ" },
      { id: "large_furnace", label: "Садок большая печь", russianKey: "САДОК_БОЛЬШАЯ_ПЕЧЬ" },
    ],
  },
};

export default CONFIG;
