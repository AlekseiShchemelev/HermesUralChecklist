# Отладка авторизации

## Проблема
Google Script возвращает старый ответ, хотя код обновлён.

## Решение - проверьте URL деплоя:

### Шаг 1: Проверьте актуальный URL
1. Откройте https://script.google.com
2. Нажмите **Deploy** → **Manage deployments**
3. Посмотрите **Web app URL**
4. Сравните с URL в `js/config.js`:
   ```javascript
   appsScriptUrl: "https://script.google.com/macros/s/AKfycbwK7OIqM7-NXaaEHi7TjPRX77UlEZfmGdtF3hG4omttQqWSxMcrHX8Oku9S1Ucg2sf8OQ/exec"
   ```

### Шаг 2: Если URL изменился
Обновите `js/config.js` с новым URL.

### Шаг 3: Проверка через браузер
Откройте в браузере (вставьте в адресную строку):
```
https://script.google.com/macros/s/AKfycbwK7OIqM7-NXaaEHi7TjPRX77UlEZfmGdtF3hG4omttQqWSxMcrHX8Oku9S1Ucg2sf8OQ/exec?action=auth&fio=admin&password=admin&callback=test
```

**Что должно вернуть:**
- Если работает: `test({"result":"error","message":"Неверный логин или пароль"})`
- Если не работает: `test({"result":"ok","message":"Use ?action=get&callback=xxx"})`

### Шаг 4: Принудительное обновление
Добавьте в конец URL `&nocache=1`:
```javascript
const url = `${CONFIG.appsScriptUrl}?action=auth&fio=${encodeURIComponent(fio)}&password=${encodeURIComponent(password)}&callback=${callbackName}&t=${timestamp}&nocache=1`;
```
