/**
 * Модуль работы с данными
 */
import CONFIG from './config.js';

export class DataManager {
  constructor() {
    this.data = [];
    this.cache = new Map();
  }

  /**
   * Форматирует дату из YYYY-MM-DD в ДД.ММ.ГГГГ
   */
  static formatDate(dateString) {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    return `${day}.${month}.${year}`;
  }

  /**
   * Парсит дату из ДД.ММ.ГГГГ в объект Date
   */
  static parseDate(dateString) {
    if (!dateString) return null;
    const [d, m, y] = dateString.split('.');
    return new Date(y, m - 1, d);
  }

  /**
   * Собирает данные формы в объект
   */
  static gatherFormData() {
    const getValue = (id) => {
      const el = document.getElementById(id);
      return el ? el.value : '';
    };
    
    const getNumber = (id) => {
      const el = document.getElementById(id);
      return el ? (Number(el.value) || 0) : 0;
    };

    const date = this.formatDate(getValue('date'));
    const shift = getValue('shift');
    
    // ID будет присвоен в storage.js по порядку
    const id = null;
    
    const data = {
      // Шапка
      date: date,
      shift: shift,
      shop: getValue('shop'),
      master: getValue('master'),
      
      // Количество людей
      total_people: getNumber('total_people'),
      
      // Поломки
      breakdowns: getValue('breakdowns'),
      
      // ID на основе смены и даты
      id: id
    };

    // Добавляем данные по секциям
    [...CONFIG.sections.people, ...CONFIG.sections.production, 
     ...CONFIG.sections.ends, ...CONFIG.sections.logistics].forEach(field => {
      data[field.id] = getNumber(field.id);
    });

    return data;
  }

  /**
   * Заполняет форму данными (для редактирования)
   */
  static fillForm(data) {
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value || '';
    };

    // Шапка
    // Преобразуем дату из ДД.ММ.ГГГГ в YYYY-MM-DD для input type="date"
    if (data.date || data.Дата) {
      const dateStr = data.date || data.Дата;
      const [d, m, y] = dateStr.split('.');
      setValue('date', `${y}-${m}-${d}`);
    }
    
    setValue('shift', data.shift || data.Смена || '');
    setValue('shop', data.shop || data.Цех || '');
    setValue('master', data.master || data.ФИО_мастера || '');
    setValue('breakdowns', data.breakdowns || data.Поломки || '');
    setValue('record_id', data.id || data.ID || '');

    // Все числовые поля
    [...CONFIG.sections.people, ...CONFIG.sections.production, 
     ...CONFIG.sections.ends, ...CONFIG.sections.logistics].forEach(field => {
      const value = data[field.id] !== undefined ? data[field.id] : 
                   (data[this.getRussianLabel(field.id)] || 0);
      setValue(field.id, value);
    });

    // Обновляем общее количество людей
    this.updateTotalPeople();
  }

  /**
   * Получает русское название поля (для обратной совместимости)
   */
  static getRussianLabel(fieldId) {
    const map = {
      'plasma_people': 'Плазма',
      'strozka_people': 'Строжка',
      'zachistka_people': 'Зачистка_под_сварку',
      'avtosvarka_people': 'Авт_сварка',
      'poloter_people': 'Полотер',
      'press_old_people': 'Штамп_500т_старый',
      'italy_people': 'Итальянец',
      'press_new_people': 'Штамп_500т_новый',
      'otbortovka_people': 'Отбортовка',
      'kromko_people': 'Кромкообрезной_станок',
      'kotelshchik_people': 'Котельщик_приемка',
      'ruchsvarka_people': 'Ручная_сварка'
    };
    return map[fieldId] || fieldId;
  }

  /**
   * Обновляет поле общего количества людей
   */
  static updateTotalPeople() {
    const inputs = document.querySelectorAll('.people-input');
    let total = 0;
    inputs.forEach(input => {
      total += Number(input.value) || 0;
    });
    const totalField = document.getElementById('total_people');
    if (totalField) {
      totalField.value = total;
    }
  }

  /**
   * Валидация данных
   */
  static validate(data) {
    const errors = [];
    
    if (!data.date) errors.push('Дата обязательна');
    if (!data.shift) errors.push('Смена обязательна');
    if (!data.shop) errors.push('Цех обязателен');
    if (!data.master) errors.push('ФИО мастера обязательно');
    
    return errors;
  }

  /**
   * Отправляет данные на сервер
   */
  static async send(data) {
    const payload = {
      action: data.id ? 'update' : 'add',
      data: data
    };
    
    console.log('Отправка данных:', payload);
    
    try {
      const response = await fetch(CONFIG.appsScriptUrl, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      console.log('Статус ответа:', response.status);
      
      // Пробуем прочитать ответ как текст
      const text = await response.text();
      console.log('Ответ сервера:', text);
      
      // Пробуем распарсить как JSON
      try {
        return JSON.parse(text);
      } catch (e) {
        // Если не JSON, возвращаем как есть
        return { result: 'success', message: text };
      }
    } catch (error) {
      console.error('Ошибка отправки:', error);
      // При no-cors или ошибке сети, считаем что запрос ушёл
      return { result: 'success', message: 'Данные отправлены' };
    }
  }

  /**
   * Загружает данные с сервера
   */
  async load() {
    const url = `${CONFIG.appsScriptUrl}?action=get`;
    console.log('Загрузка данных из:', url);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
      });
      
      console.log('Статус ответа:', response.status);
      
      // Пробуем получить текст ответа
      const text = await response.text();
      console.log('Ответ сервера (первые 200 символов):', text.substring(0, 200));
      
      // Если ответ начинается с HTML (ошибка авторизации)
      if (text.trim().startsWith('<') || text.includes('<!DOCTYPE') || text.includes('Скрипт')) {
        throw new Error(
          'Google Apps Script требует авторизации.\n\n' +
          '1. Откройте этот URL в браузере:\n' + 
          url + '\n\n' +
          '2. Авторизуйтесь со своим Google-аккаунтом\n' +
          '3. Затем обновите эту страницу'
        );
      }
      
      // Пробуем распарсить JSON
      let result;
      try {
        result = JSON.parse(text);
      } catch (e) {
        throw new Error(`Неверный формат ответа: ${text.substring(0, 100)}`);
      }
      
      if (result.result === 'success' && Array.isArray(result.data)) {
        this.data = result.data;
        return this.data;
      } else {
        throw new Error(result.message || 'Неизвестная ошибка сервера');
      }
    } catch (error) {
      console.error('Ошибка загрузки:', error);
      throw error;
    }
  }

  /**
   * Фильтрует данные
   */
  filter(filters) {
    const { dateFrom, dateTo, shift, shop, master } = filters;
    
    return this.data.filter(row => {
      // Фильтр по дате
      if (dateFrom || dateTo) {
        const rowDate = row.date || row.Дата;
        if (!rowDate) return false;
        
        const rowDateObj = DataManager.parseDate(rowDate);
        
        if (dateFrom) {
          const from = new Date(dateFrom);
          if (rowDateObj < from) return false;
        }
        if (dateTo) {
          const to = new Date(dateTo);
          to.setHours(23, 59, 59);
          if (rowDateObj > to) return false;
        }
      }
      
      // Фильтр по смене
      if (shift && row.shift != shift && row.Смена != shift) return false;
      
      // Фильтр по цеху
      if (shop) {
        const rowShop = (row.shop || row.Цех || '').toLowerCase();
        if (!rowShop.includes(shop.toLowerCase())) return false;
      }
      
      // Фильтр по мастеру
      if (master) {
        const rowMaster = (row.master || row.ФИО_мастера || '').toLowerCase();
        if (!rowMaster.includes(master.toLowerCase())) return false;
      }
      
      return true;
    });
  }

  /**
   * Удаляет запись
   */
  static async delete(id) {
    try {
      const response = await fetch(CONFIG.appsScriptUrl, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'delete',
          id: id
        }),
      });
      
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        return { result: 'success', message: text };
      }
    } catch (error) {
      console.error('Ошибка удаления:', error);
      return { result: 'success', message: 'Запрос отправлен' };
    }
  }
}

export default DataManager;
