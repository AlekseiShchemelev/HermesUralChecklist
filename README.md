# Сменный чек-лист

Веб-приложение для учёта производственных показателей цеха. Работает с Google Sheets как бэкендом.

## Архитектура

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   GitHub    │     │     CDN      │     │   Google    │
│   Pages     │────→│  (Chart.js)  │     │   Script    │
│  (Frontend) │     │   (Fonts)    │────→│  (Backend)  │
└─────────────┘     └──────────────┘     └─────────────┘
       │                                            │
       └──────────────┬─────────────────────────────┘
                      │
               ┌─────────────┐
               │  Google     │
               │   Sheets    │
               └─────────────┘
```

## Структура проекта

```
├── index.html          # Главная страница
├── manifest.json       # PWA манифест
├── sw.js              # Service Worker
├── css/
│   └── main.css       # Стили
├── js/
│   ├── config.js      # Конфигурация
│   ├── app.js         # Главный модуль
│   ├── ui.js          # UI компоненты
│   ├── data.js        # Работа с данными
│   ├── storage.js     # Google Sheets API (JSONP)
│   └── cache.js       # IndexedDB кэш
├── GOOGLE_SCRIPT.js   # Код для Google Apps Script
├── test-script.html   # Диагностика подключения
└── README.md          # Документация
```

## Настройка

### 1. Google Apps Script

1. Перейдите на https://script.google.com
2. Создайте новый проект
3. Вставьте код из `GOOGLE_SCRIPT.js`
4. Сохраните (Ctrl+S)
5. Нажмите **Run** → выберите `doGet` для авторизации
6. **Deploy** → **New deployment** → **Web app**
   - Execute as: Me
   - Who has access: Anyone
7. Скопируйте URL

### 2. Конфигурация приложения

Откройте `js/config.js` и замените URL:

```javascript
appsScriptUrl: "ВАШ_URL_ИЗ_GOOGLE_SCRIPT"
```

### 3. Публикация

```bash
git add .
git commit -m "Initial release"
git push origin main
```

## Использование

- **Просмотр данных** — таблица с фильтрами и сортировкой
- **Добавление** — кнопка "Добавить запись"
- **Редактирование** — клик на строку в таблице
- **Удаление** — кнопка корзины в строке
- **Отчёты** — переключатель "Отчёты"

## Технологии

- Vanilla JavaScript (ES6+ modules)
- Google Apps Script (backend)
- Chart.js (графики)
- IndexedDB (кэширование)
- Service Worker (PWA)

## Лицензия

MIT
