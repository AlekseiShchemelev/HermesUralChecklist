/**
 * Модуль UI компонентов (оптимизированная версия)
 */
import CONFIG from './config.js';

// Быстрое экранирование HTML без создания DOM
const escapeHtml = (() => {
  const div = document.createElement('div');
  const text = document.createTextNode('');
  div.appendChild(text);
  
  return (str) => {
    if (str == null) return '';
    text.nodeValue = str;
    return div.innerHTML;
  };
})();

// Кэш для шаблонов
const templateCache = new Map();

export class UI {
  /**
   * Показывает индикатор загрузки на кнопке
   */
  static setButtonLoading(button, loading = true, text = 'Сохранение...') {
    if (!button) return;
    
    if (loading) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.innerHTML = `<span class="spinner"></span> ${text}`;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || 'Сохранить';
      delete button.dataset.originalText;
    }
  }
  
  /**
   * Показывает оверлей загрузки на элементе
   */
  static showLoadingOverlay(element, text = 'Загрузка...') {
    if (!element) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
      <div class="loading-content">
        <span class="spinner"></span>
        <span>${text}</span>
      </div>
    `;
    
    element.style.position = 'relative';
    element.appendChild(overlay);
    return overlay;
  }
  
  /**
   * Скрывает оверлей загрузки
   */
  static hideLoadingOverlay(element) {
    if (!element) return;
    const overlay = element.querySelector('.loading-overlay');
    if (overlay) overlay.remove();
  }
  
  /**
   * Показывает статусное сообщение
   */
  static showStatus(message, type = 'info', container = null) {
    const target = container || document.getElementById('status');
    if (!target) return;
    
    target.className = `status status-${type}`;
    
    const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
    target.innerHTML = `<span>${icon}</span> ${escapeHtml(String(message))}`;
    
    // Автоматически скрываем успешные сообщения
    if (type === 'success') {
      setTimeout(() => {
        target.innerHTML = '';
        target.className = '';
      }, 5000);
    }
  }

  /**
   * Создаёт таблицу данных (оптимизированная версия с HTML строками)
   */
  static createDataTable(data, options = {}) {
    // Проверка входных данных
    if (!Array.isArray(data)) {
      return `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>Некорректные данные</p></div>`;
    }
    
    if (data.length === 0) {
      return `<div class="empty-state"><div class="empty-state-icon">📭</div><p>Нет данных для отображения</p></div>`;
    }
    
    if (!data[0] || typeof data[0] !== 'object') {
      return `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>Некорректная структура данных</p></div>`;
    }

    const { editable = true } = options;
    const headers = Object.keys(data[0]);
    const displayHeaders = headers.filter(h => h === 'id' || h === 'ID' || !['__proto__'].includes(h));
    
    // Используем массив для накопления строк (быстрее конкатенации)
    const html = [];
    html.push('<table class="data-table"><thead><tr>');
    
    // Заголовки
    for (const h of displayHeaders) {
      html.push(`<th>${escapeHtml(h)}</th>`);
    }
    
    html.push('</tr></thead><tbody>');
    
    // Данные - оптимизированный цикл for вместо forEach
    const len = data.length;
    for (let i = 0; i < len; i++) {
      const row = data[i];
      const rowId = escapeHtml(String(row.id || row.ID || i));
      
      // Строка кликабельная для просмотра
      html.push(`<tr class="clickable-row" data-id="${rowId}" title="Нажмите для просмотра">`);
      
      for (const h of displayHeaders) {
        let val = row[h];
        if (val === undefined || val === null) val = '';
        
        // Быстрое форматирование дат без регулярных выражений
        if (typeof val === 'string' && val.length > 10) {
          if (val[4] === '-' && val[10] === 'T') {
            // ISO формат: 2026-03-16T...
            const d = new Date(val);
            if (!isNaN(d.getTime())) {
              val = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
            }
          } else if (val[4] === '-' && val[7] === '-') {
            // YYYY-MM-DD
            val = `${val[8]}${val[9]}.${val[5]}${val[6]}.${val[0]}${val[1]}${val[2]}${val[3]}`;
          }
        }
        
        // Обрезка длинного текста
        if (typeof val === 'string' && val.length > 50) {
          val = val.substring(0, 50) + '…';
        }
        
        // Определяем класс выравнивания
        const lowerH = h.toLowerCase();
        const isTextField = lowerH.includes('master') || 
                           lowerH.includes('мастер') || 
                           lowerH.includes('фио') ||
                           lowerH.includes('breakdowns') ||
                           lowerH.includes('поломки');
        
        const cls = isTextField ? ' class="text-left"' : '';
        html.push(`<td${cls}>${escapeHtml(String(val))}</td>`);
      }
      
      html.push('</tr>');
    }
    
    html.push('</tbody></table>');
    return html.join('');
  }

  /**
   * Создаёт модальное окно редактирования
   */
  static createEditModal(data = null) {
    const isEdit = !!data;
    const modalId = 'editModal';
    
    // Удаляем существующее модальное окно
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-overlay';
    
    const title = isEdit ? 'Редактирование записи' : 'Новая запись';
    const defaultShop = escapeHtml('Цех №2');
    
    // Генерируем поля формы через массив (быстрее строковых конкатенаций)
    const peopleFields = CONFIG.sections.people.map(p => `
      <div class="form-group">
        <label for="edit_${p.id}">${escapeHtml(p.label)}</label>
        <input type="number" id="edit_${p.id}" min="0" value="0">
      </div>
    `).join('');
    
    const productionFields = CONFIG.sections.production.map(p => `
      <div class="form-group">
        <label for="edit_${p.id}">${escapeHtml(p.label)}</label>
        <input type="number" id="edit_${p.id}" min="0" value="0">
      </div>
    `).join('');
    
    const endsFields = CONFIG.sections.ends.map(p => `
      <div class="form-group">
        <label for="edit_${p.id}">${escapeHtml(p.label)}</label>
        <input type="number" id="edit_${p.id}" min="0" value="0">
      </div>
    `).join('');
    
    const logisticsFields = CONFIG.sections.logistics.map(p => `
      <div class="form-group">
        <label for="edit_${p.id}">${escapeHtml(p.label)}</label>
        <input type="number" id="edit_${p.id}" min="0" value="0">
      </div>
    `).join('');
    
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(title)}</h3>
          <button class="modal-close" data-action="close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="editForm">
            <input type="hidden" id="record_id">
            
            <div class="form-row">
              <div class="form-group">
                <label for="edit_date">Дата</label>
                <input type="date" id="edit_date" required>
              </div>
              <div class="form-group">
                <label for="edit_shift">Смена</label>
                <select id="edit_shift" required>
                  <option value="">Выберите</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </div>
              <div class="form-group">
                <label for="edit_shiftType">День/Ночь</label>
                <select id="edit_shiftType" required>
                  <option value="">Выберите</option>
                  <option value="День">День</option>
                  <option value="Ночь">Ночь</option>
                </select>
              </div>
              <div class="form-group">
                <label for="edit_shop">Цех</label>
                <input type="text" id="edit_shop" value="${defaultShop}" required>
              </div>
              <div class="form-group">
                <label for="edit_master">ФИО мастера</label>
                <input type="text" id="edit_master" required>
              </div>
            </div>
            
            <h4 style="margin: 20px 0 10px; color: var(--primary);">Количество человек по участкам</h4>
            <div class="production-grid">${peopleFields}</div>
            
            <h4 style="margin: 20px 0 10px; color: var(--primary);">Производственные показатели</h4>
            <div class="production-grid">${productionFields}</div>
            
            <h4 style="margin: 20px 0 10px; color: var(--primary);">Днища</h4>
            <div class="production-grid">${endsFields}</div>
            
            <h4 style="margin: 20px 0 10px; color: var(--primary);">Логистика и термообработка</h4>
            <div class="production-grid">${logisticsFields}</div>
            
            <div class="form-group" style="margin-top: 15px;">
              <label for="edit_breakdowns">Поломки и простои</label>
              <textarea id="edit_breakdowns" rows="3" placeholder="Описание поломок..."></textarea>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="close">Отмена</button>
          <button class="btn btn-primary" data-action="save">Сохранить</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Заполняем данные если редактирование
    if (data) {
      this.fillEditForm(data);
    }
    
    // Показываем с небольшой задержкой для анимации
    requestAnimationFrame(() => modal.classList.add('active'));
    
    return modal;
  }

  /**
   * Заполняет форму редактирования данными
   */
  static fillEditForm(data) {
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) {
        if (el.type === 'text' || el.tagName === 'TEXTAREA') {
          el.value = escapeHtml(String(value || ''));
        } else {
          el.value = value || '';
        }
      }
    };

    setValue('record_id', data.id || data.ID || '');

    // Дата - поддержка DD.MM.YYYY и ISO формата (2026-03-16T19:00:00.000Z)
    const dateStr = data.date || data.Дата || data['ДАТА'];
    if (dateStr) {
      let dateObj = null;
      
      if (typeof dateStr === 'string' && dateStr.includes('T')) {
        // ISO формат - конвертируем в локальную дату
        const d = new Date(dateStr);
        dateObj = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      } else if (typeof dateStr === 'string' && dateStr.includes('.')) {
        // Формат DD.MM.YYYY
        const parts = dateStr.split('.');
        if (parts.length === 3) {
          dateObj = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        }
      }
      
      if (dateObj && !isNaN(dateObj.getTime())) {
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        setValue('edit_date', `${yyyy}-${mm}-${dd}`);
      }
    }

    setValue('edit_shift', data.shift || data.Смена || data['СМЕНА'] || '');
    setValue('edit_shiftType', data.shift_type || data.День_Ночь || data['ДЕНЬ_НОЧЬ'] || '');
    setValue('edit_shop', data.shop || data.Цех || data['ЦЕХ'] || '');
    setValue('edit_master', data.master || data.ФИО_мастера || data['ФИО_МАСТЕРА'] || '');
    setValue('edit_breakdowns', data.breakdowns || data.Поломки || data['ПОЛОМКИ_И_ПРОСТОИ'] || '');

    // Все числовые поля
    const allFields = [
      ...CONFIG.sections.people,
      ...CONFIG.sections.production,
      ...CONFIG.sections.ends,
      ...CONFIG.sections.logistics
    ];

    for (const field of allFields) {
      // Сначала ищем по ID, потом по russianKey, потом похожий ключ
      let value = data[field.id];
      
      if ((value === undefined || value === null) && field.russianKey) {
        value = data[field.russianKey];
      }
      
      if (value === undefined || value === null) {
        // Ищем похожий ключ в данных
        const foundKey = Object.keys(data).find(k => 
          k.toUpperCase().includes(field.russianKey) ||
          k.toLowerCase().includes(field.id.toLowerCase())
        );
        value = foundKey ? data[foundKey] : 0;
      }
      
      setValue(`edit_${field.id}`, value);
    }
  }

  /**
   * Собирает данные из формы редактирования
   */
  static gatherEditFormData() {
    const getValue = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };

    const getNumber = (id) => {
      const el = document.getElementById(id);
      const val = el ? parseInt(el.value, 10) : 0;
      return isNaN(val) ? 0 : Math.max(0, val);
    };

    // Валидация даты
    const dateVal = getValue('edit_date');
    if (!dateVal || !dateVal.match(/^\d{4}-\d{2}-\d{2}$/)) {
      throw new Error('Некорректная дата');
    }
    const [y, m, d] = dateVal.split('-');
    const formattedDate = `${d}.${m}.${y}`;
    
    const shift = getValue('edit_shift');
    if (!shift || !['1', '2', '3', '4'].includes(shift)) {
      throw new Error('Некорректная смена');
    }
    
    const shiftType = getValue('edit_shiftType');
    
    const id = getValue('record_id') || null;

    const data = {
      id: id,
      date: formattedDate,
      shift: shift,
      shift_type: shiftType,
      shop: getValue('edit_shop'),
      master: getValue('edit_master'),
      breakdowns: getValue('edit_breakdowns'),
      isUpdate: !!getValue('record_id')
    };

    // Добавляем все числовые поля
    const allFields = [
      ...CONFIG.sections.people,
      ...CONFIG.sections.production,
      ...CONFIG.sections.ends,
      ...CONFIG.sections.logistics
    ];

    for (const field of allFields) {
      data[field.id] = getNumber(`edit_${field.id}`);
    }

    // Считаем общее количество людей
    data.total_people = CONFIG.sections.people.reduce((sum, field) => {
      return sum + data[field.id];
    }, 0);

    return data;
  }

  /**
   * Закрывает модальное окно
   */
  static closeModal(modalId = 'editModal') {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      setTimeout(() => modal.remove(), 300);
    }
  }

  /**
   * Показывает индикатор загрузки
   */
  static showLoading(container, message = 'Загрузка...') {
    container.innerHTML = `
      <div class="loading">
        <div class="loading-spinner"></div>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  /**
   * Показывает ошибку
   */
  static showError(container, message) {
    const formattedMessage = escapeHtml(String(message)).replace(/\n/g, '<br>');
    container.innerHTML = `
      <div class="error-message" style="text-align: left; font-family: monospace; white-space: pre-wrap;">
        <p>⚠️ Ошибка соединения с сервером Google Script</p>
        <hr style="margin: 10px 0; border: none; border-top: 1px solid #f5c6cb;">
        <p>${formattedMessage}</p>
        <hr style="margin: 10px 0; border: none; border-top: 1px solid #f5c6cb;">
        <p><strong>Возможные решения:</strong></p>
        <ol style="margin-left: 20px; margin-top: 5px;">
          <li>Проверьте подключение к интернету</li>
          <li>Убедитесь что Google Script развёрнут:
            <br>• Откройте <a href="test-script.html" target="_blank">test-script.html</a> для диагностики
            <br>• Или прочитайте <a href="DEPLOYMENT_FIX.md" target="_blank">инструкцию</a>
          </li>
          <li>Попробуйте создать новый deployment в Google Apps Script</li>
        </ol>
        <p style="margin-top: 10px; font-size: 12px; color: #666;">
          Приложение работает в offline-режиме. Данные сохраняются локально.
        </p>
      </div>
    `;
  }

  /**
   * Подтверждение действия
   */
  static confirm(message) {
    return new Promise((resolve) => {
      const confirmed = window.confirm(message);
      resolve(confirmed);
    });
  }

  /**
   * Показывает глобальный индикатор загрузки
   */
  static showGlobalLoading(message = 'Загрузка...') {
    const existing = document.getElementById('globalLoading');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'globalLoading';
    overlay.className = 'global-loading';
    overlay.innerHTML = `
      <div class="loading-card">
        <div class="loading-spinner"></div>
        <p class="loading-text">${escapeHtml(message)}</p>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  /**
   * Скрывает глобальный индикатор загрузки
   */
  static hideGlobalLoading() {
    const overlay = document.getElementById('globalLoading');
    if (overlay) {
      overlay.remove();
    }
  }

  /**
   * Получает значение из данных записи (по ID или russianKey)
   */
  static getRecordValue(data, field) {
    // Сначала ищем по ID
    if (data[field.id] !== undefined && data[field.id] !== null && data[field.id] !== '') {
      return Number(data[field.id]) || 0;
    }
    // Потом по russianKey
    if (field.russianKey && data[field.russianKey] !== undefined && data[field.russianKey] !== null && data[field.russianKey] !== '') {
      return Number(data[field.russianKey]) || 0;
    }
    // Ищем похожий ключ
    const dataKeys = Object.keys(data);
    for (const key of dataKeys) {
      if (key.toUpperCase() === field.russianKey || 
          key.toLowerCase().includes(field.id.toLowerCase())) {
        const val = data[key];
        if (val !== undefined && val !== null && val !== '') {
          return Number(val) || 0;
        }
      }
    }
    return 0;
  }

  /**
   * Создаёт окно просмотра записи
   */
  static createViewModal(data, options = {}) {
    const { onEdit, onDelete, onClose } = options;
    const modalId = 'viewModal';
    
    // Удаляем существующее модальное окно
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-overlay view-modal';
    
    // Получаем основные поля (проверяем разные варианты названий)
    const dateStr = data.date || data.Дата || data['ДАТА'];
    const shift = data.shift || data.Смена || data['СМЕНА'];
    const shop = data.shop || data.Цех || data['ЦЕХ'];
    const master = data.master || data.ФИО_мастера || data['ФИО_МАСТЕРА'];
    const shiftType = data.shift_type || data.День_Ночь || data['ДЕНЬ_НОЧЬ'];
    
    // Форматируем дату
    let dateDisplay = '-';
    if (dateStr) {
      if (typeof dateStr === 'string' && dateStr.includes('T')) {
        const d = new Date(dateStr);
        dateDisplay = d.toLocaleDateString('ru-RU');
      } else {
        dateDisplay = dateStr;
      }
    }
    
    // Генерируем секции данных
    const peopleSection = CONFIG.sections.people.map(p => {
      const value = this.getRecordValue(data, p);
      if (value > 0) {
        return `
          <div class="view-item">
            <div class="view-item-label">${escapeHtml(p.label)}</div>
            <div class="view-item-value">${value} чел.</div>
          </div>
        `;
      }
      return '';
    }).filter(Boolean).join('') || '<p style="color: var(--text-secondary);">Нет данных</p>';
    
    const productionSection = CONFIG.sections.production.map(p => {
      const value = this.getRecordValue(data, p);
      if (value > 0) {
        return `
          <div class="view-item">
            <div class="view-item-label">${escapeHtml(p.label)}</div>
            <div class="view-item-value">${value}</div>
          </div>
        `;
      }
      return '';
    }).filter(Boolean).join('') || '<p style="color: var(--text-secondary);">Нет данных</p>';
    
    const endsSection = CONFIG.sections.ends.map(p => {
      const value = this.getRecordValue(data, p);
      if (value > 0) {
        return `
          <div class="view-item">
            <div class="view-item-label">${escapeHtml(p.label)}</div>
            <div class="view-item-value">${value}</div>
          </div>
        `;
      }
      return '';
    }).filter(Boolean).join('') || '<p style="color: var(--text-secondary);">Нет данных</p>';
    
    const logisticsSection = CONFIG.sections.logistics.map(p => {
      const value = this.getRecordValue(data, p);
      if (value > 0) {
        return `
          <div class="view-item">
            <div class="view-item-label">${escapeHtml(p.label)}</div>
            <div class="view-item-value">${value}</div>
          </div>
        `;
      }
      return '';
    }).filter(Boolean).join('') || '<p style="color: var(--text-secondary);">Нет данных</p>';
    
    const breakdowns = data.breakdowns || data.Поломки || '';
    
    modal.innerHTML = `
      <div class="modal">
        <div class="view-modal-header">
          <h3>📋 Просмотр записи #${data.id || data.ID}</h3>
          <button class="modal-close" data-action="close" style="background: rgba(255,255,255,0.2); color: white; border: none; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center; transition: var(--transition);">&times;</button>
        </div>
        <div class="view-modal-body">
          <!-- Основная информация -->
          <div class="view-section">
            <div class="view-section-title">📅 Основная информация</div>
            <div class="view-grid">
              <div class="view-item">
                <div class="view-item-label">Дата</div>
                <div class="view-item-value">${dateDisplay}</div>
              </div>
              <div class="view-item">
                <div class="view-item-label">Смена</div>
                <div class="view-item-value">${shift || '-'}</div>
              </div>
              <div class="view-item">
                <div class="view-item-label">День/Ночь</div>
                <div class="view-item-value">${shiftType || '-'}</div>
              </div>
              <div class="view-item">
                <div class="view-item-label">Цех</div>
                <div class="view-item-value">${escapeHtml(shop || '-')}</div>
              </div>
              <div class="view-item">
                <div class="view-item-label">Мастер</div>
                <div class="view-item-value">${escapeHtml(master || '-')}</div>
              </div>
            </div>
          </div>
          
          <!-- Количество человек -->
          <div class="view-section">
            <div class="view-section-title">👥 Количество человек по участкам</div>
            <div class="view-grid">
              ${peopleSection}
            </div>
          </div>
          
          <!-- Производственные показатели -->
          <div class="view-section">
            <div class="view-section-title">🏭 Производственные показатели</div>
            <div class="view-grid">
              ${productionSection}
            </div>
          </div>
          
          <!-- Днища -->
          <div class="view-section">
            <div class="view-section-title">🔧 Готовая продукция (днища)</div>
            <div class="view-grid">
              ${endsSection}
            </div>
          </div>
          
          <!-- Логистика -->
          <div class="view-section">
            <div class="view-section-title">🚛 Логистика и термообработка</div>
            <div class="view-grid">
              ${logisticsSection}
            </div>
          </div>
          
          <!-- Поломки -->
          ${breakdowns ? `
          <div class="view-section">
            <div class="view-section-title">⚠️ Поломки и простои</div>
            <div style="background: #fef3c7; padding: 16px; border-radius: var(--radius-md); border-left: 4px solid #f59e0b;">
              <p style="margin: 0; color: #92400e; line-height: 1.6;">${escapeHtml(breakdowns).replace(/\n/g, '<br>')}</p>
            </div>
          </div>
          ` : ''}
        </div>
        <div class="view-modal-footer">
          <button class="btn btn-primary" data-action="edit" style="flex: 1;">
            <span>✏️</span> Редактировать
          </button>
          <button class="btn btn-danger" data-action="delete" style="flex: 1;">
            <span>🗑️</span> Удалить
          </button>
          <button class="btn btn-secondary" data-action="close" style="flex: 1;">
            <span>✕</span> Закрыть
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Привязываем обработчики
    const bindActions = () => {
      const editBtn = modal.querySelector('[data-action="edit"]');
      const deleteBtn = modal.querySelector('[data-action="delete"]');
      const closeBtns = modal.querySelectorAll('[data-action="close"]');
      
      const closeModalFn = () => {
        this.closeModal(modalId);
        if (onClose) onClose();
      };
      
      if (editBtn && onEdit) {
        editBtn.onclick = () => {
          this.closeModal(modalId);
          onEdit();
        };
      }
      
      if (deleteBtn && onDelete) {
        deleteBtn.onclick = () => {
          this.closeModal(modalId);
          onDelete();
        };
      }
      
      // Все кнопки закрыть (в шапке и футере)
      closeBtns.forEach(btn => {
        btn.onclick = closeModalFn;
      });
      
      // Закрытие по клику вне окна
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeModalFn();
        }
      });
      
      // Закрытие по Escape
      const closeOnEscape = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', closeOnEscape);
          closeModalFn();
        }
      };
      document.addEventListener('keydown', closeOnEscape);
    };
    
    bindActions();
    
    // Показываем с небольшой задержкой для анимации
    requestAnimationFrame(() => modal.classList.add('active'));
    
    return modal;
  }
}

export default UI;
