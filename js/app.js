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
    
    console.log('Фильтрация отчётов:', { dateFrom, dateTo, shift, totalRecords: data.length });
    
    return data.filter(row => {
      // Получаем дату записи (пробуем разные варианты названий полей)
      const rowDateStr = row.date || row.Дата || row['ДАТА'];
      if (!rowDateStr) {
        console.log('Запись без даты:', row);
        return false;
      }
      
      const rowDate = this.parseDate(rowDateStr);
      if (!rowDate) {
        console.log('Не удалось распарсить дату:', rowDateStr);
        return false;
      }
      
      // Фильтр по дате "от"
      if (dateFrom) {
        const from = this.parseDate(dateFrom);
        // Устанавливаем начало дня (00:00:00)
        from.setHours(0, 0, 0, 0);
        if (rowDate < from) return false;
      }
      
      // Фильтр по дате "до"
      if (dateTo) {
        const to = this.parseDate(dateTo);
        // Устанавливаем конец дня (23:59:59)
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
   * Генерирует отчёты и графики
   */
  async generateReports() {
    const allData = this.storage.data || [];
    
    console.log('=== ГЕНЕРАЦИЯ ОТЧЁТОВ ===');
    console.log('Всего данных:', allData.length);
    
    if (allData.length > 0) {
      console.log('Ключи первой записи:', Object.keys(allData[0]));
      console.log('Пример записи:', allData[0]);
    }
    
    if (allData.length === 0) {
      // Пробуем загрузить данные
      try {
        await this.storage.load();
      } catch (error) {
        console.error('Ошибка загрузки данных:', error);
        alert('Нет данных для формирования отчётов');
        return;
      }
    }
    
    const filteredData = this.filterReportData(this.storage.data);
    
    console.log('Отфильтровано записей:', filteredData.length);
    
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
    
    console.log('Сортированные данные:', sortedData.map(d => ({
      date: d.date || d.Дата || d['ДАТА'],
      plasma: d['ПЛАЗМА_ЛИСТЫ'] || d.plasma_sheets
    })));
    
    // График 1: Производственные показатели
    this.createProductionChart(sortedData);
    
    // График 2: Днища
    this.createEndsChart(sortedData);
    
    // График 3: Логистика
    this.createLogisticsChart(sortedData);
    
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
   * График производственных показателей
   */
  createProductionChart(data) {
    const ctx = document.getElementById('productionChart');
    if (!ctx) return;
    
    // Уничтожаем старый график
    if (this.charts.production) {
      this.charts.production.destroy();
    }
    
    // Подготавливаем данные - ищем поля по разным возможным названиям
    const labels = data.map(d => this.formatChartDate(d.date || d.Дата || d['ДАТА']));
    
    // Производственные показатели (листы, сегменты, карты)
    const getValue = (row, ...fields) => {
      for (const f of fields) {
        if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
          return Number(row[f]) || 0;
        }
      }
      return 0;
    };
    
    const plasmaData = data.map(d => getValue(d, 'plasma_sheets', 'ПЛАЗМА_ЛИСТЫ', 'plasma_sheets'));
    const strozkaData = data.map(d => getValue(d, 'strozka_segments', 'СТРОЖКА_ОТСТРОГАНО_СЕГМЕНТОВ', 'strozka_segments'));
    const svarkaData = data.map(d => getValue(d, 'avtosvarka_cards', 'АВТ_СВАРКА_ЗАВАРЕНО_КАРТ', 'avtosvarka_cards'));
    const poloterData = data.map(d => getValue(d, 'poloter_cleaned', 'ПОЛОТЕР_ПОЧИЩЕНО_КАРТ', 'poloter_cleaned'));
    const zachistkaData = data.map(d => getValue(d, 'zachistka_cleaned', 'ЗАЧИСТКА_ПОД_СВАРКУ_ПОЧИЩЕНО_КАРТ', 'zachistka_cleaned'));
    
    console.log('График производства:', { labels, plasmaData, strozkaData, svarkaData, poloterData, zachistkaData });
    
    // Проверяем есть ли данные
    const hasData = [...plasmaData, ...strozkaData, ...svarkaData, ...poloterData, ...zachistkaData].some(v => v > 0);
    
    if (!hasData) {
      console.log('Нет данных для графика производства');
      // Показываем пустой график с сообщением
    }
    
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
    
    // Хелпер для получения значения
    const getValue = (row, ...fields) => {
      for (const f of fields) {
        if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
          return Number(row[f]) || 0;
        }
      }
      return 0;
    };
    
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
      totals['Пресс старый'] += getValue(d, 'stamped_old', 'ОТШТАМПОВАНО_ПРЕСС_СТАРЫЙ', 'stamped_old');
      totals['Итальянец'] += getValue(d, 'stamped_italy', 'ОТШТАМПОВАНО_ИТАЛЬЯНЕЦ', 'stamped_italy');
      totals['Пресс новый'] += getValue(d, 'stamped_new', 'ОТШТАМПОВАНО_ПРЕСС_НОВЫЙ', 'stamped_new');
      totals['Комбинированные'] += getValue(d, 'combined', 'КОМБИНИРОВАННЫХ_ДНИЩ', 'combined');
      totals['Ремонтные'] += getValue(d, 'repair', 'РЕМОНТНЫХ_ДНИЩ', 'repair');
      totals['Отбортованные'] += getValue(d, 'flanged', 'ОТБОРТОВАННЫХ_ДНИЩ', 'flanged');
      totals['Обрезанные'] += getValue(d, 'trimmed', 'ОБРЕЗАННЫХ_ДНИЩ', 'trimmed');
      totals['Упакованные'] += getValue(d, 'packed', 'УПАКОВАННЫХ_ДНИЩ', 'packed');
    });
    
    console.log('График днищ:', totals);
    
    // Фильтруем нулевые значения для лучшей визуализации
    const filteredLabels = Object.keys(totals).filter(k => totals[k] > 0);
    const filteredData = filteredLabels.map(k => totals[k]);
    const filteredColors = [
      '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
      '#9966FF', '#FF9F40', '#C9CBCF', '#7CFC00'
    ].slice(0, filteredLabels.length);
    
    this.charts.ends = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: filteredLabels.length > 0 ? filteredLabels : Object.keys(totals),
        datasets: [{
          data: filteredData.length > 0 ? filteredData : Object.values(totals),
          backgroundColor: filteredColors.length > 0 ? filteredColors : [
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
    
    // Хелпер для получения значения
    const getValue = (row, ...fields) => {
      for (const f of fields) {
        if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
          return Number(row[f]) || 0;
        }
      }
      return 0;
    };
    
    const labels = data.map(d => this.formatChartDate(d.date || d.Дата || d['ДАТА']));
    const unloadedData = data.map(d => getValue(d, 'unloaded', 'РАЗГРУЖЕННЫХ_МАШИН', 'unloaded'));
    const loadedData = data.map(d => getValue(d, 'loaded', 'ОТГРУЖЕННЫХ_МАШИН', 'loaded'));
    const smallFurnaceData = data.map(d => getValue(d, 'small_furnace', 'САДОК_МАЛАЯ_ПЕЧЬ', 'small_furnace'));
    const largeFurnaceData = data.map(d => getValue(d, 'large_furnace', 'САДОК_БОЛЬШАЯ_ПЕЧЬ', 'large_furnace'));
    
    console.log('График логистики:', { labels, unloadedData, loadedData, smallFurnaceData, largeFurnaceData });
    
    this.charts.logistics = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Разгружено машин', data: unloadedData, borderColor: '#FF6384', fill: false, tension: 0.1 },
          { label: 'Отгружено машин', data: loadedData, borderColor: '#36A2EB', fill: false, tension: 0.1 },
          { label: 'Малая печь', data: smallFurnaceData, borderColor: '#FFCE56', fill: false, tension: 0.1 },
          { label: 'Большая печь', data: largeFurnaceData, borderColor: '#4BC0C0', fill: false, tension: 0.1 }
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
    
    // Хелпер для получения значения
    const getText = (row, ...fields) => {
      for (const f of fields) {
        if (row[f] !== undefined && row[f] !== null && row[f] !== '') {
          return row[f];
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
