/**
 * Главный модуль приложения (оптимизированная версия)
 */
import CONFIG from './config.js';
import { DataManager } from './data.js';
import { UI } from './ui.js';
import { Storage } from './storage.js';
import { indexedCache } from './cache.js';

class App {
  constructor() {
    this.dataManager = new DataManager();
    this.storage = new Storage();
    this.currentMode = 'input';
    this.pagination = {
      pageSize: 10,
      currentPage: 0,
      allData: []
    };
    this.charts = {};
    this.chartDataHash = null; // Для кэширования графиков
    this.isSubmitting = false;
    
    // Debounce таймеры
    this.resizeTimer = null;
    this.scrollTimeout = null;
    
    this.init();
  }

  /**
   * Инициализация приложения с requestIdleCallback
   */
  init() {
    // Критичный путь
    this.bindModeSwitcher();
    this.bindFormHandlers();
    this.setDefaultDate();
    
    // Не критичное - откладываем
    const scheduleWork = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
    
    scheduleWork(() => {
      this.initPeopleCalculation();
      this.bindViewHandlers();
      this.preloadData();
    }, { timeout: 2000 });
    
    // Оптимизированные обработчики resize/orientation
    this.setupOptimizedListeners();
  }
  
  /**
   * Оптимизированные слушатели событий
   */
  setupOptimizedListeners() {
    // Throttle для resize
    window.addEventListener('resize', () => {
      if (this.resizeTimer) return;
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        this.handleResize();
      }, 100);
    }, { passive: true });
    
    // Throttle для скролла (60fps)
    window.addEventListener('scroll', () => {
      if (this.scrollTimeout) return;
      this.scrollTimeout = setTimeout(() => {
        this.scrollTimeout = null;
      }, 16);
    }, { passive: true });
  }
  
  handleResize() {
    // Обновляем графики при изменении размера
    if (this.currentMode === 'reports') {
      Object.values(this.charts).forEach(chart => {
        if (chart) chart.resize();
      });
    }
  }
  
  /**
   * Предзагрузка данных в фоне
   */
  async preloadData() {
    try {
      // Проверяем IndexedDB сначала
      const isCacheValid = await indexedCache.isValid();
      if (isCacheValid) {
        this.storage.data = await indexedCache.getRecords();
        // Data preloaded
      } else {
        await this.storage.load();
        // Сохраняем в IndexedDB для будущего использования
        await indexedCache.setRecords(this.storage.data);
      }
    } catch (e) {
      // Игнорируем ошибки фоновой загрузки
    }
  }

  /**
   * Переключение режимов
   */
  bindModeSwitcher() {
    const buttons = document.querySelectorAll('.mode-btn');
    
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.switchMode(mode);
      });
    }
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
    
    if (mode === 'view') {
      this.loadData();
    } else if (mode === 'reports') {
      this.loadReportData();
    } else {
      this.destroyCharts();
    }
    
    window.location.hash = mode;
  }

  /**
   * Уничтожает все графики для экономии памяти
   */
  destroyCharts() {
    Object.keys(this.charts).forEach(key => {
      if (this.charts[key]) {
        this.charts[key].destroy();
        this.charts[key] = null;
      }
    });
    this.chartDataHash = null;
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
   * Инициализация подсчёта людей с debounce
   */
  initPeopleCalculation() {
    const inputs = document.querySelectorAll('.people-input');
    
    for (const input of inputs) {
      input.addEventListener('input', () => {
        DataManager.updateTotalPeople();
      });
    }
    
    DataManager.updateTotalPeople();
  }

  /**
   * Обработчики формы ввода с защитой от двойной отправки
   */
  bindFormHandlers() {
    const form = document.getElementById('reportForm');
    const submitBtn = document.getElementById('submitBtn');
    
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (this.isSubmitting) return;
      this.isSubmitting = true;
      
      submitBtn.disabled = true;
      UI.showStatus('Отправка...', 'info');
      
      const data = DataManager.gatherFormData();
      
      const errors = DataManager.validate(data);
      if (errors.length > 0) {
        UI.showStatus(errors.join('; '), 'error');
        submitBtn.disabled = false;
        this.isSubmitting = false;
        return;
      }
      
      // Показываем индикатор загрузки
      UI.setButtonLoading(submitBtn, true, 'Сохранение...');
      
      try {
        const result = await this.storage.save(data);
        
        if (result && result.result === 'error') {
          UI.showStatus(result.message || 'Ошибка сервера', 'error');
        } else {
          UI.showStatus('✓ Отправлено в Google Sheets!', 'success');
          form.reset();
          this.setDefaultDate();
          DataManager.updateTotalPeople();
          
          // Инвалидируем кэши
          await indexedCache.clear();
        }
      } catch (error) {
        UI.showStatus('Ошибка: ' + error.message, 'error');
      } finally {
        UI.setButtonLoading(submitBtn, false);
        this.isSubmitting = false;
      }
    });
  }

  /**
   * Обработчики для режима просмотра
   */
  bindViewHandlers() {
    const applyBtn = document.getElementById('applyFilters');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => this.applyFilters());
    }
    
    const resetBtn = document.getElementById('resetFilters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetFilters());
    }
    
    const addBtn = document.getElementById('addNewBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.openEditModal());
    }
    
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.storage.clearCache();
        indexedCache.clear();
        this.loadData();
      });
    }
    
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportData());
    }
    
    // Кнопка компактного вида
    const compactBtn = document.getElementById('compactViewBtn');
    if (compactBtn) {
      // Восстанавливаем состояние
      this.restoreCompactLevel();
      
      compactBtn.addEventListener('click', () => {
        this.cycleCompactLevel();
      });
    }
  }
  
  /**
   * Циклическое переключение уровней сжатия таблицы
   * Уровни: 0 (обычный) → 1 (-30%) → 2 (-50%) → 3 (-70%) → 0
   */
  cycleCompactLevel() {
    const table = document.querySelector('.data-table');
    const btn = document.getElementById('compactViewBtn');
    const btnText = btn?.querySelector('.btn-text');
    
    if (!table) return;
    
    // Получаем текущий уровень (0-3)
    let level = parseInt(localStorage.getItem('compactLevel') || '0');
    
    // Переходим к следующему уровню
    level = (level + 1) % 4;
    
    // Удаляем все классы сжатия
    table.classList.remove('compact-view-1', 'compact-view-2', 'compact-view-3');
    btn?.classList.remove('active');
    
    // Применяем новый уровень
    const labels = ['Стандарт', 'Компактно 1', 'Компактно 2', 'Мини'];
    
    if (level > 0) {
      table.classList.add(`compact-view-${level}`);
      btn?.classList.add('active');
    }
    
    if (btnText) {
      btnText.textContent = labels[level];
    }
    
    localStorage.setItem('compactLevel', level.toString());
  }
  
  /**
   * Восстанавливает уровень сжатия из localStorage
   */
  restoreCompactLevel() {
    const level = parseInt(localStorage.getItem('compactLevel') || '0');
    if (level > 0) {
      const table = document.querySelector('.data-table');
      const btn = document.getElementById('compactViewBtn');
      const btnText = btn?.querySelector('.btn-text');
      
      if (table) {
        table.classList.add(`compact-view-${level}`);
      }
      btn?.classList.add('active');
      
      const labels = ['Стандарт', 'Компактно 1', 'Компактно 2', 'Мини'];
      if (btnText) {
        btnText.textContent = labels[level];
      }
    }
  }

  /**
   * Загружает данные с использованием кэша
   */
  async loadData() {
    const container = document.getElementById('tableContainer');
    const summary = document.getElementById('summary');
    
    UI.showLoading(container, 'Загрузка данных...');
    if (summary) summary.innerHTML = '';
    
    try {
      // Проверяем IndexedDB
      const isCacheValid = await indexedCache.isValid();
      if (isCacheValid && this.storage.data.length === 0) {
        this.storage.data = await indexedCache.getRecords();
      }
      
      const data = await this.storage.load();
      
      // Сохраняем в IndexedDB
      await indexedCache.setRecords(data);
      
      this.pagination.allData = data;
      this.pagination.currentPage = 0;
      this.dataManager.data = data;
      
      this.renderPaginatedTable();
      
      const statusEl = document.getElementById('viewStatus');
      UI.showStatus(
        `✅ Данные загружены (${data.length} записей)`,
        'success',
        statusEl
      );
    } catch (error) {
      UI.showError(container, `Ошибка загрузки: ${error.message}`);
      this.pagination.allData = [];
      this.dataManager.data = [];
    }
  }

  /**
   * Отображает таблицу с пагинацией (оптимизированная)
   */
  renderPaginatedTable() {
    const container = document.getElementById('tableContainer');
    const summary = document.getElementById('summary');
    const loadMoreContainer = document.getElementById('loadMoreContainer');
    
    const allData = this.pagination.allData;
    const pageSize = this.pagination.pageSize;
    const currentPage = this.pagination.currentPage;
    
    // Ограничиваем максимальное количество отображаемых записей
    const MAX_DISPLAY_RECORDS = 100;
    
    let startIndex = Math.max(0, allData.length - (currentPage + 1) * pageSize);
    let endIndex = allData.length;
    
    if (endIndex - startIndex > MAX_DISPLAY_RECORDS) {
      startIndex = endIndex - MAX_DISPLAY_RECORDS;
    }
    
    const displayData = allData.slice(startIndex, endIndex);
    const reversedData = [...displayData].reverse(); // Создаём копию перед reverse
    
    container.innerHTML = UI.createDataTable(reversedData, {
      editable: true,
      onEdit: (id) => this.editRecord(id),
      onDelete: (id) => this.deleteRecord(id)
    });
    
    if (loadMoreContainer) {
      const hasMore = startIndex > 0;
      loadMoreContainer.style.display = hasMore ? 'block' : 'none';
    }
    
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.onclick = () => {
        this.pagination.currentPage++;
        this.renderPaginatedTable();
      };
    }
    
    if (summary) {
      summary.innerHTML = `
        <span>Всего записей: <strong>${allData.length}</strong></span>
        <span>Последнее обновление: ${new Date().toLocaleTimeString()}</span>
      `;
    }
  }

  /**
   * Применяет фильтры
   */
  async applyFilters() {
    const filters = {
      dateFrom: document.getElementById('dateFrom').value,
      dateTo: document.getElementById('dateTo').value,
      shift: document.getElementById('filterShift').value,
      shop: document.getElementById('filterShop').value.trim(),
      master: document.getElementById('filterMaster').value.trim()
    };
    
    const filtered = await this.dataManager.filter(filters);
    
    const container = document.getElementById('tableContainer');
    container.innerHTML = UI.createDataTable(filtered, {
      editable: true,
      onEdit: (id) => this.editRecord(id),
      onDelete: (id) => this.deleteRecord(id)
    });
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
    
    this.renderPaginatedTable();
  }

  /**
   * Модальное окно редактирования
   */
  openEditModal(data = null) {
    const existingModal = document.getElementById('editModal');
    if (existingModal) {
      existingModal.remove();
    }
    
    const modal = UI.createEditModal(data);
    
    const clickHandler = async (e) => {
      const action = e.target.dataset.action;
      
      if (action === 'close' || e.target === modal) {
        modal.removeEventListener('click', clickHandler);
        UI.closeModal();
      } else if (action === 'save') {
        modal.removeEventListener('click', clickHandler);
        await this.saveEditForm();
      }
    };
    
    modal.addEventListener('click', clickHandler);
    
    const closeOnEscape = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', closeOnEscape);
        UI.closeModal();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
  }

  editRecord(id) {
    const record = this.dataManager.data.find(r => 
      (r.id || r.ID || r['ID']) == id
    );
    
    if (record) {
      this.openEditModal(record);
    }
  }

  async saveEditForm() {
    let data;
    
    try {
      data = UI.gatherEditFormData();
    } catch (error) {
      alert('Ошибка валидации: ' + error.message);
      return;
    }
    
    if (!data.date || !data.shift || !data.shop || !data.master) {
      alert('Пожалуйста, заполните обязательные поля');
      return;
    }
    
    const isEdit = !!data.id;
    const saveBtn = document.getElementById('modalSaveBtn');
    const modalBody = document.querySelector('.modal-body');
    
    // Показываем индикатор загрузки
    if (saveBtn) UI.setButtonLoading(saveBtn, true, 'Сохранение...');
    const overlay = UI.showLoadingOverlay(modalBody, 'Сохранение данных...');
    
    try {
      const result = await this.storage.save(data);
      
      UI.closeModal();
      await this.loadData();
      
      const actionText = isEdit ? 'обновлена' : 'добавлена';
      UI.showStatus(`Запись ${actionText}!`, 'success', document.getElementById('viewStatus'));
      
      // Инвалидируем кэши
      await indexedCache.clear();
    } catch (error) {
      UI.hideLoadingOverlay(modalBody);
      if (saveBtn) UI.setButtonLoading(saveBtn, false);
      UI.showStatus('Ошибка сохранения: ' + error.message, 'error', document.getElementById('viewStatus'));
    }
  }

  async deleteRecord(id) {
    const confirmed = await UI.confirm('Вы уверены, что хотите удалить эту запись?');
    
    if (confirmed) {
      const container = document.getElementById('tableContainer');
      const overlay = UI.showLoadingOverlay(container, 'Удаление записи...');
      
      try {
        await this.storage.delete(id);
        await this.loadData();
        UI.showStatus('Запись удалена', 'success', document.getElementById('viewStatus'));
        await indexedCache.clear();
      } catch (error) {
        UI.hideLoadingOverlay(container);
        alert('Ошибка удаления: ' + error.message);
      }
    }
  }

  exportData() {
    const csv = this.storage.exportToCSV();
    if (!csv) {
      alert('Нет данных для экспорта');
      return;
    }
    
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `otchet_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    
    // Освобождаем память
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    
    UI.showStatus('Данные экспортированы', 'success', document.getElementById('viewStatus'));
  }

  // ==================== ОТЧЁТЫ И ГРАФИКИ ====================

  /**
   * Загружает данные для отчётов
   */
  async loadReportData() {
    const today = new Date();
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    
    const reportDateTo = document.getElementById('reportDateTo');
    const reportDateFrom = document.getElementById('reportDateFrom');
    
    if (reportDateTo) reportDateTo.valueAsDate = today;
    if (reportDateFrom) reportDateFrom.valueAsDate = monthAgo;
    
    const generateBtn = document.getElementById('generateReports');
    if (generateBtn) {
      generateBtn.onclick = () => this.generateReports();
    }
    
    // Кнопка сброса фильтров отчетов
    const resetReportBtn = document.getElementById('resetReportFilters');
    if (resetReportBtn) {
      resetReportBtn.onclick = () => this.resetReportFilters();
    }
    
    // Используем requestIdleCallback для не критичных операций
    const scheduleWork = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
    
    scheduleWork(async () => {
      try {
        await this.storage.load();
        this.generateReports();
      } catch (error) {
        // Игнорируем ошибки
      }
    });
  }

  /**
   * Парсит дату
   */
  parseDate(dateStr) {
    if (!dateStr) return null;
    
    if (dateStr.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
      const [d, m, y] = dateStr.split('.');
      return new Date(y, m - 1, d);
    }
    
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return new Date(dateStr);
    }
    
    if (dateStr.includes('T')) {
      return new Date(dateStr);
    }
    
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Фильтрует данные
   */
  filterReportData(data) {
    const dateFrom = document.getElementById('reportDateFrom')?.value;
    const dateTo = document.getElementById('reportDateTo')?.value;
    const shift = document.getElementById('reportShift')?.value;
    
    return data.filter(row => {
      const rowDateStr = row.date || row.Дата || row['ДАТА'];
      if (!rowDateStr) return false;
      
      const rowDate = this.parseDate(rowDateStr);
      if (!rowDate) return false;
      
      if (dateFrom) {
        const from = this.parseDate(dateFrom);
        from.setHours(0, 0, 0, 0);
        if (rowDate < from) return false;
      }
      
      if (dateTo) {
        const to = this.parseDate(dateTo);
        to.setHours(23, 59, 59, 999);
        if (rowDate > to) return false;
      }
      
      if (shift) {
        const rowShift = row.shift || row.Смена || row['СМЕНА'];
        if (String(rowShift) !== String(shift)) return false;
      }
      
      return true;
    });
  }

  /**
   * Сбрасывает фильтры отчетов
   */
  resetReportFilters() {
    const today = new Date();
    const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
    
    document.getElementById('reportDateFrom').valueAsDate = monthAgo;
    document.getElementById('reportDateTo').valueAsDate = today;
    document.getElementById('reportShift').value = '';
    
    this.generateReports();
  }

  /**
   * Хелпер для получения значения
   */
  getValue(row, ...fields) {
    for (const f of fields) {
      if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
        const rawVal = row[f];
        const val = typeof rawVal === 'number' ? rawVal : Number(String(rawVal).replace(',', '.'));
        return isNaN(val) ? 0 : val;
      }
    }
    
    // Поиск по совпадению части ключа
    const rowKeys = Object.keys(row);
    for (const f of fields) {
      const lowerF = f.toLowerCase();
      const matchingKey = rowKeys.find(k => k.toLowerCase() === lowerF || 
        k.toLowerCase().includes(lowerF.replace(/_/g, '')));
      if (matchingKey !== undefined && row[matchingKey] !== null && row[matchingKey] !== '') {
        const rawVal = row[matchingKey];
        const val = typeof rawVal === 'number' ? rawVal : Number(String(rawVal).replace(',', '.'));
        return isNaN(val) ? 0 : val;
      }
    }
    
    return 0;
  }

  /**
   * Хэш данных для кэширования графиков
   */
  hashData(data) {
    // Простой хэш на основе количества и первой/последней записи
    if (data.length === 0) return 'empty';
    const first = data[0].id || data[0].ID || '';
    const last = data[data.length - 1].id || data[data.length - 1].ID || '';
    return `${data.length}-${first}-${last}`;
  }

  /**
   * Downsampling для больших периодов
   */
  downsampleData(data, maxPoints = 30) {
    if (data.length <= maxPoints) return data;
    
    const step = Math.ceil(data.length / maxPoints);
    const result = [];
    
    for (let i = 0; i < data.length; i += step) {
      const window = data.slice(i, i + step);
      result.push(this.aggregateWindow(window));
    }
    
    return result;
  }

  aggregateWindow(window) {
    const result = { ...window[0] };
    const numericFields = ['plasma_sheets', 'strozka_segments', 'avtosvarka_cards', 'unloaded', 'loaded', 'small_furnace', 'large_furnace'];
    
    for (const field of numericFields) {
      result[field] = window.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
    }
    
    return result;
  }

  /**
   * Генерирует отчёты
   */
  async generateReports() {
    let allData = this.storage.data || [];
    
    if (allData.length === 0) {
      try {
        await this.storage.load();
        allData = this.storage.data || [];
      } catch (error) {
        alert('Нет данных для формирования отчётов');
        return;
      }
    }
    
    if (allData.length === 0) {
      alert('Нет данных для формирования отчётов');
      return;
    }
    
    const filteredData = this.filterReportData(allData);
    
    if (filteredData.length === 0) {
      alert('Нет данных для выбранного периода');
      return;
    }
    
    // Проверяем, изменились ли данные
    const newHash = this.hashData(filteredData);
    const dataChanged = newHash !== this.chartDataHash;
    this.chartDataHash = newHash;
    
    // Сортируем по дате
    const sortedData = [...filteredData].sort((a, b) => {
      const dateA = this.parseDate(a.date || a.Дата || a['ДАТА']);
      const dateB = this.parseDate(b.date || b.Дата || b['ДАТА']);
      return dateA - dateB;
    });
    
    // Downsampling если много данных
    const optimizedData = sortedData.length > 50 ? this.downsampleData(sortedData) : sortedData;
    
    // Ленивая загрузка графиков через Intersection Observer
    this.renderChartsLazy(optimizedData, dataChanged);
    this.createBreakdownsReport(sortedData);
  }

  /**
   * Ленивая загрузка графиков
   */
  renderChartsLazy(data, dataChanged) {
    const chartsConfig = [
      { id: 'productionChart', fn: () => this.createProductionChart(data, dataChanged) },
      { id: 'logisticsChart', fn: () => this.createLogisticsChart(data, dataChanged) },
      { id: 'furnaceChart', fn: () => this.createFurnaceChart(data, dataChanged) },
      { id: 'endsChart', fn: () => this.createEndsChart(data, dataChanged) },
    ];
    
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const chart = chartsConfig.find(c => c.id === entry.target.id);
            if (chart) {
              chart.fn();
              observer.unobserve(entry.target);
            }
          }
        });
      }, { rootMargin: '100px' });
      
      chartsConfig.forEach(chart => {
        const canvas = document.getElementById(chart.id);
        if (canvas) observer.observe(canvas);
      });
    } else {
      chartsConfig.forEach(chart => chart.fn());
    }
  }

  formatChartDate(dateStr) {
    if (!dateStr) return '';
    
    if (typeof dateStr === 'string' && dateStr.includes('T')) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      }
    }
    
    const date = this.parseDate(dateStr);
    if (!date) return dateStr;
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  createProductionChart(data, dataChanged) {
    const ctx = document.getElementById('productionChart');
    if (!ctx) return;
    
    const labels = data.map(d => this.formatChartDate(d.date || d.Дата || d['ДАТА']));
    const plasmaData = data.map(d => this.getValue(d, 'plasma_sheets', 'ПЛАЗМА_ЛИСТЫ'));
    const strozkaData = data.map(d => this.getValue(d, 'strozka_segments', 'СТРОЖКА_ОТСТРОГАНО_СЕГМЕНТОВ'));
    const svarkaData = data.map(d => this.getValue(d, 'avtosvarka_cards', 'АВТ_СВАРКА_ЗАВАРЕНО_КАРТ'));
    const poloterData = data.map(d => this.getValue(d, 'poloter_cleaned', 'ПОЛОТЕР_ПОЧИЩЕНО_КАРТ'));
    const zachistkaData = data.map(d => this.getValue(d, 'zachistka_cleaned', 'ЗАЧИСТКА_ПОД_СВАРКУ_ПОЧИЩЕНО_КАРТ'));
    
    // Обновляем существующий или создаём новый
    if (this.charts.production && !dataChanged) {
      return; // Данные не изменились
    }
    
    if (this.charts.production) {
      this.charts.production.data.labels = labels;
      this.charts.production.data.datasets[0].data = plasmaData;
      this.charts.production.data.datasets[1].data = strozkaData;
      this.charts.production.data.datasets[2].data = svarkaData;
      this.charts.production.data.datasets[3].data = poloterData;
      this.charts.production.data.datasets[4].data = zachistkaData;
      this.charts.production.update('none');
      return;
    }
    
    this.charts.production = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Плазма (листы)', data: plasmaData, backgroundColor: '#FF6384', borderRadius: 4 },
          { label: 'Строжка (сегменты)', data: strozkaData, backgroundColor: '#36A2EB', borderRadius: 4 },
          { label: 'Авт. сварка (карты)', data: svarkaData, backgroundColor: '#FFCE56', borderRadius: 4 },
          { label: 'Полотер (карты)', data: poloterData, backgroundColor: '#4BC0C0', borderRadius: 4 },
          { label: 'Зачистка (карты)', data: zachistkaData, backgroundColor: '#9966FF', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // Отключаем анимацию для производительности
        plugins: {
          title: { display: true, text: 'Производственные показатели по дням', font: { size: 16 } }
        },
        scales: {
          x: { title: { display: true, text: 'Дата' }, grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: 'Количество' } }
        },
        decimation: {
          enabled: true,
          algorithm: 'lttb',
          samples: 30
        }
      }
    });
  }

  createLogisticsChart(data, dataChanged) {
    const ctx = document.getElementById('logisticsChart');
    if (!ctx) return;
    
    const labels = data.map(d => this.formatChartDate(d.date || d.Дата || d['ДАТА']));
    const unloadedData = data.map(d => this.getValue(d, 'unloaded', 'РАЗГРУЖЕННЫХ_МАШИН'));
    const loadedData = data.map(d => this.getValue(d, 'loaded', 'ОТГРУЖЕННЫХ_МАШИН'));
    
    if (this.charts.logistics && !dataChanged) return;
    
    if (this.charts.logistics) {
      this.charts.logistics.data.labels = labels;
      this.charts.logistics.data.datasets[0].data = unloadedData;
      this.charts.logistics.data.datasets[1].data = loadedData;
      this.charts.logistics.update('none');
      return;
    }
    
    this.charts.logistics = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Разгружено', data: unloadedData, borderColor: '#FF6384', fill: false, tension: 0.3 },
          { label: 'Отгружено', data: loadedData, borderColor: '#36A2EB', fill: false, tension: 0.3 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { title: { display: true, text: 'Логистика (машины)', font: { size: 16 } } },
        scales: {
          x: { title: { display: true, text: 'Дата' }, grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: 'Количество машин' } }
        }
      }
    });
  }

  createFurnaceChart(data, dataChanged) {
    let ctx = document.getElementById('furnaceChart');
    if (!ctx) {
      const container = document.getElementById('furnaceChartContainer');
      if (!container) return;
      ctx = document.createElement('canvas');
      ctx.id = 'furnaceChart';
      container.appendChild(ctx);
    }
    
    if (this.charts.furnace && !dataChanged) return;
    
    const labels = data.map(d => this.formatChartDate(d.date || d.Дата || d['ДАТА']));
    const smallData = data.map(d => this.getValue(d, 'small_furnace', 'САДОК_МАЛАЯ_ПЕЧЬ'));
    const largeData = data.map(d => this.getValue(d, 'large_furnace', 'САДОК_БОЛЬШАЯ_ПЕЧЬ'));
    
    if (this.charts.furnace) {
      this.charts.furnace.data.labels = labels;
      this.charts.furnace.data.datasets[0].data = smallData;
      this.charts.furnace.data.datasets[1].data = largeData;
      this.charts.furnace.update('none');
      return;
    }
    
    this.charts.furnace = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Малая печь', data: smallData, borderColor: '#FFCE56', fill: false, tension: 0.3 },
          { label: 'Большая печь', data: largeData, borderColor: '#4BC0C0', fill: false, tension: 0.3 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { title: { display: true, text: 'Термообработка (садки)', font: { size: 16 } } },
        scales: {
          x: { title: { display: true, text: 'Дата' }, grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: 'Количество садок' } }
        }
      }
    });
  }

  createEndsChart(data, dataChanged) {
    const ctx = document.getElementById('endsChart');
    if (!ctx) return;
    
    if (this.charts.ends && !dataChanged) return;
    
    const totals = {
      'Пресс старый': 0, 'Итальянец': 0, 'Пресс новый': 0,
      'Комбинированные': 0, 'Ремонтные': 0, 'Отбортованные': 0, 'Обрезанные': 0, 'Упакованные': 0
    };
    
    for (const d of data) {
      totals['Пресс старый'] += this.getValue(d, 'stamped_old', 'ОТШТАМПОВАНО_ПРЕСС_СТАРЫЙ');
      totals['Итальянец'] += this.getValue(d, 'stamped_italy', 'ОТШТАМПОВАНО_ИТАЛЬЯНЕЦ');
      totals['Пресс новый'] += this.getValue(d, 'stamped_new', 'ОТШТАМПОВАНО_ПРЕСС_НОВЫЙ');
      totals['Комбинированные'] += this.getValue(d, 'combined', 'КОМБИНИРОВАННЫХ_ДНИЩ');
      totals['Ремонтные'] += this.getValue(d, 'repair', 'РЕМОНТНЫХ_ДНИЩ');
      totals['Отбортованные'] += this.getValue(d, 'flanged', 'ОТБОРТОВАННЫХ_ДНИЩ');
      totals['Обрезанные'] += this.getValue(d, 'trimmed', 'ОБРЕЗАННЫХ_ДНИЩ');
      totals['Упакованные'] += this.getValue(d, 'packed', 'УПАКОВАННЫХ_ДНИЩ');
    }
    
    const entries = Object.entries(totals).filter(([k, v]) => v > 0);
    
    if (entries.length === 0) {
      if (this.charts.ends) this.charts.ends.destroy();
      this.charts.ends = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Нет данных'], datasets: [{ data: [1], backgroundColor: ['#e0e0e0'] }] },
        options: { responsive: true, maintainAspectRatio: false }
      });
      return;
    }
    
    const labels = entries.map(([k]) => k);
    const values = entries.map(([k, v]) => v);
    const total = values.reduce((a, b) => a + b, 0);
    
    if (this.charts.ends) {
      this.charts.ends.data.labels = labels;
      this.charts.ends.data.datasets[0].data = values;
      this.charts.ends.update('none');
      return;
    }
    
    this.charts.ends = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF', '#7CFC00'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          title: { display: true, text: 'Распределение днищ', font: { size: 16 } },
          legend: {
            position: 'right',
            labels: {
              generateLabels: (chart) => {
                const dataset = chart.data.datasets[0];
                return chart.data.labels.map((label, i) => ({
                  text: `${label}: ${dataset.data[i]} (${((dataset.data[i] / total) * 100).toFixed(1)}%)`,
                  fillStyle: dataset.backgroundColor[i],
                  hidden: false,
                  index: i
                }));
              }
            }
          }
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
    
    const getText = (row, ...fields) => {
      for (const f of fields) {
        if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
          return String(row[f]);
        }
      }
      return '';
    };
    
    const breakdowns = data
      .filter(d => {
        const text = getText(d, 'breakdowns', 'Поломки', 'ПОЛОМКИ_И_ПРОСТОИ');
        return text && text.trim() !== '';
      })
      .map(d => ({
        date: this.formatChartDate(getText(d, 'date', 'Дата', 'ДАТА')),
        shift: getText(d, 'shift', 'Смена', 'СМЕНА'),
        text: getText(d, 'breakdowns', 'Поломки', 'ПОЛОМКИ_И_ПРОСТОИ')
      }));
    
    if (breakdowns.length === 0) {
      container.innerHTML = '<p class="empty-state">За выбранный период поломок не зарегистрировано</p>';
      return;
    }
    
    const html = [];
    html.push('<div class="breakdowns-list">');
    
    for (const b of breakdowns) {
      const safeDate = escapeHtml(b.date);
      const safeShift = escapeHtml(b.shift);
      const safeText = escapeHtml(b.text);
      
      html.push(`
        <div class="breakdown-item" style="padding: 15px; margin: 10px 0; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
          <div style="font-weight: bold; color: #856404; margin-bottom: 5px;">📅 ${safeDate} | Смена ${safeShift}</div>
          <div style="color: #856404;">${safeText}</div>
        </div>
      `);
    }
    
    html.push('</div>');
    container.innerHTML = html.join('');
  }
}

// Хелпер для экранирования
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  
  const hash = window.location.hash.slice(1);
  if (hash === 'view' || hash === 'reports') {
    window.app.switchMode(hash);
  }
  
  // Регистрация Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        // Проверяем обновления без принудительной перезагрузки
        registration.update().catch(() => {});
      })
      .catch(() => {});
  }
});

export default App;
