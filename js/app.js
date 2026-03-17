/**
 * Главный модуль приложения
 */
import CONFIG from './config.js';
import { DataManager } from './data.js';
import { UI } from './ui.js';
import { Storage } from './storage.js';

class App {
  constructor() {
    this.dataManager = new DataManager();
    this.storage = new Storage();
    this.currentMode = 'input'; // 'input' или 'view'
    this.init();
  }

  /**
   * Инициализация приложения
   */
  init() {
    this.bindModeSwitcher();
    this.bindFormHandlers();
    this.bindViewHandlers();
    this.initPeopleCalculation();
    this.setDefaultDate();
  }

  /**
   * Переключение режимов
   */
  bindModeSwitcher() {
    const buttons = document.querySelectorAll('.mode-btn');
    
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.switchMode(mode);
      });
    });
  }

  /**
   * Переключает режим отображения
   */
  switchMode(mode) {
    this.currentMode = mode;
    
    // Обновляем кнопки
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    // Обновляем секции
    document.querySelectorAll('.content-section').forEach(section => {
      section.classList.toggle('active', section.id === `${mode}-section`);
    });
    
    // Если переключились на просмотр - загружаем данные
    if (mode === 'view') {
      this.loadData();
    }
    
    // Обновляем URL hash
    window.location.hash = mode;
  }

  /**
   * Устанавливает дату по умолчанию
   */
  setDefaultDate() {
    const dateInput = document.getElementById('date');
    if (dateInput && !dateInput.value) {
      dateInput.valueAsDate = new Date();
    }
  }

  /**
   * Инициализация подсчёта людей
   */
  initPeopleCalculation() {
    const inputs = document.querySelectorAll('.people-input');
    
    inputs.forEach(input => {
      input.addEventListener('input', () => {
        DataManager.updateTotalPeople();
      });
    });
    
    DataManager.updateTotalPeople();
  }

  /**
   * Обработчики формы ввода
   */
  bindFormHandlers() {
    const form = document.getElementById('reportForm');
    const submitBtn = document.getElementById('submitBtn');
    
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Блокируем кнопку
      submitBtn.disabled = true;
      UI.showStatus('Отправка...', 'info');
      
      // Собираем данные
      const data = DataManager.gatherFormData();
      
      // Валидируем
      const errors = DataManager.validate(data);
      if (errors.length > 0) {
        UI.showStatus(errors.join('; '), 'error');
        submitBtn.disabled = false;
        return;
      }
      
      try {
        console.log('=== ОТПРАВКА ДАННЫХ ===');
        console.log('URL:', CONFIG.appsScriptUrl);
        console.log('Данные:', JSON.stringify(data, null, 2));
        
        // Отправляем через storage
        const result = await this.storage.save(data);
        console.log('Результат:', result);
        
        if (result && result.result === 'error') {
          UI.showStatus(result.message || 'Ошибка сервера', 'error');
        } else {
          UI.showStatus('✓ Отправлено в Google Sheets! Проверьте таблицу.', 'success');
        }
      } catch (error) {
        console.error('Ошибка:', error);
        UI.showStatus('Ошибка: ' + error.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  /**
   * Обработчики для режима просмотра
   */
  bindViewHandlers() {
    // Применить фильтры
    const applyBtn = document.getElementById('applyFilters');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        this.applyFilters();
      });
    }
    
    // Сбросить фильтры
    const resetBtn = document.getElementById('resetFilters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetFilters();
      });
    }
    
    // Кнопка добавления новой записи
    const addBtn = document.getElementById('addNewBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.openEditModal();
      });
    }
    
    // Кнопка обновления
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadData();
      });
    }
    
    // Кнопка экспорта
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        this.exportData();
      });
    }
    
    // Делегирование событий для таблицы
    const tableContainer = document.getElementById('tableContainer');
    if (tableContainer) {
      tableContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        
        if (action === 'edit') {
          this.editRecord(id);
        } else if (action === 'delete') {
          this.deleteRecord(id);
        }
      });
    }
  }

  /**
   * Загружает данные для просмотра
   */
  async loadData() {
    const container = document.getElementById('tableContainer');
    const summary = document.getElementById('summary');
    
    UI.showLoading(container, 'Загрузка данных...');
    summary.innerHTML = '';
    
    try {
      const data = await this.storage.load();
      this.dataManager.data = data;
      this.renderTable(data);
      
      const statusEl = document.getElementById('viewStatus');
      UI.showStatus(
        `✅ Данные загружены из Google Sheets (${data.length} записей)`,
        'success',
        statusEl
      );
    } catch (error) {
      UI.showError(container, `Ошибка загрузки: ${error.message}`);
    }
  }

  /**
   * Отображает таблицу
   */
  renderTable(data) {
    const container = document.getElementById('tableContainer');
    const summary = document.getElementById('summary');
    
    container.innerHTML = UI.createDataTable(data, {
      editable: true,
      onEdit: (id) => this.editRecord(id),
      onDelete: (id) => this.deleteRecord(id)
    });
    
    summary.innerHTML = `
      <span>Всего записей: <strong>${data.length}</strong></span>
      <span>Последнее обновление: ${new Date().toLocaleTimeString()}</span>
    `;
  }

  /**
   * Применяет фильтры
   */
  applyFilters() {
    const filters = {
      dateFrom: document.getElementById('dateFrom').value,
      dateTo: document.getElementById('dateTo').value,
      shift: document.getElementById('filterShift').value,
      shop: document.getElementById('filterShop').value.trim(),
      master: document.getElementById('filterMaster').value.trim()
    };
    
    const filtered = this.dataManager.filter(filters);
    this.renderTable(filtered);
  }

  /**
   * Сбрасывает фильтры
   */
  resetFilters() {
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    document.getElementById('filterShift').value = '';
    document.getElementById('filterShop').value = '';
    document.getElementById('filterMaster').value = '';
    
    this.renderTable(this.dataManager.data);
  }

  /**
   * Открывает модальное окно редактирования
   */
  openEditModal(data = null) {
    const modal = UI.createEditModal(data);
    
    // Обработчики модального окна
    modal.addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      
      if (action === 'close' || e.target === modal) {
        UI.closeModal();
      } else if (action === 'save') {
        await this.saveEditForm();
      }
    });
    
    // Закрытие по Escape
    const closeOnEscape = (e) => {
      if (e.key === 'Escape') {
        UI.closeModal();
        document.removeEventListener('keydown', closeOnEscape);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
  }

  /**
   * Редактирует запись
   */
  editRecord(id) {
    const record = this.dataManager.data.find(r => 
      (r.id || r.ID || r['ID']) == id
    );
    
    if (record) {
      this.openEditModal(record);
    } else {
      console.error('Запись не найдена:', id, this.dataManager.data);
    }
  }

  /**
   * Сохраняет форму редактирования
   */
  async saveEditForm() {
    const data = UI.gatherEditFormData();
    
    // Валидация
    if (!data.date || !data.shift || !data.shop || !data.master) {
      alert('Пожалуйста, заполните обязательные поля: Дата, Смена, Цех, ФИО мастера');
      return;
    }
    
    const isEdit = !!data.id;
    
    try {
      const result = await this.storage.save(data);
      console.log('Результат сохранения:', result);
      
      UI.closeModal();
      
      // Перезагружаем данные
      await this.loadData();
      
      // Показываем уведомление
      const actionText = isEdit ? 'обновлена' : 'добавлена';
      UI.showStatus(`Запись ${actionText} в Google Sheets!`, 'success', document.getElementById('viewStatus'));
    } catch (error) {
      console.error('Ошибка сохранения:', error);
      UI.closeModal();
      UI.showStatus('Ошибка сохранения: ' + error.message, 'error', document.getElementById('viewStatus'));
    }
  }

  /**
   * Удаляет запись
   */
  async deleteRecord(id) {
    const confirmed = await UI.confirm('Вы уверены, что хотите удалить эту запись?');
    
    if (confirmed) {
      try {
        await this.storage.delete(id);
        await this.loadData();
        UI.showStatus('Запись удалена', 'success', document.getElementById('viewStatus'));
      } catch (error) {
        alert('Ошибка удаления: ' + error.message);
      }
    }
  }

  /**
   * Экспортирует данные в CSV
   */
  exportData() {
    const csv = this.storage.exportToCSV();
    if (!csv) {
      alert('Нет данных для экспорта');
      return;
    }
    
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `otchet_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    
    UI.showStatus('Данные экспортированы', 'success', document.getElementById('viewStatus'));
  }
}

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  
  // Проверяем hash для начального режима
  const hash = window.location.hash.slice(1);
  if (hash === 'view') {
    window.app.switchMode('view');
  }
});

export default App;
