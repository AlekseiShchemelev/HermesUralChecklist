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
    this.currentMode = 'input'; // 'input', 'view' или 'reports'
    this.pagination = {
      pageSize: 10,
      currentPage: 0,
      allData: []
    };
    this.charts = {};
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
    
    // Если переключились на отчёты - загружаем данные для графиков
    if (mode === 'reports') {
      this.loadReportData();
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
   * Загружает данные для просмотра (с пагинацией)
   */
  async loadData() {
    const container = document.getElementById('tableContainer');
    const summary = document.getElementById('summary');
    
    UI.showLoading(container, 'Загрузка данных...');
    summary.innerHTML = '';
    
    try {
      const data = await this.storage.load();
      this.pagination.allData = data;
      this.pagination.currentPage = 0;
      this.dataManager.data = data;
      
      // Показываем последние 10 записей
      this.renderPaginatedTable();
      
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
   * Отображает таблицу с пагинацией (последние 10 записей)
   */
  renderPaginatedTable() {
    const container = document.getElementById('tableContainer');
    const summary = document.getElementById('summary');
    const loadMoreContainer = document.getElementById('loadMoreContainer');
    
    const allData = this.pagination.allData;
    const pageSize = this.pagination.pageSize;
    const currentPage = this.pagination.currentPage;
    
    // Берём последние N записей (с конца)
    const startIndex = Math.max(0, allData.length - (currentPage + 1) * pageSize);
    const endIndex = allData.length;
    const displayData = allData.slice(startIndex, endIndex);
    
    // Отображаем в обратном порядке (новые сверху)
    const reversedData = [...displayData].reverse();
    
    container.innerHTML = UI.createDataTable(reversedData, {
      editable: true,
      onEdit: (id) => this.editRecord(id),
      onDelete: (id) => this.deleteRecord(id)
    });
    
    // Показываем/скрываем кнопку "Загрузить ещё"
    const hasMore = startIndex > 0;
    loadMoreContainer.style.display = hasMore ? 'block' : 'none';
    
    // Добавляем обработчик на кнопку
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.onclick = () => {
        this.pagination.currentPage++;
        this.renderPaginatedTable();
      };
    }
    
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

  /**
   * Загружает данные для отчётов
   */
  async loadReportData() {
    // Устанавливаем даты по умолчанию (последние 30 дней)
    const today = new Date();
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    
    document.getElementById('reportDateTo').valueAsDate = today;
    document.getElementById('reportDateFrom').valueAsDate = monthAgo;
    
    // Загружаем данные
    try {
      await this.storage.load();
      
      // Привязываем обработчик кнопки
      const generateBtn = document.getElementById('generateReports');
      if (generateBtn) {
        generateBtn.onclick = () => this.generateReports();
      }
    } catch (error) {
      console.error('Ошибка загрузки данных для отчётов:', error);
    }
  }

  /**
   * Фильтрует данные по периоду и смене
   */
  filterReportData(data) {
    const dateFrom = document.getElementById('reportDateFrom').value;
    const dateTo = document.getElementById('reportDateTo').value;
    const shift = document.getElementById('reportShift').value;
    
    return data.filter(row => {
      // Фильтр по дате
      if (dateFrom || dateTo) {
        const rowDate = row.date || row.Дата;
        if (!rowDate) return false;
        
        const [d, m, y] = rowDate.split('.');
        const rowDateObj = new Date(y, m - 1, d);
        
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
      
      return true;
    });
  }

  /**
   * Генерирует отчёты и графики
   */
  async generateReports() {
    const allData = this.storage.data || [];
    const filteredData = this.filterReportData(allData);
    
    if (filteredData.length === 0) {
      alert('Нет данных для выбранного периода');
      return;
    }
    
    // График 1: Производственные показатели
    this.createProductionChart(filteredData);
    
    // График 2: Днища
    this.createEndsChart(filteredData);
    
    // График 3: Логистика
    this.createLogisticsChart(filteredData);
    
    // Отчёт по поломкам
    this.createBreakdownsReport(filteredData);
  }

  /**
   * График производственных показателей
   */
  createProductionChart(data) {
    const ctx = document.getElementById('productionChart');
    if (!ctx) return;
    
    // Уничтожаем старый график
    if (this.charts.production) {
      this.charts.production.destroy();
    }
    
    // Подготавливаем данные
    const labels = data.map(d => d.date || d.Дата).reverse();
    const plasmaData = data.map(d => Number(d.plasma_sheets || d['Плазма_листы']) || 0).reverse();
    const strozkaData = data.map(d => Number(d.strozka_segments || d['Строжка_сегменты']) || 0).reverse();
    const svarkaData = data.map(d => Number(d.avtosvarka_cards || d['Авт_сварка_карты']) || 0).reverse();
    const poloterData = data.map(d => Number(d.poloter_cleaned || d['Полотер_карты']) || 0).reverse();
    const zachistkaData = data.map(d => Number(d.zachistka_cleaned || d['Зачистка_карты']) || 0).reverse();
    
    this.charts.production = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Плазма (листы)', data: plasmaData, backgroundColor: '#FF6384' },
          { label: 'Строжка (сегменты)', data: strozkaData, backgroundColor: '#36A2EB' },
          { label: 'Авт. сварка (карты)', data: svarkaData, backgroundColor: '#FFCE56' },
          { label: 'Полотер (карты)', data: poloterData, backgroundColor: '#4BC0C0' },
          { label: 'Зачистка (карты)', data: zachistkaData, backgroundColor: '#9966FF' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: 'Производственные показатели по дням' }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  /**
   * График учёта днищ
   */
  createEndsChart(data) {
    const ctx = document.getElementById('endsChart');
    if (!ctx) return;
    
    if (this.charts.ends) {
      this.charts.ends.destroy();
    }
    
    // Суммируем данные по типам днищ
    const totals = {
      'Пресс старый': 0,
      'Итальянец': 0,
      'Пресс новый': 0,
      'Комбинированные': 0,
      'Ремонтные': 0,
      'Отбортованные': 0,
      'Обрезанные': 0,
      'Упакованные': 0
    };
    
    data.forEach(d => {
      totals['Пресс старый'] += Number(d.stamped_old || d['Штамп_старый']) || 0;
      totals['Итальянец'] += Number(d.stamped_italy || d['Штамп_италия']) || 0;
      totals['Пресс новый'] += Number(d.stamped_new || d['Штамп_новый']) || 0;
      totals['Комбинированные'] += Number(d.combined || d['Комбинированные']) || 0;
      totals['Ремонтные'] += Number(d.repair || d['Ремонтные']) || 0;
      totals['Отбортованные'] += Number(d.flanged || d['Отбортованные']) || 0;
      totals['Обрезанные'] += Number(d.trimmed || d['Обрезанные']) || 0;
      totals['Упакованные'] += Number(d.packed || d['Упакованные']) || 0;
    });
    
    this.charts.ends = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(totals),
        datasets: [{
          data: Object.values(totals),
          backgroundColor: [
            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
            '#9966FF', '#FF9F40', '#C9CBCF', '#7CFC00'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: 'Распределение днищ за период' },
          legend: { position: 'right' }
        }
      }
    });
  }

  /**
   * График логистики
   */
  createLogisticsChart(data) {
    const ctx = document.getElementById('logisticsChart');
    if (!ctx) return;
    
    if (this.charts.logistics) {
      this.charts.logistics.destroy();
    }
    
    const labels = data.map(d => d.date || d.Дата).reverse();
    const unloadedData = data.map(d => Number(d.unloaded || d['Разгружено']) || 0).reverse();
    const loadedData = data.map(d => Number(d.loaded || d['Отгружено']) || 0).reverse();
    const smallFurnaceData = data.map(d => Number(d.small_furnace || d['Малая_печь']) || 0).reverse();
    const largeFurnaceData = data.map(d => Number(d.large_furnace || d['Большая_печь']) || 0).reverse();
    
    this.charts.logistics = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Разгружено машин', data: unloadedData, borderColor: '#FF6384', fill: false },
          { label: 'Отгружено машин', data: loadedData, borderColor: '#36A2EB', fill: false },
          { label: 'Малая печь', data: smallFurnaceData, borderColor: '#FFCE56', fill: false },
          { label: 'Большая печь', data: largeFurnaceData, borderColor: '#4BC0C0', fill: false }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: 'Логистика и термообработка' }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  /**
   * Отчёт по поломкам
   */
  createBreakdownsReport(data) {
    const container = document.getElementById('breakdownsReport');
    if (!container) return;
    
    const breakdowns = data
      .filter(d => d.breakdowns || d['Поломки'])
      .map(d => ({
        date: d.date || d.Дата,
        shift: d.shift || d.Смена,
        text: d.breakdowns || d['Поломки']
      }));
    
    if (breakdowns.length === 0) {
      container.innerHTML = '<p class="empty-state">За выбранный период поломок не зарегистрировано</p>';
      return;
    }
    
    let html = '<div class="breakdowns-list">';
    breakdowns.forEach(b => {
      html += `
        <div class="breakdown-item" style="padding: 15px; margin: 10px 0; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
          <div style="font-weight: bold; color: #856404; margin-bottom: 5px;">
            📅 ${b.date} | Смена ${b.shift}
          </div>
          <div style="color: #856404;">${b.text}</div>
        </div>
      `;
    });
    html += '</div>';
    
    container.innerHTML = html;
  }
}

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  
  // Проверяем hash для начального режима
  const hash = window.location.hash.slice(1);
  if (hash === 'view' || hash === 'reports') {
    window.app.switchMode(hash);
  }
});

export default App;
