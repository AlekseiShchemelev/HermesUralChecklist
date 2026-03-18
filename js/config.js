/**
 * Конфигурация приложения
 */
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
      { id: "plasma_people", label: "Плазма" },
      { id: "strozka_people", label: "Строжка" },
      { id: "zachistka_people", label: "Зачистка под сварку" },
      { id: "avtosvarka_people", label: "Авт. сварка" },
      { id: "poloter_people", label: "Полотер" },
      { id: "press_old_people", label: "Штамп 500т старый" },
      { id: "italy_people", label: "Итальянец" },
      { id: "press_new_people", label: "Штамп 500т новый" },
      { id: "otbortovka_people", label: "Отбортовка" },
      { id: "kromko_people", label: "Кромкообрезной станок" },
      { id: "kotelshchik_people", label: "Котельщик приемка" },
      { id: "ruchsvarka_people", label: "Ручная сварка" },
    ],
    production: [
      { id: "plasma_sheets", label: "Плазма: порезано листов" },
      { id: "strozka_segments", label: "Строжка: отстрогано сегментов" },
      { id: "avtosvarka_cards", label: "Авт. сварка: заварено карт" },
      { id: "poloter_cleaned", label: "Полотер: почищено карт" },
      { id: "zachistka_cleaned", label: "Зачистка под сварку: почищено карт" },
    ],
    ends: [
      { id: "stamped_old", label: "Отштамповано (пресс старый)" },
      { id: "stamped_italy", label: "Отштамповано (Итальянец)" },
      { id: "stamped_new", label: "Отштамповано (пресс новый)" },
      { id: "combined", label: "Комбированных днищ" },
      { id: "repair", label: "Ремонтных днищ" },
      { id: "flanged", label: "Отбортованных днищ" },
      { id: "trimmed", label: "Обрезанных днищ" },
      { id: "packed", label: "Упакованных днищ" },
      { id: "film_packs", label: "Пачек в плёнку" },
    ],
    logistics: [
      { id: "unloaded", label: "Разгруженных машин" },
      { id: "loaded", label: "Отгруженных машин" },
      { id: "small_furnace", label: "Садок малая печь" },
      { id: "large_furnace", label: "Садок большая печь" },
    ],
  },
};

export default CONFIG;
