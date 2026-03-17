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
    } else {
      // Уничтожаем графики при уходе из раздела отчётов для экономии памяти
      this.destroyCharts();
    }
    
    // Обновляем URL hash
    window.location.hash = mode;
  }

  /**
   * Уничтожает все графики
   */
  destroyCharts() {
    Object.keys(this.charts).forEach(key => {
      if (this.charts[key]) {
        this.charts[key].destroy();
        this.charts[key] = null;
      }
    });
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
    
    // Флаг для защиты от двойной отправки
    this.isSubmitting = false;
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Защита от двойной отправки
      if (this.isSubmitting) return;
      this.isSubmitting = true;
      
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
        this.isSubmitting = false;
        return;
      }
      
      try {
        // Отправляем через storage
        const result = await this.storage.save(data);
        
        if (result && result.result === 'error') {
          UI.showStatus(result.message || 'Ошибка сервера', 'error');
        } else {
          UI.showStatus('✓ Отправлено в Google Sheets! Проверьте таблицу.', 'success');
          // Очищаем форму после успешной отправки
          form.reset();
          this.setDefaultDate();
          DataManager.updateTotalPeople();
        }
      } catch (error) {
        UI.showStatus('Ошибка: ' + error.message, 'error');
      } finally {
        submitBtn.disabled = false;
        this.isSubmitting = false;
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
    if (summary) summary.innerHTML = '';
    
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
      // При ошибке сбрасываем данные в пустой массив
      this.pagination.allData = [];
      this.dataManager.data = [];
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
    if (loadMoreContainer) {
      const hasMore = startIndex > 0;
      loadMoreContainer.style.display = hasMore ? 'block' : 'none';
    }
    
    // Добавляем обработчик на кнопку
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
   * Рендерит таблицу с данными
   */
  renderTable(data) {
    const container = document.getElementById('tableContainer');
    container.innerHTML = UI.createDataTable(data, {
      editable: true,
      onEdit: (id) => this.editRecord(id),
      onDelete: (id) => this.deleteRecord(id)
    });
  }

  /**
   * Открывает модальное окно редактирования
   */
  openEditModal(data = null) {
    // Удаляем существующее модальное окно если есть
    const existingModal = document.getElementById('editModal');
    if (existingModal) {
      existingModal.remove();
    }
    
    const modal = UI.createEditModal(data);
    
    // Обработчики модального окна
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
    
    // Закрытие по Escape
    const closeOnEscape = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', closeOnEscape);
        UI.closeModal();
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
    let data;
    
    try {
      data = UI.gatherEditFormData();
    } catch (error) {
      alert('Ошибка валидации: ' + error.message);
      return;
    }
    
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

  // ==================== ОТЧЁТЫ И ГРАФИКИ ====================

  /**
   * Загружает данные для отчётов
   */
  async loadReportData() {
    // Устанавливаем даты по умолчанию (последние 30 дней)
    const today = new Date();
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    
    const reportDateTo = document.getElementById('reportDateTo');
    const reportDateFrom = document.getElementById('reportDateFrom');
    
    if (reportDateTo) reportDateTo.valueAsDate = today;
    if (reportDateFrom) reportDateFrom.valueAsDate = monthAgo;
    
    // Привязываем обработчик кнопки
    const generateBtn = document.getElementById('generateReports');
    if (generateBtn) {
      generateBtn.onclick = () => this.generateReports();
    }
    
    // Автоматически генерируем отчёты при первом открытии
    try {
      await this.storage.load();
      this.generateReports();
    } catch (error) {
      console.error('Ошибка загрузки данных для отчётов:', error);
    }
  }

  /**
   * Парсит дату из различных форматов
   */
  parseDate(dateStr) {
    if (!dateStr) return null;
    
    // Формат DD.MM.YYYY (из Google Sheets)
    if (dateStr.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
      const [d, m, y] = dateStr.split('.');
      return new Date(y, m - 1, d);
    }
    
    // Формат YYYY-MM-DD (из input type="date")
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return new Date(dateStr);
    }
    
    // ISO формат
    if (dateStr.includes('T')) {
      return new Date(dateStr);
    }
    
    // Пробуем стандартный парсинг
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Фильтрует данные по периоду и смене
   */
  filterReportData(data) {
    const dateFrom = document.getElementById('reportDateFrom')?.value;
    const dateTo = document.getElementById('reportDateTo')?.value;
    const shift = document.getElementById('reportShift')?.value;
    
    return data.filter(row => {
      // Получаем дату записи (пробуем разные варианты названий полей)
      const rowDateStr = row.date || row.Дата || row['ДАТА'];
      if (!rowDateStr) return false;
      
      const rowDate = this.parseDate(rowDateStr);
      if (!rowDate) return false;
      
      // Фильтр по дате "от"
      if (dateFrom) {
        const from = this.parseDate(dateFrom);
        from.setHours(0, 0, 0, 0);
        if (rowDate < from) return false;
      }
      
      // Фильтр по дате "до"
      if (dateTo) {
        const to = this.parseDate(dateTo);
        to.setHours(23, 59, 59, 999);
        if (rowDate > to) return false;
      }
      
      // Фильтр по смене
      if (shift) {
        const rowShift = row.shift || row.Смена || row['СМЕНА'];
        if (String(rowShift) !== String(shift)) return false;
      }
      
      return true;
    });
  }

  /**
   * Хелпер для получения значения из данных (поддержка русских и английских ключей)
   */
  getValue(row, ...fields) {
    // Сначала ищем точное совпадение
    for (const f of fields) {
      if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
        const rawVal = row[f];
        const val = typeof rawVal === 'number' ? rawVal : Number(String(rawVal).replace(',', '.'));
        return isNaN(val) ? 0 : val;
      }
    }
    
    // Если не нашли - ищем по совпадению части ключа (case-insensitive)
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
   * Генерирует отчёты и графики
   */
  async generateReports() {
    let allData = this.storage.data || [];
    
    // Если данных нет - загружаем
    if (allData.length === 0) {
      try {
        await this.storage.load();
        allData = this.storage.data || [];
      } catch (error) {
        console.error('Ошибка загрузки данных:', error);
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
    
    // Сортируем по дате (от старых к новым для графиков)
    const sortedData = [...filteredData].sort((a, b) => {
      const dateA = this.parseDate(a.date || a.Дата || a['ДАТА']);
      const dateB = this.parseDate(b.date || b.Дата || b['ДАТА']);
      return dateA - dateB;
    });
    
    // Уникальные даты для оси X (без форматирования - используем оригинальные строки)
    const uniqueDates = [...new Set(sortedData.map(d => {
      return d.date || d.Дата || d['ДАТА'];
    }))].map(d => this.formatChartDate(d));
    
    // График 1: Производственные показатели
    this.createProductionChart(sortedData, uniqueDates);
    
    // График 2: Логистика (отдельно)
    this.createLogisticsChart(sortedData, uniqueDates);
    
    // График 3: Термообработка (отдельно)
    this.createFurnaceChart(sortedData, uniqueDates);
    
    // График 4: Днища (круговая диаграмма с %)
    this.createEndsChart(sortedData);
    
    // Отчёт по поломкам
    this.createBreakdownsReport(sortedData);
  }

  /**
   * Форматирует дату для отображения на графике
   */
  formatChartDate(dateStr) {
    if (!dateStr) return '';
    
    // Если дата в ISO формате (2026-03-16T19:00:00.000Z)
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

  /**
   * График производственных показателей (столбчатая диаграмма)
   */
  createProductionChart(data, uniqueDates) {
    const ctx = document.getElementById('productionChart');
    if (!ctx) return;
    
    // Уничтожаем старый график
    if (this.charts.production) {
      this.charts.production.destroy();
    }
    
    // Агрегируем данные по датам (используем оригинальные даты как ключи)
    const aggregated = {};
    const dateMap = {}; // маппинг оригинальной даты -> форматированной
    
    data.forEach(d => {
      const originalDate = d.date || d.Дата || d['ДАТА'];
      const formattedDate = this.formatChartDate(originalDate);
      dateMap[originalDate] = formattedDate;
      
      if (!aggregated[formattedDate]) {
        aggregated[formattedDate] = { plasma: 0, strozka: 0, svarka: 0, poloter: 0, zachistka: 0 };
      }
      
      aggregated[formattedDate].plasma += this.getValue(d, 'plasma_sheets', 'ПЛАЗМА_ЛИСТЫ');
      aggregated[formattedDate].strozka += this.getValue(d, 'strozka_segments', 'СТРОЖКА_ОТСТРОГАНО_СЕГМЕНТОВ');
      aggregated[formattedDate].svarka += this.getValue(d, 'avtosvarka_cards', 'АВТ_СВАРКА_ЗАВАРЕНО_КАРТ');
      aggregated[formattedDate].poloter += this.getValue(d, 'poloter_cleaned', 'ПОЛОТЕР_ПОЧИЩЕНО_КАРТ');
      aggregated[formattedDate].zachistka += this.getValue(d, 'zachistka_cleaned', 'ЗАЧИСТКА_ПОД_СВАРКУ_ПОЧИЩЕНО_КАРТ');
    });
    
    // Получаем уникальные даты в порядке сортировки
    const labels = [...new Set(data.map(d => this.formatChartDate(d.date || d.Дата || d['ДАТА'])))];
    const plasmaData = labels.map(d => aggregated[d].plasma);
    const strozkaData = labels.map(d => aggregated[d].strozka);
    const svarkaData = labels.map(d => aggregated[d].svarka);
    const poloterData = labels.map(d => aggregated[d].poloter);
    const zachistkaData = labels.map(d => aggregated[d].zachistka);
    
    console.log('График производства:', { labels, plasmaData, strozkaData, svarkaData, poloterData, zachistkaData });
    
    const maxValue = Math.max(...plasmaData, ...strozkaData, ...svarkaData, ...poloterData, ...zachistkaData, 1);
    
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
        plugins: {
          title: { display: true, text: 'Производственные показатели по дням', font: { size: 16 } },
          legend: { position: 'top' }
        },
        scales: {
          x: { 
            title: { display: true, text: 'Дата' },
            grid: { display: false }
          },
          y: { 
            beginAtZero: true,
            title: { display: true, text: 'Количество' },
            suggestedMax: maxValue * 1.1
          }
        }
      }
    });
  }

  /**
   * График логистики (отгружено/разгружено машин)
   */
  createLogisticsChart(data, uniqueDates) {
    const ctx = document.getElementById('logisticsChart');
    if (!ctx) return;
    
    if (this.charts.logistics) {
      this.charts.logistics.destroy();
    }
    
    // Агрегируем данные по датам
    const aggregated = {};
    
    data.forEach(d => {
      const dateStr = this.formatChartDate(d.date || d.Дата || d['ДАТА']);
      if (!aggregated[dateStr]) {
        aggregated[dateStr] = { unloaded: 0, loaded: 0 };
      }
      aggregated[dateStr].unloaded += this.getValue(d, 'unloaded', 'РАЗГРУЖЕННЫХ_МАШИН');
      aggregated[dateStr].loaded += this.getValue(d, 'loaded', 'ОТГРУЖЕННЫХ_МАШИН');
    });
    
    const labels = [...new Set(data.map(d => this.formatChartDate(d.date || d.Дата || d['ДАТА'])))];
    const unloadedData = labels.map(d => aggregated[d].unloaded);
    const loadedData = labels.map(d => aggregated[d].loaded);
    
    const maxValue = Math.max(...unloadedData, ...loadedData, 1);
    
    this.charts.logistics = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { 
            label: 'Разгружено машин', 
            data: unloadedData, 
            borderColor: '#FF6384', 
            backgroundColor: 'rgba(255, 99, 132, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7
          },
          { 
            label: 'Отгружено машин', 
            data: loadedData, 
            borderColor: '#36A2EB',
            backgroundColor: 'rgba(54, 162, 235, 0.1)', 
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: 'Логистика (машины)', font: { size: 16 } }
        },
        scales: {
          x: { 
            title: { display: true, text: 'Дата' },
            grid: { display: false }
          },
          y: { 
            beginAtZero: true,
            title: { display: true, text: 'Количество машин' },
            suggestedMax: maxValue * 1.1,
            ticks: { stepSize: 1 }
          }
        }
      }
    });
  }

  /**
   * График термообработки (малые и большие печи)
   */
  createFurnaceChart(data, uniqueDates) {
    // Создаём canvas если его нет
    let ctx = document.getElementById('furnaceChart');
    if (!ctx) {
      const container = document.getElementById('furnaceChartContainer');
      if (!container) return;
      ctx = document.createElement('canvas');
      ctx.id = 'furnaceChart';
      container.appendChild(ctx);
    }
    
    if (this.charts.furnace) {
      this.charts.furnace.destroy();
    }
    
    // Агрегируем данные по датам
    const aggregated = {};
    
    data.forEach(d => {
      const dateStr = this.formatChartDate(d.date || d.Дата || d['ДАТА']);
      if (!aggregated[dateStr]) {
        aggregated[dateStr] = { small: 0, large: 0 };
      }
      aggregated[dateStr].small += this.getValue(d, 'small_furnace', 'САДОК_МАЛАЯ_ПЕЧЬ');
      aggregated[dateStr].large += this.getValue(d, 'large_furnace', 'САДОК_БОЛЬШАЯ_ПЕЧЬ');
    });
    
    const labels = [...new Set(data.map(d => this.formatChartDate(d.date || d.Дата || d['ДАТА'])))];
    const smallData = labels.map(d => aggregated[d].small);
    const largeData = labels.map(d => aggregated[d].large);
    
    const maxValue = Math.max(...smallData, ...largeData, 1);
    
    this.charts.furnace = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { 
            label: 'Малая печь', 
            data: smallData, 
            borderColor: '#FFCE56',
            backgroundColor: 'rgba(255, 206, 86, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7
          },
          { 
            label: 'Большая печь', 
            data: largeData, 
            borderColor: '#4BC0C0',
            backgroundColor: 'rgba(75, 192, 192, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: 'Термообработка (садки в печи)', font: { size: 16 } }
        },
        scales: {
          x: { 
            title: { display: true, text: 'Дата' },
            grid: { display: false }
          },
          y: { 
            beginAtZero: true,
            title: { display: true, text: 'Количество садок' },
            suggestedMax: maxValue * 1.1,
            ticks: { stepSize: 1 }
          }
        }
      }
    });
  }

  /**
   * График учёта днищ (круговая диаграмма с процентами)
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
      totals['Пресс старый'] += this.getValue(d, 'stamped_old', 'ОТШТАМПОВАНО_ПРЕСС_СТАРЫЙ');
      totals['Итальянец'] += this.getValue(d, 'stamped_italy', 'ОТШТАМПОВАНО_ИТАЛЬЯНЕЦ');
      totals['Пресс новый'] += this.getValue(d, 'stamped_new', 'ОТШТАМПОВАНО_ПРЕСС_НОВЫЙ');
      totals['Комбинированные'] += this.getValue(d, 'combined', 'КОМБИНИРОВАННЫХ_ДНИЩ');
      totals['Ремонтные'] += this.getValue(d, 'repair', 'РЕМОНТНЫХ_ДНИЩ');
      totals['Отбортованные'] += this.getValue(d, 'flanged', 'ОТБОРТОВАННЫХ_ДНИЩ');
      totals['Обрезанные'] += this.getValue(d, 'trimmed', 'ОБРЕЗАННЫХ_ДНИЩ');
      totals['Упакованные'] += this.getValue(d, 'packed', 'УПАКОВАННЫХ_ДНИЩ');
    });
    
    // Фильтруем нулевые значения
    const entries = Object.entries(totals).filter(([k, v]) => v > 0);
    
    if (entries.length === 0) {
      // Нет данных - показываем пустую диаграмму
      this.charts.ends = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Нет данных'],
          datasets: [{
            data: [1],
            backgroundColor: ['#e0e0e0']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: 'Распределение днищ за период', font: { size: 16 } },
            legend: { position: 'right' }
          }
        }
      });
      return;
    }
    
    const labels = entries.map(([k, v]) => k);
    const values = entries.map(([k, v]) => v);
    const total = values.reduce((a, b) => a + b, 0);
    
    const colors = [
      '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
      '#9966FF', '#FF9F40', '#C9CBCF', '#7CFC00'
    ];
    
    this.charts.ends = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors.slice(0, labels.length),
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: 'Распределение днищ за период', font: { size: 16 } },
          legend: { 
            position: 'right',
            labels: {
              generateLabels: (chart) => {
                const data = chart.data;
                const dataset = data.datasets[0];
                const total = dataset.data.reduce((a, b) => a + b, 0);
                
                return data.labels.map((label, i) => ({
                  text: `${label}: ${dataset.data[i]} (${((dataset.data[i] / total) * 100).toFixed(1)}%)`,
                  fillStyle: dataset.backgroundColor[i],
                  hidden: false,
                  index: i
                }));
              }
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.raw;
                const percentage = ((value / total) * 100).toFixed(1);
                return `${context.label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }

  /**
   * Экранирует HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Отчёт по поломкам
   */
  createBreakdownsReport(data) {
    const container = document.getElementById('breakdownsReport');
    if (!container) return;
    
    // Хелпер для получения значения
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
    
    let html = '<div class="breakdowns-list">';
    breakdowns.forEach(b => {
      // Экранируем все пользовательские данные
      const safeDate = this.escapeHtml(b.date);
      const safeShift = this.escapeHtml(b.shift);
      const safeText = this.escapeHtml(b.text);
      
      html += `
        <div class="breakdown-item" style="padding: 15px; margin: 10px 0; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
          <div style="font-weight: bold; color: #856404; margin-bottom: 5px;">
            📅 ${safeDate} | Смена ${safeShift}
          </div>
          <div style="color: #856404;">${safeText}</div>
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
