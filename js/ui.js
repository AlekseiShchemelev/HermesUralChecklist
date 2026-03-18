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
    
    // Кнопки действий в начале
    if (editable) {
      html.push('<th class="actions-col">Действия</th>');
    }
    
    // Заголовки
    for (const h of displayHeaders) {
      html.push(`<th>${escapeHtml(h)}</th>`);
    }
    
    html.push('</tr></thead><tbody>');
    
    // Данные - оптимизированный цикл for вместо forEach
    const len = data.length;
    for (let i = 0; i < len; i++) {
      const row = data[i];
      html.push('<tr>');
      
      // Кнопки действий в начале строки
      if (editable) {
        const rowId = escapeHtml(String(row.id || row.ID || i));
        html.push(`<td class="actions-cell">
          <button class="btn btn-sm btn-edit" data-id="${rowId}" data-action="edit" title="Редактировать">✏️</button>
          <button class="btn btn-sm btn-delete" data-id="${rowId}" data-action="delete" title="Удалить">🗑️</button>
        </td>`);
      }
      
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

    // Дата
    if (data.date || data.Дата) {
      const dateStr = data.date || data.Дата;
      const parts = dateStr.split('.');
      if (parts.length === 3) {
        setValue('edit_date', `${parts[2]}-${parts[1]}-${parts[0]}`);
      }
    }

    setValue('edit_shift', data.shift || data.Смена || '');
    setValue('edit_shop', data.shop || data.Цех || '');
    setValue('edit_master', data.master || data.ФИО_мастера || '');
    setValue('edit_breakdowns', data.breakdowns || data.Поломки || '');

    // Все числовые поля
    const allFields = [
      ...CONFIG.sections.people,
      ...CONFIG.sections.production,
      ...CONFIG.sections.ends,
      ...CONFIG.sections.logistics
    ];

    for (const field of allFields) {
      let value = data[field.id];
      if (value === undefined) {
        const russianKey = Object.keys(data).find(k => 
          k.toLowerCase().replace(/_/g, ' ') === field.label.toLowerCase()
        );
        value = russianKey ? data[russianKey] : 0;
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
    if (!shift || !['1', '2', '3'].includes(shift)) {
      throw new Error('Некорректная смена');
    }
    
    const id = getValue('record_id') || null;

    const data = {
      id: id,
      date: formattedDate,
      shift: shift,
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
}

export default UI;
