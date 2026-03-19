/**
 * Модуль работы с данными (оптимизированная версия)
 */
import CONFIG from './config.js';

// Таймер для debounce
let debounceTimer = null;

export class DataManager {
  constructor() {
    this.data = [];
    this.cache = new Map();
    this.filterWorker = null;
    this.initWorker();
  }
  
  /**
   * Инициализация Web Worker для фильтрации
   */
  initWorker() {
    if (typeof Worker !== 'undefined') {
      try {
        // Inline worker для простоты
        const workerCode = `
          // Парсит дату из различных форматов (ISO, DD.MM.YYYY, YYYY-MM-DD)
          function parseRowDate(dateStr) {
            if (!dateStr) return null;
            
            // ISO 8601 формат (2026-03-16T19:00:00.000Z)
            if (dateStr.includes('T')) {
              const date = new Date(dateStr);
              if (!isNaN(date.getTime())) {
                return new Date(date.getFullYear(), date.getMonth(), date.getDate());
              }
            }
            
            // Формат DD.MM.YYYY
            const parts = dateStr.split('.');
            if (parts.length === 3) {
              return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
            }
            
            // Формат YYYY-MM-DD
            const dashParts = dateStr.split('-');
            if (dashParts.length === 3) {
              return new Date(Number(dashParts[0]), Number(dashParts[1]) - 1, Number(dashParts[2]));
            }
            
            return null;
          }
          
          // Парсит YYYY-MM-DD фильтра в локальную дату
          function parseFilterDate(dateStr) {
            const parts = dateStr.split('-');
            return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          }
          
          self.onmessage = function(e) {
            const { data, filters } = e.data;
            
            const result = data.filter(row => {
              // Фильтр по дате - проверяем все возможные варианты названий полей
              if (filters.dateFrom || filters.dateTo) {
                const rowDate = row.date || row.Дата || row['ДАТА'] || row['дата'];
                if (!rowDate) return false;
                
                const rowDateObj = parseRowDate(rowDate);
                if (!rowDateObj) return false;
                
                if (filters.dateFrom) {
                  const from = parseFilterDate(filters.dateFrom);
                  if (rowDateObj < from) return false;
                }
                if (filters.dateTo) {
                  const to = parseFilterDate(filters.dateTo);
                  to.setHours(23, 59, 59);
                  if (rowDateObj > to) return false;
                }
              }
              
              // Фильтр по смене
              if (filters.shift) {
                const rowShift = row.shift || row.Смена || row['СМЕНА'];
                if (String(rowShift) !== String(filters.shift)) return false;
              }
              
              // Фильтр по День/Ночь (без учета регистра)
              if (filters.shiftType) {
                const rowShiftType = String(row.shift_type || row.День_Ночь || row['ДЕНЬ_НОЧЬ'] || '').trim().toLowerCase();
                if (rowShiftType !== filters.shiftType.toLowerCase()) return false;
              }
              
              // Фильтр по цеху
              if (filters.shop) {
                const rowShop = (row.shop || row.Цех || row['ЦЕХ'] || '').toLowerCase();
                if (!rowShop.includes(filters.shop.toLowerCase())) return false;
              }
              
              // Фильтр по мастеру
              if (filters.master) {
                const rowMaster = (row.master || row.ФИО_мастера || row['ФИО_МАСТЕРА'] || '').toLowerCase();
                if (!rowMaster.includes(filters.master.toLowerCase())) return false;
              }
              
              return true;
            });
            
            self.postMessage({ result });
          };
        `;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.filterWorker = new Worker(URL.createObjectURL(blob));
      } catch (e) {
        // Worker not supported
      }
    }
  }

  /**
   * Форматирует дату
   */
  static formatDate(dateString) {
    if (!dateString) return '';
    const parts = dateString.split('-');
    if (parts.length !== 3) return '';
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }

  /**
   * Парсит дату из различных форматов
   * Поддерживает: DD.MM.YYYY, YYYY-MM-DD, ISO 8601 (2026-03-16T19:00:00.000Z)
   */
  static parseDate(dateString) {
    if (!dateString) return null;
    
    // ISO 8601 формат (2026-03-16T19:00:00.000Z)
    if (dateString.includes('T')) {
      const date = new Date(dateString);
      if (!isNaN(date.getTime())) {
        // Конвертируем UTC в локальную дату (для GMT+0500)
        const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        return localDate;
      }
    }
    
    // Формат DD.MM.YYYY
    const parts = dateString.split('.');
    if (parts.length === 3) {
      return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    }
    
    // Формат YYYY-MM-DD
    const dashParts = dateString.split('-');
    if (dashParts.length === 3) {
      return new Date(Number(dashParts[0]), Number(dashParts[1]) - 1, Number(dashParts[2]));
    }
    
    return null;
  }

  /**
   * Собирает данные формы
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
    const shiftType = getValue('shiftType');
    
    const data = {
      date: date,
      shift: shift,
      shift_type: shiftType,
      shop: getValue('shop'),
      master: getValue('master'),
      total_people: getNumber('total_people'),
      breakdowns: getValue('breakdowns'),
      id: null
    };

    // Добавляем данные по секциям
    const fields = [
      ...CONFIG.sections.people, 
      ...CONFIG.sections.production, 
      ...CONFIG.sections.ends, 
      ...CONFIG.sections.logistics
    ];
    
    for (const field of fields) {
      data[field.id] = getNumber(field.id);
    }

    return data;
  }

  /**
   * Заполняет форму данными
   */
  static fillForm(data) {
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value || '';
    };

    if (data.date || data.Дата) {
      const dateStr = data.date || data.Дата;
      const parts = dateStr.split('.');
      if (parts.length === 3) {
        setValue('date', `${parts[2]}-${parts[1]}-${parts[0]}`);
      }
    }
    
    setValue('shift', data.shift || data.Смена || '');
    setValue('shop', data.shop || data.Цех || '');
    setValue('master', data.master || data.ФИО_мастера || '');
    setValue('breakdowns', data.breakdowns || data.Поломки || '');
    setValue('record_id', data.id || data.ID || '');

    const allFields = [
      ...CONFIG.sections.people, 
      ...CONFIG.sections.production, 
      ...CONFIG.sections.ends, 
      ...CONFIG.sections.logistics
    ];
    
    for (const field of allFields) {
      const value = data[field.id] !== undefined ? data[field.id] : 
                   (data[this.getRussianLabel(field.id)] || 0);
      setValue(field.id, value);
    }

    this.updateTotalPeople();
  }

  /**
   * Получает русское название поля
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
   * Обновляет общее количество с debounce
   */
  static updateTotalPeople() {
    // Отменяем предыдущий таймер
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    
    // Новый таймер
    debounceTimer = setTimeout(() => {
      // Исключаем total_people из подсчёта
      const inputs = document.querySelectorAll('.people-input:not(#total_people)');
      let total = 0;
      
      // Быстрый цикл for
      for (let i = 0; i < inputs.length; i++) {
        total += Number(inputs[i].value) || 0;
      }
      
      const totalField = document.getElementById('total_people');
      if (totalField) {
        totalField.value = total;
      }
      
      debounceTimer = null;
    }, 50); // 50ms debounce
  }

  /**
   * Валидация
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
   * Фильтрует данные (с использованием Worker если возможно)
   */
  async filter(filters) {
    // Если мало данных или Worker не доступен - фильтруем в главном потоке
    if (this.data.length < 1000 || !this.filterWorker) {
      return this.filterSync(filters);
    }
    
    // Используем Worker для больших наборов данных
    return new Promise((resolve) => {
      this.filterWorker.onmessage = (e) => {
        resolve(e.data.result);
      };
      
      this.filterWorker.postMessage({
        data: this.data,
        filters: filters
      });
    });
  }
  
  /**
   * Синхронная фильтрация (fallback)
   */
  filterSync(filters) {
    const { dateFrom, dateTo, shift, shiftType, shop, master } = filters;
    
    // Парсим даты фильтра заранее (из YYYY-MM-DD в локальную дату)
    let filterFrom = null;
    let filterTo = null;
    if (dateFrom) {
      const [y, m, d] = dateFrom.split('-');
      filterFrom = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0);
    }
    if (dateTo) {
      const [y, m, d] = dateTo.split('-');
      filterTo = new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59);
    }
    
    const result = this.data.filter(row => {
      // Фильтр по дате - проверяем все возможные варианты названий полей
      if (filterFrom || filterTo) {
        const rowDate = row.date || row.Дата || row['ДАТА'] || row['дата'];
        if (!rowDate) return false;
        
        const rowDateObj = DataManager.parseDate(rowDate);
        if (!rowDateObj) {
          console.warn('Не удалось распарсить дату:', rowDate);
          return false;
        }
        
        if (filterFrom && rowDateObj < filterFrom) return false;
        if (filterTo && rowDateObj > filterTo) return false;
      }
      
      // Фильтр по смене
      if (shift) {
        const rowShift = row.shift || row.Смена || row['СМЕНА'];
        if (String(rowShift) !== String(shift)) return false;
      }
      
      // Фильтр по День/Ночь (без учета регистра)
      if (shiftType) {
        const rowShiftType = (row.shift_type || row.День_Ночь || row['ДЕНЬ_НОЧЬ'] || '').toString().trim().toLowerCase();
        if (rowShiftType !== shiftType.toLowerCase()) return false;
      }
      
      // Фильтр по цеху
      if (shop) {
        const rowShop = (row.shop || row.Цех || row['ЦЕХ'] || '').toLowerCase();
        if (!rowShop.includes(shop.toLowerCase())) return false;
      }
      
      // Фильтр по мастеру
      if (master) {
        const rowMaster = (row.master || row.ФИО_мастера || row['ФИО_МАСТЕРА'] || '').toLowerCase();
        if (!rowMaster.includes(master.toLowerCase())) return false;
      }
      
      return true;
    });
    
    return result;
  }
}

export default DataManager;
