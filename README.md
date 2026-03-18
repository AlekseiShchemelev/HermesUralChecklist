# Сменный чек-лист - Производственная версия

## Описание

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

## Файлы проекта

```
├── index.html          # Главная страница
├── manifest.json       # PWA манифест
├── sw.js              # Service Worker (кэширование)
├── css/
│   └── main.css       # Стили
├── js/
│   ├── config.js      # Конфигурация (URL Google Script)
│   ├── app.js         # Главный модуль приложения
│   ├── ui.js          # UI компоненты
│   ├── data.js        # Работа с данными + Worker
│   ├── storage.js     # Google Sheets API + CORS
│   └── cache.js       # IndexedDB кэширование
└── GOOGLE_SCRIPT.js   # Код для Google Apps Script
```

## Быстрый старт

### 1. Настройка Google Apps Script

1. Перейдите на https://script.google.com
2. Создайте новый проект
3. Удалите весь код по умолчанию
4. Вставьте код из `GOOGLE_SCRIPT.js`
5. Сохраните (Ctrl+S)
6. Разверните: Deploy → New deployment
   - Type: Web app
   - Execute as: Me
   - Who has access: Anyone
7. Скопируйте URL

### 2. Настройка фронтенда

1. Откройте `js/config.js`
2. Замените `appsScriptUrl` на скопированный URL:
   ```javascript
   appsScriptUrl: "https://script.google.com/macros/s/YOUR_ID/exec"
   ```

### 3. Развёртывание на GitHub Pages

1. Создайте репозиторий на GitHub
2. Загрузите все файлы (кроме `GOOGLE_SCRIPT.js`)
3. Settings → Pages → Source: Deploy from a branch
4. Branch: main, folder: / (root)
5. Дождитесь публикации (2-5 минут)

### 4. Проверка

- Откройте сайт
- Попробуйте добавить запись
- Проверьте, что данные появились в Google Sheets

## Особенности

### CORS
Приложение использует CORS для прямых запросов к Google Script. Если CORS не работает (старый браузер или ограничения), автоматически используется fallback:
- Для GET: JSONP
- Для POST: no-cors mode

### Кэширование
- **Service Worker**: кэширует статику (CSS, JS)
- **IndexedDB**: кэширует данные из Google Sheets (5 минут)
- **localStorage**: резервный кэш данных

### PWA
Приложение можно установить на телефон/планшет:
- iOS: Share → Add to Home Screen
- Android: Menu → Add to Home Screen

### Оптимизации
- Debounce при вводе (50ms)
- Throttle для resize/orientation (100ms)
- Web Worker для фильтрации (>1000 записей)
- Downsampling для графиков (>50 точек)
- Lazy loading для графиков (Intersection Observer)

## Обновление приложения

### При изменении кода
1. Обновите файлы в репозитории
2. Увеличьте `VERSION` в `sw.js` (иначе кэш не обновится)
3. Подождите 5-10 минут для обновления CDN

### При изменении структуры таблицы
1. Обновите `COLUMN_MAP` в `GOOGLE_SCRIPT.js`
2. Переразверните Google Script
3. Увеличьте `VERSION` в `sw.js`

## Устранение неполадок

### Данные не загружаются
- Проверьте URL в `config.js`
- Откройте DevTools → Network, проверьте ошибки CORS
- Проверьте, что Google Script развёрнут с доступом "Anyone"

### Не работает сохранение
- Проверьте CORS headers в Google Script
- Проверьте консоль на ошибки
- Попробуйте в режиме инкогнито

### Старый кэш не обновляется
- Увеличьте `VERSION` в `sw.js`
- Или удалите кэш в DevTools → Application → Clear storage

## Безопасность

- Все пользовательские данные экранируются (XSS защита)
- Нет eval() или других опасных функций
- CSP заголовки рекомендуется добавить на сервере (GitHub Pages добавляет автоматически)

## Производительность

| Операция | Время |
|----------|-------|
| Первая загрузка | ~2 сек |
| Повторная загрузка (кэш) | ~0.5 сек |
| Рендер 100 записей | ~50 мс |
| Отправка данных | ~1-3 сек |

## Поддержка браузеров

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

Минимальные требования: ES6 modules, Fetch API, Promises.

## Лицензия

MIT License
