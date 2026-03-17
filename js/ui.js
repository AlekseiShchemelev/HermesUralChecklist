/**
 * Модуль UI компонентов
 */
import CONFIG from './config.js';

export class UI {
  /**
   * Экранирует HTML для безопасной вставки
   */
  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Показывает статусное сообщение
   */
  static showStatus(message, type = 'info', container = null) {
    const target = container || document.getElementById('status');
    if (!target) return;
    
    target.className = `status status-${type}`;
    
    const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
    target.innerHTML = `<span>${icon}</span> ${this.escapeHtml(String(message))}`;
    
    // Автоматически скрываем успешные сообщения
    if (type === 'success') {
      setTimeout(() => {
        target.innerHTML = '';
        target.className = '';
      }, 5000);
    }
  }

  /**
   * Создаёт таблицу данных
   */
  static createDataTable(data, options = {}) {
    // Проверка входных данных
    if (!Array.isArray(data)) {
      return `<div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <p>Некорректные данные</p>
      </div>`;
    }
    
    if (data.length === 0) {
      return `<div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>Нет данных для отображения</p>
      </div>`;
    }
    
    // Проверка структуры данных
    if (!data[0] || typeof data[0] !== 'object') {
      return `<div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <p>Некорректная структура данных</p>
      </div>`;
    }

    const { onEdit, onDelete, editable = true } = options;
    const headers = Object.keys(data[0]);
    
    // Оставляем ID для отображения, но фильтруем другие служебные поля
    const displayHeaders = headers.filter(h => h === 'id' || h === 'ID' || (!['__proto__'].includes(h)));

    let html = '<table class="data-table"><thead><tr>';
    
    // Заголовки
    displayHeaders.forEach(h => {
      html += `<th>${h}</th>`;
    });
    
    if (editable) {
      html += '<th>Действия</th>';
    }
    
    html += '</tr></thead><tbody>';
    
    // Данные
    data.forEach((row, index) => {
      html += '<tr>';
      displayHeaders.forEach(h => {
        let val = row[h];
        if (val === undefined || val === null) val = '';
        
        // Форматируем даты (ISO формат или DD.MM.YYYY)
        if (typeof val === 'string') {
          // ISO формат: 2026-03-16T...
          if (val.match(/^\d{4}-\d{2}-\d{2}T/)) {
            const date = new Date(val);
            if (!isNaN(date.getTime())) {
              val = date.toLocaleDateString('ru-RU');
            }
          }
          // Уже в формате DD.MM.YYYY - оставляем как есть
          else if (val.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
            // val уже в правильном формате
          }
          // Формат YYYY-MM-DD
          else if (val.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [y, m, d] = val.split('-');
            val = `${d}.${m}.${y}`;
          }
        }
        
        // Форматируем длинный текст
        if (typeof val === 'string' && val.length > 50) {
          val = val.substring(0, 50) + '…';
        }
        
        // Определяем класс выравнивания
        // Текстовые поля (ФИО, Поломки) выравниваем по левому краю
        const lowerH = h.toLowerCase();
        const isTextField = lowerH.includes('master') || 
                           lowerH.includes('мастер') || 
                           lowerH.includes('фио') ||
                           lowerH.includes('breakdowns') ||
                           lowerH.includes('поломки');
        const tdClass = isTextField ? 'text-left' : '';
        
        // Экранируем HTML для безопасности
        const safeVal = this.escapeHtml(String(val));
        
        html += `<td class="${tdClass}">${safeVal}</td>`;
      });
      
      if (editable) {
        const rowId = row.id || row.ID || index;
        // Экранируем ID для безопасности
        const safeId = this.escapeHtml(String(rowId));
        html += `<td class="actions-cell">
          <button class="btn btn-sm btn-edit" data-id="${safeId}" data-action="edit" title="Редактировать">✏️</button>
          <button class="btn btn-sm btn-delete" data-id="${safeId}" data-action="delete" title="Удалить">🗑️</button>
        </td>`;
      }
      
      html += '</tr>';
    });
    
    html += '</tbody></table>';
    return html;
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
    
    // Экранируем значение по умолчанию для value
    const defaultShop = this.escapeHtml('Цех №2');
    
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${this.escapeHtml(title)}</h3>
          <button class="modal-close" data-action="close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="editForm">
            <input type="hidden" id="record_id">
            
            <!-- Шапка -->
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
            
            <!-- Количество людей -->
            <h4 style="margin: 20px 0 10px; color: var(--primary);">Количество человек по участкам</h4>
            <div class="production-grid">
              ${CONFIG.sections.people.map(p => `
                <div class="form-group">
                  <label for="edit_${p.id}">${p.label}</label>
                  <input type="number" id="edit_${p.id}" min="0" value="0">
                </div>
              `).join('')}
            </div>
            
            <!-- Производственные показатели -->
            <h4 style="margin: 20px 0 10px; color: var(--primary);">Производственные показатели</h4>
            <div class="production-grid">
              ${CONFIG.sections.production.map(p => `
                <div class="form-group">
                  <label for="edit_${p.id}">${p.label}</label>
                  <input type="number" id="edit_${p.id}" min="0" value="0">
                </div>
              `).join('')}
            </div>
            
            <!-- Днища -->
            <h4 style="margin: 20px 0 10px; color: var(--primary);">Днища</h4>
            <div class="production-grid">
              ${CONFIG.sections.ends.map(p => `
                <div class="form-group">
                  <label for="edit_${p.id}">${p.label}</label>
                  <input type="number" id="edit_${p.id}" min="0" value="0">
                </div>
              `).join('')}
            </div>
            
            <!-- Логистика -->
            <h4 style="margin: 20px 0 10px; color: var(--primary);">Логистика и термообработка</h4>
            <div class="production-grid">
              ${CONFIG.sections.logistics.map(p => `
                <div class="form-group">
                  <label for="edit_${p.id}">${p.label}</label>
                  <input type="number" id="edit_${p.id}" min="0" value="0">
                </div>
              `).join('')}
            </div>
            
            <!-- Поломки -->
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
    
    // Показываем
    setTimeout(() => modal.classList.add('active'), 10);
    
    return modal;
  }

  /**
   * Заполняет форму редактирования данными
   */
  static fillEditForm(data) {
    // Хелпер для безопасной установки значения
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) {
        // Для input type="text" и textarea экранируем спецсимволы
        if (el.type === 'text' || el.tagName === 'TEXTAREA') {
          el.value = this.escapeHtml(String(value || ''));
        } else {
          el.value = value || '';
        }
      }
    };

    // ID записи
    setValue('record_id', data.id || data.ID || '');

    // Дата
    if (data.date || data.Дата) {
      const dateStr = data.date || data.Дата;
      const [d, m, y] = dateStr.split('.');
      if (d && m && y) {
        setValue('edit_date', `${y}-${m}-${d}`);
      }
    }

    // Основные поля
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

    allFields.forEach(field => {
      let value = data[field.id];
      if (value === undefined) {
        // Пробуем найти по русскому названию
        const russianKey = Object.keys(data).find(k => 
          k.toLowerCase().replace(/_/g, ' ') === field.label.toLowerCase()
        );
        value = russianKey ? data[russianKey] : 0;
      }
      setValue(`edit_${field.id}`, value);
    });
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

    // Форматируем дату
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
    
    // ID из record_id (при редактировании) или null (при добавлении - сгенерируется в storage.js)
    const id = getValue('record_id') || null;

    const data = {
      id: id,
      date: formattedDate,
      shift: shift,
      shop: getValue('edit_shop'),
      master: getValue('edit_master'),
      breakdowns: getValue('edit_breakdowns'),
      isUpdate: !!getValue('record_id') // Флаг обновления
    };

    // Добавляем все числовые поля
    const allFields = [
      ...CONFIG.sections.people,
      ...CONFIG.sections.production,
      ...CONFIG.sections.ends,
      ...CONFIG.sections.logistics
    ];

    allFields.forEach(field => {
      data[field.id] = getNumber(`edit_${field.id}`);
    });

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
        <p>${message}</p>
      </div>
    `;
  }

  /**
   * Показывает ошибку
   */
  static showError(container, message) {
    // Заменяем переносы строк на <br> и экранируем HTML
    const formattedMessage = this.escapeHtml(String(message)).replace(/\n/g, '<br>');
    container.innerHTML = `
      <div class="error-message" style="text-align: left; font-family: monospace; white-space: pre-wrap;">
        <p>⚠️ Ошибка соединения с сервером</p>
        <hr style="margin: 10px 0; border: none; border-top: 1px solid #f5c6cb;">
        <p>${formattedMessage}</p>
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
