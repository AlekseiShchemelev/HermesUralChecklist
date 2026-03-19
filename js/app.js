/**
 * Главный модуль приложения (оптимизированная версия)
 */
'use strict';

import CONFIG from "./config.js";
import { DataManager } from "./data.js";
import { UI } from "./ui.js";
import { Storage } from "./storage.js";
import { indexedCache } from "./cache.js";
import auth from "./auth.js";

/**
 * Создаёт плагин для отображения значений на графиках
 * @param {number} fontSize - Размер шрифта (по умолчанию 11)
 * @returns {Object} Конфигурация плагина
 */
function createCustomLabelsPlugin(fontSize = 11) {
  return {
    id: 'customLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      chart.data.datasets.forEach((dataset, i) => {
        const meta = chart.getDatasetMeta(i);
        if (!meta.hidden) {
          meta.data.forEach((element, index) => {
            const value = dataset.data[index];
            if (value > 0) {
              ctx.fillStyle = dataset.borderColor;
              ctx.fillText(value, element.x, element.y - 8);
            }
          });
        }
      });
      ctx.restore();
    }
  };
}

class App {
  constructor() {
    this.dataManager = new DataManager();
    this.storage = new Storage();
    this.currentMode = "input";
    this.pagination = {
      pageSize: 10,
      currentPage: 0,
      allData: [],
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
    // Проверяем авторизацию
    this.initAuth();
  }

  /**
   * Инициализация авторизации
   */
  initAuth() {
    if (auth.isAuthenticated()) {
      this.showMainApp();
    } else {
      this.showLoginScreen();
    }
  }

  /**
   * Показывает экран входа
   */
  showLoginScreen() {
    const loginScreen = document.getElementById("loginScreen");
    const mainApp = document.getElementById("mainApp");
    if (!loginScreen || !mainApp) return;
    
    loginScreen.style.display = "flex";
    mainApp.style.display = "none";

    const loginForm = document.getElementById("loginForm");
    const loginError = document.getElementById("loginError");
    if (!loginForm || !loginError) return;

    loginForm.onsubmit = async (e) => {
      e.preventDefault();

      const fio = document.getElementById("loginFio").value.trim();
      const password = document.getElementById("loginPassword").value;
      const btnText = document.getElementById("loginBtnText");

      btnText.textContent = "Проверка...";
      loginError.classList.remove("show");

      const result = await auth.login(fio, password);

      if (result.success) {
        this.showMainApp();
      } else {
        loginError.textContent = result.message;
        loginError.classList.add("show");
        btnText.textContent = "Войти";
      }
    };
  }

  /**
   * Показывает основное приложение
   */
  showMainApp() {
    const loginScreen = document.getElementById("loginScreen");
    const mainApp = document.getElementById("mainApp");
    if (!loginScreen || !mainApp) return;
    
    loginScreen.style.display = "none";
    mainApp.style.display = "block";

    // Показываем информацию о пользователе
    const user = auth.getCurrentUser();
    const userInfo = document.getElementById("userInfo");
    const userName = document.getElementById("userName");
    if (user && userInfo && userName) {
      userInfo.style.display = "flex";
      userName.textContent = user.fio;
    }

    // Кнопка выхода
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.onclick = () => auth.logout();

    // Инициализируем приложение
    this.bindModeSwitcher();
    this.bindFormHandlers();
    this.setDefaultDate();

    const scheduleWork =
      window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
    scheduleWork(
      () => {
        this.initPeopleCalculation();
        this.bindViewHandlers();
        this.preloadData();
      },
      { timeout: 2000 },
    );

    this.setupOptimizedListeners();
    
    // Очистка при уходе со страницы
    window.addEventListener("beforeunload", () => this.cleanup());
  }

  /**
   * Оптимизированные слушатели событий
   */
  setupOptimizedListeners() {
    // Сохраняем ссылки на обработчики для удаления
    this._resizeHandler = () => {
      if (this.resizeTimer) return;
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        this.handleResize();
      }, 100);
    };
    
    this._scrollHandler = () => {
      if (this.scrollTimeout) return;
      this.scrollTimeout = setTimeout(() => {
        this.scrollTimeout = null;
      }, 16);
    };
    
    // Throttle для resize
    window.addEventListener("resize", this._resizeHandler, { passive: true });

    // Throttle для скролла (60fps)
    window.addEventListener("scroll", this._scrollHandler, { passive: true });
  }
  
  /**
   * Очистка ресурсов при уничтожении приложения
   */
  cleanup() {
    // Удаляем слушатели событий
    if (this._resizeHandler) {
      window.removeEventListener("resize", this._resizeHandler);
    }
    if (this._scrollHandler) {
      window.removeEventListener("scroll", this._scrollHandler);
    }
    
    // Очищаем таймеры
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }
    
    // Отключаем observer
    if (this.chartObserver) {
      this.chartObserver.disconnect();
      this.chartObserver = null;
    }
    
    // Уничтожаем графики
    this.destroyCharts();
    
    // Уничтожаем worker в dataManager
    if (this.dataManager) {
      this.dataManager.cleanup();
    }
  }

  handleResize() {
    // Обновляем графики при изменении размера
    if (this.currentMode === "reports") {
      Object.values(this.charts).forEach((chart) => {
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
    const buttons = document.querySelectorAll(".mode-btn");

    for (const btn of buttons) {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        this.switchMode(mode);
      });
    }
  }

  /**
   * Переключает режим отображения
   */
  switchMode(mode) {
    // Сохраняем значение фильтра день/ночь при уходе из reports
    if (this.currentMode === "reports") {
      const shiftTypeEl = document.getElementById("reportShiftType");
      this.savedShiftType = shiftTypeEl ? shiftTypeEl.value : "";
    }
    
    this.currentMode = mode;

    // Обновляем кнопки
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    // Обновляем секции
    document.querySelectorAll(".content-section").forEach((section) => {
      section.classList.toggle("active", section.id === `${mode}-section`);
    });

    if (mode === "view") {
      // Автоматическая синхронизация с таблицей при переключении
      this.refreshDataFromSheet(false);
    } else if (mode === "reports") {
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
    Object.keys(this.charts).forEach((key) => {
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
    const dateInput = document.getElementById("date");
    if (dateInput && !dateInput.value) {
      dateInput.valueAsDate = new Date();
    }
  }

  /**
   * Инициализация подсчёта людей с debounce
   */
  initPeopleCalculation() {
    const inputs = document.querySelectorAll(
      ".people-input:not(#total_people)",
    );

    for (const input of inputs) {
      input.addEventListener("input", () => {
        DataManager.updateTotalPeople();
      });
    }

    DataManager.updateTotalPeople();
  }

  /**
   * Обработчики формы ввода с защитой от двойной отправки
   */
  bindFormHandlers() {
    const form = document.getElementById("reportForm");
    const submitBtn = document.getElementById("submitBtn");

    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (this.isSubmitting) return;
      this.isSubmitting = true;

      submitBtn.disabled = true;
      UI.showStatus("Отправка...", "info");

      const data = DataManager.gatherFormData();

      const errors = DataManager.validate(data);
      if (errors.length > 0) {
        UI.showStatus(errors.join("; "), "error");
        submitBtn.disabled = false;
        this.isSubmitting = false;
        return;
      }

      // Показываем индикатор загрузки
      UI.setButtonLoading(submitBtn, true, "Сохранение...");

      try {
        const result = await this.storage.save(data);

        if (result && result.result === "error") {
          UI.showStatus(result.message || "Ошибка сервера", "error");
        } else {
          UI.showStatus("✓ Отправлено в Google Sheets!", "success");
          form.reset();
          this.setDefaultDate();
          DataManager.updateTotalPeople();

          // Инвалидируем кэши
          await indexedCache.clear();
        }
      } catch (error) {
        UI.showStatus("Ошибка: " + error.message, "error");
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
    const applyBtn = document.getElementById("applyFilters");
    if (applyBtn) {
      applyBtn.addEventListener("click", () => this.applyFilters());
    }

    const resetBtn = document.getElementById("resetFilters");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => this.resetFilters());
    }

    const addBtn = document.getElementById("addNewBtn");
    if (addBtn) {
      addBtn.addEventListener("click", () => this.openEditModal());
    }

    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        this.storage.clearCache();
        indexedCache.clear();
        this.loadData();
      });
    }

    const exportBtn = document.getElementById("exportBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => this.exportData());
    }

    // Кнопка компактного вида
    const compactBtn = document.getElementById("compactViewBtn");
    if (compactBtn) {
      // Восстанавливаем состояние
      this.restoreCompactLevel();

      compactBtn.addEventListener("click", () => {
        this.cycleCompactLevel();
      });
    }
  }

  /**
   * Циклическое переключение уровней сжатия таблицы
   * Уровни: 0 (обычный) → 1 (-30%) → 2 (-50%) → 3 (-70%) → 0
   */
  cycleCompactLevel() {
    const table = document.querySelector(".data-table");
    const btn = document.getElementById("compactViewBtn");
    const btnText = btn?.querySelector(".btn-text");

    if (!table) return;

    // Получаем текущий уровень (0-3)
    let level = parseInt(localStorage.getItem("compactLevel") || "0");

    // Переходим к следующему уровню
    level = (level + 1) % 4;

    // Удаляем все классы сжатия
    table.classList.remove(
      "compact-view-1",
      "compact-view-2",
      "compact-view-3",
    );
    btn?.classList.remove("active");

    // Применяем новый уровень
    const labels = ["Стандарт", "Компактно 1", "Компактно 2", "Мини"];

    if (level > 0) {
      table.classList.add(`compact-view-${level}`);
      btn?.classList.add("active");
    }

    if (btnText) {
      btnText.textContent = labels[level];
    }

    localStorage.setItem("compactLevel", level.toString());
  }

  /**
   * Восстанавливает уровень сжатия из localStorage
   */
  restoreCompactLevel() {
    const level = parseInt(localStorage.getItem("compactLevel") || "0");
    if (level > 0) {
      const table = document.querySelector(".data-table");
      const btn = document.getElementById("compactViewBtn");
      const btnText = btn?.querySelector(".btn-text");

      if (table) {
        table.classList.add(`compact-view-${level}`);
      }
      btn?.classList.add("active");

      const labels = ["Стандарт", "Компактно 1", "Компактно 2", "Мини"];
      if (btnText) {
        btnText.textContent = labels[level];
      }
    }
  }

  /**
   * Загружает данные с использованием кэша
   */
  async loadData() {
    const container = document.getElementById("tableContainer");
    const summary = document.getElementById("summary");

    UI.showLoading(container, "Загрузка данных...");
    if (summary) summary.innerHTML = "";

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

      const statusEl = document.getElementById("viewStatus");
      UI.showStatus(
        `✅ Данные загружены (${data.length} записей)`,
        "success",
        statusEl,
      );
    } catch (error) {
      UI.showError(container, `Ошибка загрузки: ${error.message}`);
      this.pagination.allData = [];
      this.dataManager.data = [];
    }
  }

  /**
   * Принудительно обновляет данные из Google Sheets
   */
  async refreshDataFromSheet(showLoading = true) {
    const container = document.getElementById("tableContainer");

    if (showLoading) {
      UI.showGlobalLoading("Обновление данных из таблицы...");
    } else if (container) {
      UI.showLoading(container, "Синхронизация с таблицей...");
    }

    try {
      // Очищаем кэш
      this.storage.clearCache();
      await indexedCache.clear();

      // Загружаем свежие данные
      const data = await this.storage.load();

      // Сохраняем в IndexedDB
      await indexedCache.setRecords(data);

      this.pagination.allData = data;
      this.pagination.currentPage = 0;
      this.dataManager.data = data;

      this.renderPaginatedTable();

      if (showLoading) {
        UI.hideGlobalLoading();
      }

      const statusEl = document.getElementById("viewStatus");
      UI.showStatus(
        `✅ Данные обновлены из таблицы (${data.length} записей)`,
        "success",
        statusEl,
      );
    } catch (error) {
      if (showLoading) {
        UI.hideGlobalLoading();
      }
      const container = document.getElementById("tableContainer");
      UI.showError(container, `Ошибка обновления: ${error.message}`);
    }
  }

  /**
   * Отображает таблицу с пагинацией (оптимизированная)
   */
  renderPaginatedTable() {
    const container = document.getElementById("tableContainer");
    const summary = document.getElementById("summary");
    const loadMoreContainer = document.getElementById("loadMoreContainer");

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
      onDelete: (id) => this.deleteRecord(id),
    });

    // Привязываем обработчики к кнопкам
    this.bindTableActions(container);

    if (loadMoreContainer) {
      const hasMore = startIndex > 0;
      loadMoreContainer.style.display = hasMore ? "block" : "none";
    }

    const loadMoreBtn = document.getElementById("loadMoreBtn");
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
      dateFrom: document.getElementById("dateFrom").value,
      dateTo: document.getElementById("dateTo").value,
      shift: document.getElementById("filterShift").value,
      shiftType: document.getElementById("filterShiftType")?.value,
      shop: document.getElementById("filterShop").value.trim(),
      master: document.getElementById("filterMaster").value.trim(),
    };

    const filtered = await this.dataManager.filter(filters);

    const container = document.getElementById("tableContainer");
    container.innerHTML = UI.createDataTable(filtered, {
      editable: true,
      onEdit: (id) => this.editRecord(id),
      onDelete: (id) => this.deleteRecord(id),
    });

    // Привязываем обработчики к кнопкам
    this.bindTableActions(container);
  }

  /**
   * Сбрасывает фильтры
   */
  resetFilters() {
    document.getElementById("dateFrom").value = "";
    document.getElementById("dateTo").value = "";
    document.getElementById("filterShift").value = "";
    document.getElementById("filterShop").value = "";
    document.getElementById("filterMaster").value = "";

    this.renderPaginatedTable();
  }

  /**
   * Модальное окно редактирования
   */
  openEditModal(data = null) {
    const existingModal = document.getElementById("editModal");
    if (existingModal) {
      existingModal.remove();
    }

    const modal = UI.createEditModal(data);

    const clickHandler = async (e) => {
      const action = e.target.dataset.action;

      if (action === "close" || e.target === modal) {
        modal.removeEventListener("click", clickHandler);
        UI.closeModal();
      } else if (action === "save") {
        modal.removeEventListener("click", clickHandler);
        await this.saveEditForm();
      }
    };

    modal.addEventListener("click", clickHandler);

    const closeOnEscape = (e) => {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", closeOnEscape);
        UI.closeModal();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
  }

  /**
   * Привязывает обработчики к строкам таблицы (клик для просмотра)
   */
  bindTableActions(container) {
    container.addEventListener("click", (e) => {
      const row = e.target.closest(".clickable-row");
      if (!row) return;

      const id = row.dataset.id;
      if (!id) return;

      this.viewRecord(id);
    });
  }

  /**
   * Открывает окно просмотра записи
   */
  viewRecord(id) {
    const record = this.dataManager.data.find((r) => {
      const rowId = r.id || r.ID || r["ID"];
      return String(rowId) === String(id);
    });

    if (!record) {
      alert("Запись не найдена");
      return;
    }

    // Открываем окно просмотра
    UI.createViewModal(record, {
      onEdit: () => this.editRecord(id),
      onDelete: () => this.deleteRecord(id),
      onClose: () => {}, // Можно добавить дополнительные действия при закрытии
    });
  }

  editRecord(id) {
    const record = this.dataManager.data.find((r) => {
      const rowId = r.id || r.ID || r["ID"];
      return String(rowId) === String(id);
    });

    if (record) {
      this.openEditModal(record);
    }
  }

  async saveEditForm() {
    let data;

    try {
      data = UI.gatherEditFormData();
    } catch (error) {
      alert("Ошибка валидации: " + error.message);
      return;
    }

    if (!data.date || !data.shift || !data.shop || !data.master) {
      alert("Пожалуйста, заполните обязательные поля");
      return;
    }

    const isEdit = !!data.id;

    // Показываем глобальный индикатор загрузки
    UI.showGlobalLoading(
      isEdit ? "Обновление записи..." : "Создание записи...",
    );

    try {
      const result = await this.storage.save(data);

      UI.closeModal();
      // Обновляем данные из таблицы
      await this.refreshDataFromSheet();

      UI.hideGlobalLoading();
      const actionText = isEdit ? "обновлена" : "добавлена";
      UI.showStatus(
        `Запись ${actionText}!`,
        "success",
        document.getElementById("viewStatus"),
      );
    } catch (error) {
      UI.hideGlobalLoading();
      UI.showStatus(
        "Ошибка сохранения: " + error.message,
        "error",
        document.getElementById("viewStatus"),
      );
    }
  }

  async deleteRecord(id) {
    const confirmed = await UI.confirm(
      "Вы уверены, что хотите удалить эту запись?",
    );

    if (confirmed) {
      UI.showGlobalLoading("Удаление записи...");

      try {
        await this.storage.delete(id);
        // Обновляем данные из таблицы
        await this.refreshDataFromSheet();
        UI.hideGlobalLoading();
        UI.showStatus(
          "Запись удалена",
          "success",
          document.getElementById("viewStatus"),
        );
      } catch (error) {
        UI.hideGlobalLoading();
        alert("Ошибка удаления: " + error.message);
      }
    }
  }

  exportData() {
    const csv = this.storage.exportToCSV();
    if (!csv) {
      alert("Нет данных для экспорта");
      return;
    }

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `otchet_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();

    // Освобождаем память
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    UI.showStatus(
      "Данные экспортированы",
      "success",
      document.getElementById("viewStatus"),
    );
  }

  // ==================== ОТЧЁТЫ И ГРАФИКИ ====================

  /**
   * Загружает данные для отчётов
   */
  async loadReportData() {
    const today = new Date();
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

    const reportDateTo = document.getElementById("reportDateTo");
    const reportDateFrom = document.getElementById("reportDateFrom");
    const reportMaster = document.getElementById("reportMaster");
    const reportShiftType = document.getElementById("reportShiftType");

    if (reportDateTo) reportDateTo.valueAsDate = today;
    if (reportDateFrom) reportDateFrom.valueAsDate = fourDaysAgo;
    // Восстанавливаем сохранённое значение shiftType (если есть)
    if (reportShiftType && this.savedShiftType !== undefined) {
      reportShiftType.value = this.savedShiftType;
    }
    if (reportMaster) reportMaster.value = "";

    const generateBtn = document.getElementById("generateReports");
    if (generateBtn) {
      generateBtn.onclick = () => this.generateReports();
    }

    // Кнопка сброса фильтров отчетов
    const resetReportBtn = document.getElementById("resetReportFilters");
    if (resetReportBtn) {
      resetReportBtn.onclick = () => this.resetReportFilters();
    }

    // Используем requestIdleCallback для не критичных операций
    const scheduleWork =
      window.requestIdleCallback || ((cb) => setTimeout(cb, 1));

    scheduleWork(async () => {
      try {
        await this.storage.load();
        // Сбрасываем кэш при загрузке для корректного отображения
        this.chartDataHash = null;
        this.generateReports();
      } catch (error) {
        // Игнорируем ошибки
      }
    });
  }

  /**
   * Парсит дату из различных форматов
   * Поддерживает: DD.MM.YYYY, YYYY-MM-DD, ISO 8601 (2026-03-16T19:00:00.000Z)
   */
  parseDate(dateStr) {
    if (!dateStr) return null;

    // ISO 8601 формат (2026-03-16T19:00:00.000Z)
    if (dateStr.includes("T")) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        // Конвертируем UTC в локальную дату
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
      }
    }

    // DD.MM.YYYY
    if (dateStr.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
      const [d, m, y] = dateStr.split(".");
      return new Date(Number(y), Number(m) - 1, Number(d));
    }

    // YYYY-MM-DD - важно: создавать дату в ЛОКАЛЬНОЙ временной зоне
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [y, m, d] = dateStr.split("-");
      return new Date(Number(y), Number(m) - 1, Number(d));
    }

    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Фильтрует данные
   */
  filterReportData(data) {
    const dateFrom = document.getElementById("reportDateFrom")?.value;
    const dateTo = document.getElementById("reportDateTo")?.value;
    const shift = document.getElementById("reportShift")?.value;
    const shiftType = document.getElementById("reportShiftType")?.value;
    const master = document.getElementById("reportMaster")?.value?.trim();

    return data.filter((row) => {
      const rowDateStr = row.date || row.Дата || row["ДАТА"];
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
        const rowShift = row.shift || row.Смена || row["СМЕНА"];
        if (String(rowShift) !== String(shift)) return false;
      }

      if (shiftType) {
        const rowShiftType = (
          row.shift_type ||
          row.День_Ночь ||
          row["ДЕНЬ_НОЧЬ"] ||
          ""
        )
          .toString()
          .trim()
          .toLowerCase();
        if (rowShiftType !== shiftType.toLowerCase()) return false;
      }

      if (master) {
        const rowMaster = (
          row.master ||
          row.ФИО_мастера ||
          row["ФИО_МАСТЕРА"] ||
          ""
        ).toLowerCase();
        if (!rowMaster.includes(master.toLowerCase())) return false;
      }

      return true;
    });
  }

  /**
   * Сбрасывает фильтры отчетов
   */
  resetReportFilters() {
    const today = new Date();
    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(today.getDate() - 4);

    document.getElementById("reportDateFrom").valueAsDate = fourDaysAgo;
    document.getElementById("reportDateTo").valueAsDate = today;
    document.getElementById("reportShift").value = "";
    // Не сбрасываем shiftType - он сохраняется при сбросе
    document.getElementById("reportMaster").value = "";

    // Сбрасываем кэш графиков чтобы принудительно пересоздать их
    this.chartDataHash = null;

    this.generateReports();
  }

  /**
   * Хелпер для получения значения
   */
  getValue(row, ...fields) {
    for (const f of fields) {
      if (row[f] !== undefined && row[f] !== null && row[f] !== "") {
        const rawVal = row[f];
        const val =
          typeof rawVal === "number"
            ? rawVal
            : Number(String(rawVal).replace(",", "."));
        return isNaN(val) ? 0 : val;
      }
    }

    // Поиск по совпадению части ключа
    const rowKeys = Object.keys(row);
    for (const f of fields) {
      const lowerF = f.toLowerCase();
      const matchingKey = rowKeys.find(
        (k) =>
          k.toLowerCase() === lowerF ||
          k.toLowerCase().includes(lowerF.replace(/_/g, "")),
      );
      if (
        matchingKey !== undefined &&
        row[matchingKey] !== null &&
        row[matchingKey] !== ""
      ) {
        const rawVal = row[matchingKey];
        const val =
          typeof rawVal === "number"
            ? rawVal
            : Number(String(rawVal).replace(",", "."));
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
    if (data.length === 0) return "empty";
    const first = data[0].id || data[0].ID || "";
    const last = data[data.length - 1].id || data[data.length - 1].ID || "";
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
    const numericFields = [
      "plasma_sheets",
      "strozka_segments",
      "avtosvarka_cards",
      "unloaded",
      "loaded",
      "small_furnace",
      "large_furnace",
    ];

    for (const field of numericFields) {
      result[field] = window.reduce(
        (sum, row) => sum + (Number(row[field]) || 0),
        0,
      );
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
        alert("Нет данных для формирования отчётов");
        return;
      }
    }

    if (allData.length === 0) {
      alert("Нет данных для формирования отчётов");
      return;
    }

    const filteredData = this.filterReportData(allData);

    if (filteredData.length === 0) {
      alert("Нет данных для выбранного периода");
      return;
    }

    // Проверяем, изменились ли данные
    const newHash = this.hashData(filteredData);
    const dataChanged = newHash !== this.chartDataHash;
    this.chartDataHash = newHash;

    // Сортируем по дате
    const sortedData = [...filteredData].sort((a, b) => {
      const dateA = this.parseDate(a.date || a.Дата || a["ДАТА"]);
      const dateB = this.parseDate(b.date || b.Дата || b["ДАТА"]);
      return dateA - dateB;
    });

    // Downsampling если много данных
    const optimizedData =
      sortedData.length > 50 ? this.downsampleData(sortedData) : sortedData;

    // Ленивая загрузка графиков через Intersection Observer
    this.renderChartsLazy(optimizedData, dataChanged);
    this.createBreakdownsReport(sortedData);
  }

  /**
   * Ленивая загрузка графиков
   */
  renderChartsLazy(data, dataChanged) {
    const chartsConfig = [
      {
        id: "plasmaChart",
        fn: () => this.createPlasmaChart(data, dataChanged),
      },
      {
        id: "strozkaChart",
        fn: () => this.createStrozkaChart(data, dataChanged),
      },
      {
        id: "zachistkaChart",
        fn: () => this.createZachistkaChart(data, dataChanged),
      },
      {
        id: "avtosvarkaChart",
        fn: () => this.createAvtosvarkaChart(data, dataChanged),
      },
      {
        id: "poloterChart",
        fn: () => this.createPoloterChart(data, dataChanged),
      },
      {
        id: "logisticsChart",
        fn: () => this.createLogisticsChart(data, dataChanged),
      },
      {
        id: "furnaceChart",
        fn: () => this.createFurnaceChart(data, dataChanged),
      },
      {
        id: "endsChartStamped",
        fn: () => this.createEndsChartStamped(data, dataChanged),
      },
      {
        id: "endsChartProcessed",
        fn: () => this.createEndsChartProcessed(data, dataChanged),
      },
      {
        id: "endsChartRepair",
        fn: () => this.createEndsChartRepair(data, dataChanged),
      },
    ];

    if ("IntersectionObserver" in window) {
      // Отключаем предыдущий observer если есть
      if (this.chartObserver) {
        this.chartObserver.disconnect();
      }
      
      this.chartObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const chart = chartsConfig.find((c) => c.id === entry.target.id);
              if (chart) {
                chart.fn();
                this.chartObserver.unobserve(entry.target);
              }
            }
          });
        },
        { rootMargin: "100px" },
      );

      chartsConfig.forEach((chart) => {
        const canvas = document.getElementById(chart.id);
        if (canvas) this.chartObserver.observe(canvas);
      });
    } else {
      chartsConfig.forEach((chart) => chart.fn());
    }
  }

  formatChartDate(dateStr) {
    if (!dateStr) return "";

    if (typeof dateStr === "string" && dateStr.includes("T")) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
        });
      }
    }

    const date = this.parseDate(dateStr);
    if (!date) return dateStr;
    return date.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
    });
  }

  /**
   * Группирует данные по дате и типу смены (день/ночь)
   */
  prepareShiftData(data, valueField, russianKey, filterShiftType) {
    const dayData = [];
    const nightData = [];
    const labels = [];

    // Получаем уникальные даты
    const dateMap = new Map();

    data.forEach((row) => {
      const dateStr = row.date || row.Дата || row["ДАТА"];
      const formattedDate = this.formatChartDate(dateStr);

      if (!dateMap.has(formattedDate)) {
        dateMap.set(formattedDate, { day: 0, night: 0 });
      }

      const shiftType = (
        row.shift_type ||
        row.День_Ночь ||
        row["ДЕНЬ_НОЧЬ"] ||
        ""
      )
        .toString()
        .trim()
        .toLowerCase();
      const value = this.getValue(row, valueField, russianKey);

      if (shiftType === "день" || shiftType === "дeнь") {
        dateMap.get(formattedDate).day += value;
      } else if (shiftType === "ночь" || shiftType === "нoчь") {
        dateMap.get(formattedDate).night += value;
      }
    });

    // Преобразуем Map в массивы
    dateMap.forEach((values, date) => {
      labels.push(date);
      // Если включен фильтр - показываем только нужные значения
      if (!filterShiftType || filterShiftType === "День") {
        dayData.push(values.day);
      }
      if (!filterShiftType || filterShiftType === "Ночь") {
        nightData.push(values.night);
      }
    });

    return { labels, dayData, nightData };
  }

  createPlasmaChart(data, dataChanged) {
    const ctx = document.getElementById("plasmaChart");
    if (!ctx) return;

    // Проверяем фильтр День/Ночь
    const filterShiftType = document.getElementById("reportShiftType")?.value;

    const { labels, dayData, nightData } = this.prepareShiftData(
      data,
      "plasma_sheets",
      "ПЛАЗМА_ЛИСТЫ",
      filterShiftType,
    );

    // Вычисляем максимум для оси Y (+2)
    const allValues = [...dayData, ...nightData];
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const yMax = maxValue > 0 ? maxValue + 2 : 2;

    // Формируем датасеты
    const datasets = [];

    // Цвета: Плазма - красный (день: ярко-красный, ночь: темно-красный прерывистый)
    if (!filterShiftType || filterShiftType === "День") {
      datasets.push({
        label: "День",
        data: dayData,
        borderColor: "#FF0000",
        backgroundColor: "#FF0000",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
        datalabels: { display: true },
      });
    }

    if (!filterShiftType || filterShiftType === "Ночь") {
      datasets.push({
        label: "Ночь",
        data: nightData,
        borderColor: "#8B0000",
        backgroundColor: "#ffffffff",
        borderDash: [8, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
        datalabels: { display: true },
      });
    }

    if (this.charts.plasma && !dataChanged) return;

    if (this.charts.plasma) {
      this.charts.plasma.data.labels = labels;
      this.charts.plasma.data.datasets = datasets;
      this.charts.plasma.options.scales.y.max = yMax;
      this.charts.plasma.update("none");
      return;
    }

    this.charts.plasma = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: !filterShiftType, position: "top" },
          title: { display: true, text: "Плазма (листы)" },
          datalabels: {
            display: true,
            align: "top",
            offset: 4,
            font: { size: 11, weight: "bold" },
            formatter: (value) => (value > 0 ? value : ""),
          },
          // Кастомный плагин для отображения значений
          customLabels: {
            display: true,
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Дата" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            title: { display: true, text: "Количество" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin()],
    });
  }

  createStrozkaChart(data, dataChanged) {
    const ctx = document.getElementById("strozkaChart");
    if (!ctx) return;

    const filterShiftType = document.getElementById("reportShiftType")?.value;
    const { labels, dayData, nightData } = this.prepareShiftData(
      data,
      "strozka_segments",
      "СТРОЖКА_ОТСТРОГАНО_СЕГМЕНТОВ",
      filterShiftType,
    );

    // Вычисляем максимум для оси Y (+2)
    const allValues = [...dayData, ...nightData];
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const yMax = maxValue > 0 ? maxValue + 2 : 2;

    const datasets = [];

    // Цвета: Строжка - синий (день: ярко-синий, ночь: темно-синий прерывистый)
    if (!filterShiftType || filterShiftType === "День") {
      datasets.push({
        label: "День",
        data: dayData,
        borderColor: "#0066FF",
        backgroundColor: "#0066FF",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }

    if (!filterShiftType || filterShiftType === "Ночь") {
      datasets.push({
        label: "Ночь",
        data: nightData,
        borderColor: "#00008B",
        backgroundColor: "#ffffffff",
        borderDash: [8, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }

    if (this.charts.strozka && !dataChanged) return;

    if (this.charts.strozka) {
      this.charts.strozka.data.labels = labels;
      this.charts.strozka.data.datasets = datasets;
      this.charts.strozka.options.scales.y.max = yMax;
      this.charts.strozka.update("none");
      return;
    }

    this.charts.strozka = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: !filterShiftType, position: "top" },
          title: { display: true, text: "Строжка (сегменты)" },
        },
        scales: {
          x: {
            title: { display: true, text: "Дата" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            title: { display: true, text: "Количество" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin()],
    });
  }

  createZachistkaChart(data, dataChanged) {
    const ctx = document.getElementById("zachistkaChart");
    if (!ctx) return;

    const filterShiftType = document.getElementById("reportShiftType")?.value;
    const { labels, dayData, nightData } = this.prepareShiftData(
      data,
      "zachistka_cleaned",
      "ЗАЧИСТКА_ПОД_СВАРКУ_ПОЧИЩЕНО_КАРТ",
      filterShiftType,
    );

    // Вычисляем максимум для оси Y (+2)
    const allValues = [...dayData, ...nightData];
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const yMax = maxValue > 0 ? maxValue + 2 : 2;

    const datasets = [];
    // Цвета: Зачистка - зелёный (день: ярко-зелёный, ночь: темно-зелёный прерывистый)
    if (!filterShiftType || filterShiftType === "День")
      datasets.push({
        label: "День",
        data: dayData,
        borderColor: "#00AA00",
        backgroundColor: "#00AA00",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    if (!filterShiftType || filterShiftType === "Ночь")
      datasets.push({
        label: "Ночь",
        data: nightData,
        borderColor: "#006400",
        backgroundColor: "#ffffffff",
        borderDash: [8, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });

    if (this.charts.zachistka && !dataChanged) return;
    if (this.charts.zachistka) {
      this.charts.zachistka.data.labels = labels;
      this.charts.zachistka.data.datasets = datasets;
      this.charts.zachistka.options.scales.y.max = yMax;
      this.charts.zachistka.update("none");
      return;
    }

    this.charts.zachistka = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: !filterShiftType, position: "top" },
          title: { display: true, text: "Зачистка под сварку (карты)" },
        },
        scales: {
          x: {
            title: { display: true, text: "Дата" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            title: { display: true, text: "Количество" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin()],
    });
  }

  createAvtosvarkaChart(data, dataChanged) {
    const ctx = document.getElementById("avtosvarkaChart");
    if (!ctx) return;

    const filterShiftType = document.getElementById("reportShiftType")?.value;
    const { labels, dayData, nightData } = this.prepareShiftData(
      data,
      "avtosvarka_cards",
      "АВТ_СВАРКА_ЗАВАРЕНО_КАРТ",
      filterShiftType,
    );

    // Вычисляем максимум для оси Y (+2)
    const allValues = [...dayData, ...nightData];
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const yMax = maxValue > 0 ? maxValue + 2 : 2;

    const datasets = [];
    // Цвета: Авт.сварка - оранжевый (день: ярко-оранжевый, ночь: темно-оранжевый прерывистый)
    if (!filterShiftType || filterShiftType === "День")
      datasets.push({
        label: "День",
        data: dayData,
        borderColor: "#FF8C00",
        backgroundColor: "#FF8C00",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    if (!filterShiftType || filterShiftType === "Ночь")
      datasets.push({
        label: "Ночь",
        data: nightData,
        borderColor: "#8B4500",
        backgroundColor: "#ffffffff",
        borderDash: [8, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });

    if (this.charts.avtosvarka && !dataChanged) return;
    if (this.charts.avtosvarka) {
      this.charts.avtosvarka.data.labels = labels;
      this.charts.avtosvarka.data.datasets = datasets;
      this.charts.avtosvarka.options.scales.y.max = yMax;
      this.charts.avtosvarka.update("none");
      return;
    }

    this.charts.avtosvarka = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: !filterShiftType, position: "top" },
          title: { display: true, text: "Автоматическая сварка (карты)" },
        },
        scales: {
          x: {
            title: { display: true, text: "Дата" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            title: { display: true, text: "Количество" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin()],
    });
  }

  createPoloterChart(data, dataChanged) {
    const ctx = document.getElementById("poloterChart");
    if (!ctx) return;

    const filterShiftType = document.getElementById("reportShiftType")?.value;
    const { labels, dayData, nightData } = this.prepareShiftData(
      data,
      "poloter_cleaned",
      "ПОЛОТЕР_ПОЧИЩЕНО_КАРТ",
      filterShiftType,
    );

    // Вычисляем максимум для оси Y (+2)
    const allValues = [...dayData, ...nightData];
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const yMax = maxValue > 0 ? maxValue + 2 : 2;

    const datasets = [];
    // Цвета: Полотер - фиолетовый (день: ярко-фиолетовый, ночь: темно-фиолетовый прерывистый)
    if (!filterShiftType || filterShiftType === "День")
      datasets.push({
        label: "День",
        data: dayData,
        borderColor: "#9932CC",
        backgroundColor: "#9932CC",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    if (!filterShiftType || filterShiftType === "Ночь")
      datasets.push({
        label: "Ночь",
        data: nightData,
        borderColor: "#4B0082",
        backgroundColor: "#ffffffff",
        borderDash: [8, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });

    if (this.charts.poloter && !dataChanged) return;
    if (this.charts.poloter) {
      this.charts.poloter.data.labels = labels;
      this.charts.poloter.data.datasets = datasets;
      this.charts.poloter.options.scales.y.max = yMax;
      this.charts.poloter.update("none");
      return;
    }

    this.charts.poloter = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: !filterShiftType, position: "top" },
          title: { display: true, text: "Полотер (карты)" },
        },
        scales: {
          x: {
            title: { display: true, text: "Дата" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            title: { display: true, text: "Количество" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin()],
    });
  }

  createLogisticsChart(data, dataChanged) {
    const ctx = document.getElementById("logisticsChart");
    if (!ctx) return;

    const filterShiftType = document.getElementById("reportShiftType")?.value;
    const { labels, dayData, nightData } = this.prepareShiftData(
      data,
      "unloaded",
      "РАЗГРУЖЕННЫХ_МАШИН",
      filterShiftType,
    );
    const { dayData: dayData2, nightData: nightData2 } = this.prepareShiftData(
      data,
      "loaded",
      "ОТГРУЖЕННЫХ_МАШИН",
      filterShiftType,
    );

    // Вычисляем максимум для оси Y (+2)
    const allValues = [...dayData, ...nightData, ...dayData2, ...nightData2];
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const yMax = maxValue > 0 ? maxValue + 2 : 2;

    const datasets = [];
    // Разгружено - бирюзовый, Отгружено - золотой
    if (!filterShiftType || filterShiftType === "День") {
      datasets.push({
        label: "Разгружено (День)",
        data: dayData,
        borderColor: "#00CED1",
        backgroundColor: "#00CED1",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
      datasets.push({
        label: "Отгружено (День)",
        data: dayData2,
        borderColor: "#FFD700",
        backgroundColor: "#FFD700",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }
    if (!filterShiftType || filterShiftType === "Ночь") {
      datasets.push({
        label: "Разгружено (Ночь)",
        data: nightData,
        borderColor: "#008B8B",
        backgroundColor: "#fdfdfdff",
        borderDash: [8, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
      datasets.push({
        label: "Отгружено (Ночь)",
        data: nightData2,
        borderColor: "#B8860B",
        backgroundColor: "#ffffffff",
        borderDash: [8, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }

    if (this.charts.logistics && !dataChanged) return;
    if (this.charts.logistics) {
      this.charts.logistics.data.labels = labels;
      this.charts.logistics.data.datasets = datasets;
      this.charts.logistics.options.scales.y.max = yMax;
      this.charts.logistics.update("none");
      return;
    }

    this.charts.logistics = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          title: {
            display: true,
            text: "Логистика (машины)",
            font: { size: 16 },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Дата" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            title: { display: true, text: "Количество машин" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin()],
    });
  }

  createFurnaceChart(data, dataChanged) {
    let ctx = document.getElementById("furnaceChart");
    if (!ctx) {
      const container = document.getElementById("furnaceChartContainer");
      if (!container) return;
      ctx = document.createElement("canvas");
      ctx.id = "furnaceChart";
      container.appendChild(ctx);
    }

    if (this.charts.furnace && !dataChanged) return;

    const filterShiftType = document.getElementById("reportShiftType")?.value;

    // Получаем данные с разделением по день/ночь
    const {
      labels,
      dayData: smallDay,
      nightData: smallNight,
    } = this.prepareShiftData(
      data,
      "small_furnace",
      "САДОК_МАЛАЯ_ПЕЧЬ",
      filterShiftType,
    );
    const { dayData: largeDay, nightData: largeNight } = this.prepareShiftData(
      data,
      "large_furnace",
      "САДОК_БОЛЬШАЯ_ПЕЧЬ",
      filterShiftType,
    );

    // Вычисляем максимум для оси Y (+2)
    const allValues = [...smallDay, ...smallNight, ...largeDay, ...largeNight];
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const yMax = maxValue > 0 ? maxValue + 2 : 2;

    const datasets = [];
    // Малая печь - оранжевый, Большая печь - синий
    // Порядок: сначала День+Ночь для одной печи, потом следующая
    if (!filterShiftType || filterShiftType === "День") {
      datasets.push({
        label: "Малая печь (День)",
        data: smallDay,
        borderColor: "#FF8C00",
        backgroundColor: "#FF8C00",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }
    if (!filterShiftType || filterShiftType === "Ночь") {
      datasets.push({
        label: "Малая печь (Ночь)",
        data: smallNight,
        borderColor: "#8B4500",
        backgroundColor: "#ffffffff",
        borderDash: [8, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }
    if (!filterShiftType || filterShiftType === "День") {
      datasets.push({
        label: "Большая печь (День)",
        data: largeDay,
        borderColor: "#0066FF",
        backgroundColor: "#0066FF",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }
    if (!filterShiftType || filterShiftType === "Ночь") {
      datasets.push({
        label: "Большая печь (Ночь)",
        data: largeNight,
        borderColor: "#00008B",
        backgroundColor: "#ffffffff",
        borderDash: [8, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }

    if (this.charts.furnace) {
      this.charts.furnace.data.labels = labels;
      this.charts.furnace.data.datasets = datasets;
      this.charts.furnace.options.scales.y.max = yMax;
      this.charts.furnace.update("none");
      return;
    }

    this.charts.furnace = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: true, position: "top" },
          title: {
            display: true,
            text: "Термообработка (садки)",
            font: { size: 16 },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Дата" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            title: { display: true, text: "Количество садок" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin()],
    });
  }

  createEndsChartStamped(data, dataChanged) {
    const ctx = document.getElementById("endsChartStamped");
    if (!ctx) return;

    const filterShiftType = document.getElementById("reportShiftType")?.value;

    // Получаем данные для штамповки (все пресса)
    const {
      labels,
      dayData: stampedOldDay,
      nightData: stampedOldNight,
    } = this.prepareShiftData(
      data,
      "stamped_old",
      "ОТШТАМПОВАНО_ПРЕСС_СТАРЫЙ",
      filterShiftType,
    );
    const { dayData: stampedItalyDay, nightData: stampedItalyNight } =
      this.prepareShiftData(
        data,
        "stamped_italy",
        "ОТШТАМПОВАНО_ИТАЛЬЯНЕЦ",
        filterShiftType,
      );
    const { dayData: stampedNewDay, nightData: stampedNewNight } =
      this.prepareShiftData(
        data,
        "stamped_new",
        "ОТШТАМПОВАНО_ПРЕСС_НОВЫЙ",
        filterShiftType,
      );

    // Суммируем все штампованные
    const stampedDay = stampedOldDay.map(
      (v, i) => v + stampedItalyDay[i] + stampedNewDay[i],
    );
    const stampedNight = stampedOldNight.map(
      (v, i) => v + stampedItalyNight[i] + stampedNewNight[i],
    );

    // Отбортовка и калибровка
    const { dayData: flangedDay, nightData: flangedNight } =
      this.prepareShiftData(
        data,
        "flanged",
        "ОТБОРТОВАННЫХ_ДНИЩ",
        filterShiftType,
      );
    const { dayData: combinedDay, nightData: combinedNight } =
      this.prepareShiftData(
        data,
        "combined",
        "КОЛИБРОВАННЫХ_ДНИЩ",
        filterShiftType,
      );

    // Вычисляем максимум для оси Y (+2)
    const allValues = [
      ...stampedDay,
      ...stampedNight,
      ...flangedDay,
      ...flangedNight,
      ...combinedDay,
      ...combinedNight,
    ];
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const yMax = maxValue > 0 ? maxValue + 2 : 2;

    const datasets = [];
    // Цвета: Штамповка - красный, Отбортовка - синий, Калибровка - зелёный
    // Порядок: сначала День+Ночь для одной операции, потом следующая
    if (!filterShiftType || filterShiftType === "День") {
      datasets.push({
        label: "Отштамповано (День)",
        data: stampedDay,
        borderColor: "#FF0000",
        backgroundColor: "#FF0000",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }
    if (!filterShiftType || filterShiftType === "Ночь") {
      datasets.push({
        label: "Отштамповано (Ночь)",
        data: stampedNight,
        borderColor: "#8B0000",
        backgroundColor: "#ffffffff",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderDash: [8, 4],
      });
    }
    if (!filterShiftType || filterShiftType === "День") {
      datasets.push({
        label: "Отбортовано (День)",
        data: flangedDay,
        borderColor: "#0066FF",
        backgroundColor: "#0066FF",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }
    if (!filterShiftType || filterShiftType === "Ночь") {
      datasets.push({
        label: "Отбортовано (Ночь)",
        data: flangedNight,
        borderColor: "#00008B",
        backgroundColor: "#ffffffff",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderDash: [8, 4],
      });
    }
    if (!filterShiftType || filterShiftType === "День") {
      datasets.push({
        label: "Калибровано (День)",
        data: combinedDay,
        borderColor: "#00AA00",
        backgroundColor: "#00AA00",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }
    if (!filterShiftType || filterShiftType === "Ночь") {
      datasets.push({
        label: "Калибровано (Ночь)",
        data: combinedNight,
        borderColor: "#006400",
        backgroundColor: "#ffffffff",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderDash: [8, 4],
      });
    }

    if (this.charts.endsStamped && !dataChanged) return;

    if (this.charts.endsStamped) {
      this.charts.endsStamped.data.labels = labels;
      this.charts.endsStamped.data.datasets = datasets;
      this.charts.endsStamped.options.scales.y.max = yMax;
      this.charts.endsStamped.update("none");
      return;
    }

    this.charts.endsStamped = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: true, position: "top" },
        },
        scales: {
          x: {
            title: { display: true, text: "Дата" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            title: { display: true, text: "Количество" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin(10)],
    });
  }

  createEndsChartProcessed(data, dataChanged) {
    const ctx = document.getElementById("endsChartProcessed");
    if (!ctx) return;

    const filterShiftType = document.getElementById("reportShiftType")?.value;

    // Обрезка и упаковка
    const {
      labels,
      dayData: trimmedDay,
      nightData: trimmedNight,
    } = this.prepareShiftData(
      data,
      "trimmed",
      "ОБРЕЗАННЫХ_ДНИЩ",
      filterShiftType,
    );
    const { dayData: packedDay, nightData: packedNight } =
      this.prepareShiftData(
        data,
        "packed",
        "УПАКОВАННЫХ_ДНИЩ",
        filterShiftType,
      );

    // Вычисляем максимум для оси Y (+2)
    const allValues = [
      ...trimmedDay,
      ...trimmedNight,
      ...packedDay,
      ...packedNight,
    ];
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const yMax = maxValue > 0 ? maxValue + 2 : 2;

    const datasets = [];
    // Цвета: Обрезано - оранжевый, Упаковано - фиолетовый
    if (!filterShiftType || filterShiftType === "День") {
      datasets.push({
        label: "Обрезано (День)",
        data: trimmedDay,
        borderColor: "#FF8C00",
        backgroundColor: "#FF8C00",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
      datasets.push({
        label: "Упаковано (День)",
        data: packedDay,
        borderColor: "#9932CC",
        backgroundColor: "#9932CC",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }
    if (!filterShiftType || filterShiftType === "Ночь") {
      datasets.push({
        label: "Обрезано (Ночь)",
        data: trimmedNight,
        borderColor: "#8B4500",
        backgroundColor: "#ffffffff",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderDash: [8, 4],
      });
      datasets.push({
        label: "Упаковано (Ночь)",
        data: packedNight,
        borderColor: "#4B0082",
        backgroundColor: "#ffffffff",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderDash: [8, 4],
      });
    }

    if (this.charts.endsProcessed && !dataChanged) return;

    if (this.charts.endsProcessed) {
      this.charts.endsProcessed.data.labels = labels;
      this.charts.endsProcessed.data.datasets = datasets;
      this.charts.endsProcessed.options.scales.y.max = yMax;
      this.charts.endsProcessed.update("none");
      return;
    }

    this.charts.endsProcessed = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: true, position: "top" },
        },
        scales: {
          x: {
            title: { display: true, text: "Дата" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            title: { display: true, text: "Количество" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin(10)],
    });
  }

  createEndsChartRepair(data, dataChanged) {
    const ctx = document.getElementById("endsChartRepair");
    if (!ctx) return;

    const filterShiftType = document.getElementById("reportShiftType")?.value;

    // Ремонтные днища
    const {
      labels,
      dayData: repairDay,
      nightData: repairNight,
    } = this.prepareShiftData(
      data,
      "repair",
      "РЕМОНТНЫХ_ДНИЩ",
      filterShiftType,
    );

    // Вычисляем максимум для оси Y (+2)
    const allValues = [...repairDay, ...repairNight];
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    const yMax = maxValue > 0 ? maxValue + 2 : 2;

    const datasets = [];
    // Ремонтные - серый (день: ярко-серый, ночь: темно-серый прерывистый)
    if (!filterShiftType || filterShiftType === "День") {
      datasets.push({
        label: "Ремонтных (День)",
        data: repairDay,
        borderColor: "#808080",
        backgroundColor: "#808080",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }
    if (!filterShiftType || filterShiftType === "Ночь") {
      datasets.push({
        label: "Ремонтных (Ночь)",
        data: repairNight,
        borderColor: "#404040",
        backgroundColor: "#ffffffff",
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderDash: [8, 4],
      });
    }

    if (this.charts.endsRepair && !dataChanged) return;

    if (this.charts.endsRepair) {
      this.charts.endsRepair.data.labels = labels;
      this.charts.endsRepair.data.datasets = datasets;
      this.charts.endsRepair.options.scales.y.max = yMax;
      this.charts.endsRepair.update("none");
      return;
    }

    this.charts.endsRepair = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: true, position: "top" },
        },
        scales: {
          x: {
            title: { display: true, text: "Дата" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            max: yMax,
            title: { display: true, text: "Количество" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin(10)],
    });
  }

  /**
   * Отчёт по поломкам
   */
  createBreakdownsReport(data) {
    const container = document.getElementById("breakdownsReport");
    if (!container) return;

    const getText = (row, ...fields) => {
      for (const f of fields) {
        if (row[f] !== undefined && row[f] !== null && row[f] !== "") {
          return String(row[f]);
        }
      }
      return "";
    };

    const breakdowns = data
      .filter((d) => {
        const text = getText(d, "breakdowns", "Поломки", "ПОЛОМКИ_И_ПРОСТОИ");
        return text && text.trim() !== "";
      })
      .map((d) => ({
        date: this.formatChartDate(getText(d, "date", "Дата", "ДАТА")),
        shift: getText(d, "shift", "Смена", "СМЕНА"),
        text: getText(d, "breakdowns", "Поломки", "ПОЛОМКИ_И_ПРОСТОИ"),
      }));

    if (breakdowns.length === 0) {
      container.innerHTML =
        '<p class="empty-state">За выбранный период поломок не зарегистрировано</p>';
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

    html.push("</div>");
    container.innerHTML = html.join("");
  }
}

// Хелпер для экранирования
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Инициализация
document.addEventListener("DOMContentLoaded", () => {
  window.app = new App();

  const hash = window.location.hash.slice(1);
  if (hash === "view" || hash === "reports") {
    window.app.switchMode(hash);
  }

  // Регистрация Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .then((registration) => {
        // Проверяем обновления без принудительной перезагрузки
        registration.update().catch(() => {});
      })
      .catch(() => {});
  }
});

export default App;
