/**
 * Главный модуль приложения (оптимизированная версия)
 */
"use strict";

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
    id: "customLabels",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
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
    },
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
    } else if (mode === "breakdowns") {
      this.loadBreakdownsData();
    } else if (mode === "breakdown-reports") {
      this.loadBreakdownReports();
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

    // Растягиваем таблицу на всю высоту экрана
    container.classList.add("fullscreen-table");
    const table = container.querySelector(".data-table");
    if (table) {
      table.style.width = "100%";
      table.style.minWidth = "100%";
    }

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

    // Растягиваем таблицу на всю высоту экрана
    container.classList.add("fullscreen-table");
    const table = container.querySelector(".data-table");
    if (table) {
      table.style.width = "100%";
      table.style.minWidth = "100%";
    }

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
        backgroundColor: "#4B0082",
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
        "КАЛИБРОВАННЫХ_ДНИЩ",
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
        backgroundColor: "#404040",
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

  /**
   * Загрузка данных поломок
   */
  async loadBreakdownsData() {
    // Инициализация формы если ещё не сделана
    this.initBreakdownForm();

    // Загрузка данных
    await this.loadBreakdownsTable();
  }

  /**
   * Инициализация формы поломок
   */
  async initBreakdownForm() {
    if (this.breakdownFormInitialized) return;

    const form = document.getElementById("breakdownForm");
    const sectorSelect = document.getElementById("breakdownSector");
    const equipmentSelect = document.getElementById("breakdownEquipment");
    const clearBtn = document.getElementById("clearBreakdownForm");
    const refreshBtn = document.getElementById("refreshBreakdowns");

    if (!form || !sectorSelect || !equipmentSelect) return;

    // Используем кешированные данные если есть, иначе загружаем
    if (!this.cachedSectors || !this.cachedEquipment) {
      const [sectors, equipment] = await Promise.all([
        this.storage.loadSectors(),
        this.storage.loadEquipment(),
      ]);
      this.cachedSectors = sectors;
      this.cachedEquipment = equipment;
    }

    const sectors = this.cachedSectors;
    const equipment = this.cachedEquipment;
    this.sectorsData = sectors;
    this.equipmentData = equipment;

    // Заполняем селект участков
    sectorSelect.innerHTML = '<option value="">Выберите участок</option>';
    sectors.forEach((sector) => {
      const option = document.createElement("option");
      option.value = sector.name || sector.Участок || sector.id;
      option.textContent = sector.name || sector.Участок || sector.id;
      option.dataset.id = sector.id;
      sectorSelect.appendChild(option);
    });

    // Обновление списка оборудования при изменении участка
    sectorSelect.addEventListener("change", () => {
      const sectorName = sectorSelect.value;
      const sectorId =
        sectorSelect.options[sectorSelect.selectedIndex]?.dataset?.id;

      equipmentSelect.innerHTML =
        '<option value="">Выберите оборудование</option>';

      // Фильтруем оборудование по участку
      const filteredEquipment = this.equipmentData.filter((eq) => {
        const eqSector = eq.sector_id || eq.Участок || eq.sector;
        return eqSector == sectorId || eqSector === sectorName;
      });

      filteredEquipment.forEach((eq) => {
        const option = document.createElement("option");
        option.value = eq.name || eq.Оборудование || eq.id;
        option.textContent = eq.name || eq.Оборудование || eq.id;
        equipmentSelect.appendChild(option);
      });
    });

    // Установка текущей даты и времени в поля
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const hh = String(today.getHours()).padStart(2, "0");
    const min = String(today.getMinutes()).padStart(2, "0");

    document.getElementById("breakdownDateFrom").value = `${yyyy}-${mm}-${dd}`;
    document.getElementById("breakdownTimeFrom").value = `${hh}:${min}`;

    // Функция расчета простоя
    const calculateDowntime = () => {
      const dateFrom = document.getElementById("breakdownDateFrom").value;
      const timeFrom = document.getElementById("breakdownTimeFrom").value;
      const dateTo = document.getElementById("breakdownDateTo").value;
      const timeTo = document.getElementById("breakdownTimeTo").value;
      const downtimeInput = document.getElementById("breakdownDowntime");

      if (!dateFrom || !timeFrom) {
        downtimeInput.value = "";
        return;
      }

      const startDate = new Date(`${dateFrom}T${timeFrom}`);
      let endDate;

      if (dateTo && timeTo) {
        endDate = new Date(`${dateTo}T${timeTo}`);
      } else if (dateTo) {
        endDate = new Date(`${dateTo}T00:00`);
      } else {
        // Если дата устранения не указана, используем текущее время
        endDate = new Date();
      }

      const diffMs = endDate - startDate;
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours >= 0) {
        downtimeInput.value = diffHours.toFixed(2);
      } else {
        downtimeInput.value = "0.00";
      }
    };

    // Добавляем обработчики для авторасчета
    document
      .getElementById("breakdownDateFrom")
      .addEventListener("change", calculateDowntime);
    document
      .getElementById("breakdownTimeFrom")
      .addEventListener("change", calculateDowntime);
    document
      .getElementById("breakdownDateTo")
      .addEventListener("change", calculateDowntime);
    document
      .getElementById("breakdownTimeTo")
      .addEventListener("change", calculateDowntime);

    // Начальный расчет
    calculateDowntime();

    // Отправка формы
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.submitBreakdown();
    });

    // Очистка формы
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        form.reset();
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById("breakdownDateFrom").value = now
          .toISOString()
          .slice(0, 16);
      });
    }

    // Обновление таблицы
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => this.loadBreakdownsTable());
    }

    this.breakdownFormInitialized = true;
  }

  /**
   * Отправка данных о поломке
   */
  async submitBreakdown() {
    const sector = document.getElementById("breakdownSector").value;
    const equipment = document.getElementById("breakdownEquipment").value;
    const dateFrom = document.getElementById("breakdownDateFrom").value;
    const timeFrom = document.getElementById("breakdownTimeFrom").value;
    const dateTo = document.getElementById("breakdownDateTo").value;
    const timeTo = document.getElementById("breakdownTimeTo").value;
    const downtime = document.getElementById("breakdownDowntime").value;
    const reason = document.getElementById("breakdownReason").value;

    if (!sector || !equipment || !dateFrom || !timeFrom || !reason) {
      alert(
        "Заполните обязательные поля (участок, оборудование, дату и время выхода, причину)",
      );
      return;
    }

    const btn = document.querySelector("#breakdownForm button[type='submit']");
    btn.disabled = true;
    btn.textContent = "Сохранение...";

    try {
      // Форматируем дату и время для отправки
      const dateFromFormatted =
        dateFrom && timeFrom ? `${dateFrom} ${timeFrom}` : dateFrom;
      const dateToFormatted =
        dateTo && timeTo ? `${dateTo} ${timeTo}` : dateTo || "";

      const result = await this.storage.submitBreakdown({
        sector,
        equipment,
        dateFrom: dateFromFormatted,
        dateTo: dateToFormatted,
        downtime: parseFloat(downtime) || 0,
        reason,
      });

      if (result.result === "success" || result.success) {
        alert("Поломка успешно зарегистрирована!");
        this.cachedBreakdowns = null; // Очистить кеш
        document.getElementById("breakdownForm").reset();
        await this.loadBreakdownsTable();
      } else {
        alert("Ошибка: " + (result.message || "Неизвестная ошибка"));
      }
    } catch (error) {
      alert("Ошибка отправки: " + error.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Зарегистрировать поломку";
    }
  }

  /**
   * Загрузка таблицы поломок
   */
  async loadBreakdownsTable() {
    const container = document.getElementById("breakdownsTableContainer");
    if (!container) return;

    container.innerHTML = "<p class='empty-state'>Загрузка...</p>";

    try {
      const breakdowns = await this.storage.loadBreakdowns();
      this.renderBreakdownsTable(breakdowns, container);
    } catch (error) {
      container.innerHTML = `<p class='error-message'>Ошибка загрузки: ${escapeHtml(error.message)}</p>`;
    }
  }

  /**
   * Отрисовка таблицы поломок
   */
  renderBreakdownsTable(breakdowns, container) {
    if (!breakdowns || breakdowns.length === 0) {
      container.innerHTML =
        '<p class="empty-state">Поломок не зарегистрировано</p>';
      return;
    }

    const html = ['<table class="data-table"><thead><tr>'];
    html.push("<th>Участок</th>");
    html.push("<th>Оборудование</th>");
    html.push("<th>Дата выхода</th>");
    html.push("<th>Дата устранения</th>");
    html.push("<th>Простой (ч)</th>");
    html.push("<th>Причина</th>");
    html.push("</tr></thead><tbody>");

    breakdowns.forEach((b) => {
      html.push(
        '<tr class="breakdown-row" data-id="' +
          escapeHtml(String(b.id || "")) +
          '">',
      );
      html.push("<td>" + escapeHtml(b.sector || "") + "</td>");
      html.push("<td>" + escapeHtml(b.equipment || "") + "</td>");
      html.push("<td>" + escapeHtml(b.dateFrom || "") + "</td>");
      html.push("<td>" + escapeHtml(b.dateTo || "-") + "</td>");
      html.push("<td>" + escapeHtml(String(b.downtime || "")) + "</td>");
      html.push("<td>" + escapeHtml(b.reason || "") + "</td>");
      html.push("</tr>");
    });

    html.push("</tbody></table>");
    container.innerHTML = html.join("");

    // Добавляем обработчики кликов через делегирование
    const table = container.querySelector("table");
    if (table) {
      table.addEventListener("click", (e) => {
        const row = e.target.closest(".breakdown-row");
        if (row) {
          const id = row.dataset.id;
          console.log("Клик на строку поломки, id:", id);
          const breakdown = breakdowns.find((b) => String(b.id) === String(id));
          if (breakdown) {
            console.log("Найдена поломка:", breakdown);
            this.showBreakdownModal(breakdown);
          } else {
            console.error(
              "Поломка не найдена, доступные id:",
              breakdowns.map((b) => b.id),
            );
          }
        }
      });
    }
  }

  /**
   * Показ модального окна поломки (просмотр/редактирование)
   */
  async showBreakdownModal(breakdown) {
    console.log("Открываем модальное окно для поломки:", breakdown);

    try {
      const modalId = "breakdownModal";

      // Удаляем существующее окно
      const existing = document.getElementById(modalId);
      if (existing) existing.remove();

      const modal = document.createElement("div");
      modal.id = modalId;
      modal.className = "modal-overlay view-modal";
      modal.style.cssText =
        "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex !important; align-items: center; justify-content: center; z-index: 9999; opacity: 1; visibility: visible;";

      console.log("Создаем модальное окно...");

      // Форматируем дату для отображения (DD.MM.YYYY)
      const formatDisplayDate = (dateStr) => {
        if (!dateStr) return "-";

        // Если формат "20.03.2026 14:12" или "20.03.2026"
        const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (match) {
          return `${match[1]}.${match[2]}.${match[3]}`;
        }

        // Если формат ISO
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          const day = String(d.getDate()).padStart(2, "0");
          const month = String(d.getMonth() + 1).padStart(2, "0");
          const year = d.getFullYear();
          return `${day}.${month}.${year}`;
        }

        return dateStr;
      };

      // Форматируем даты для input type="date" (YYYY-MM-DD)
      const formatDateInput = (dateStr) => {
        if (!dateStr) return "";

        // Если формат "20.03.2026 14:12" или "20.03.2026"
        const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (match) {
          return `${match[3]}-${match[2]}-${match[1]}`;
        }

        // Если формат ISO
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          return d.toISOString().slice(0, 10);
        }

        return "";
      };

      // Форматируем время для input type="time" (HH:mm)
      const formatTimeInput = (dateStr) => {
        if (!dateStr) return "";

        // Если формат "20.03.2026 14:12"
        const match = dateStr.match(/\d{2}\.\d{2}\.\d{4}\s+(\d{2}):(\d{2})/);
        if (match) {
          return `${match[1]}:${match[2]}`;
        }

        // Если формат ISO с временем
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          const hh = String(d.getHours()).padStart(2, "0");
          const mm = String(d.getMinutes()).padStart(2, "0");
          return `${hh}:${mm}`;
        }

        return "";
      };

      // Сначала добавляем в DOM чтобы показать загрузку
      modal.innerHTML = `
      <div class="modal-content" style="max-width: 700px; max-height: 90vh; overflow-y: auto; background: var(--bg-card); border-radius: var(--radius-lg); padding: 0; box-shadow: var(--shadow-lg); animation: modalSlideIn 0.2s ease-out;">
        <style>
          @keyframes modalSlideIn {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .info-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          .info-table th, .info-table td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border-light); }
          .info-table th { background: var(--primary-light); color: var(--primary-dark); font-weight: 600; width: 40%; }
          .info-table td { background: white; }
          .info-table tr:last-child th, .info-table tr:last-child td { border-bottom: none; }
        </style>
        
        <!-- Шапка в стиле карточки -->
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); color: white; padding: 20px 24px; border-radius: var(--radius-lg) var(--radius-lg) 0 0;">
          <h3 style="margin: 0; font-size: var(--text-xl); font-weight: 600;">Поломка #${escapeHtml(String(breakdown.id))}</h3>
          <button class="modal-close" id="btnCloseModalX" style="background: rgba(255,255,255,0.2); border: none; width: 32px; height: 32px; border-radius: 50%; font-size: 20px; cursor: pointer; color: white; display: flex; align-items: center; justify-content: center;">&times;</button>
        </div>
        
        <div style="padding: 24px;">
          <div style="text-align: center; padding: 40px;" id="breakdownLoading">
            <div style="border: 3px solid #f3f3f3; border-top: 3px solid var(--primary); border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto;"></div>
            <p style="margin-top: 15px; color: var(--text-secondary); font-size: 14px;">Загрузка данных...</p>
          </div>
          
          <!-- Режим просмотра - увеличенный шрифт -->
          <div id="breakdownViewMode" class="modal-body" style="margin-bottom: 0;">
            <table class="info-table" style="font-size: 16px;">
              <tr>
                <th style="font-size: 15px; padding: 16px 12px; width: 45%;">🏭 Участок</th>
                <td style="font-size: 16px; padding: 16px 12px; font-weight: 500;">${escapeHtml(breakdown.sector || "-")}</td>
              </tr>
              <tr>
                <th style="font-size: 15px; padding: 16px 12px;">⚙️ Оборудование</th>
                <td style="font-size: 16px; padding: 16px 12px; font-weight: 500;">${escapeHtml(breakdown.equipment || "-")}</td>
              </tr>
              <tr>
                <th style="font-size: 15px; padding: 16px 12px;">📅 Дата выхода из строя</th>
                <td style="font-size: 16px; padding: 16px 12px;">${formatDisplayDate(breakdown.dateFrom)}</td>
              </tr>
              <tr>
                <th style="font-size: 15px; padding: 16px 12px;">✅ Дата устранения</th>
                <td style="font-size: 16px; padding: 16px 12px;">${formatDisplayDate(breakdown.dateTo) || "<span style='color: #999;'>Не устранено</span>"}</td>
              </tr>
              <tr>
                <th style="font-size: 15px; padding: 16px 12px;">⏰ Время простоя (часов)</th>
                <td style="font-size: 18px; padding: 16px 12px; font-weight: 700; color: var(--primary);">${escapeHtml(String(breakdown.downtime || 0))}</td>
              </tr>
              <tr>
                <th style="font-size: 15px; padding: 16px 12px;">📝 Причина поломки</th>
                <td style="font-size: 15px; padding: 16px 12px; line-height: 1.5;">${escapeHtml(breakdown.reason || "-")}</td>
              </tr>
            </table>
          </div>
        
        <!-- Режим редактирования -->
        <div id="breakdownEditMode" class="modal-body" style="display: none;">
          <form id="breakdownEditForm">
            <input type="hidden" id="editBreakdownId" value="${breakdown.id}">
            
            <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
              <div class="form-group">
                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Участок *</label>
                <select id="editBreakdownSector" class="form-control" required style="width: 100%; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                  <option value="">Загрузка...</option>
                </select>
              </div>
              <div class="form-group">
                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Оборудование *</label>
                <select id="editBreakdownEquipment" class="form-control" required style="width: 100%; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                  <option value="">Сначала выберите участок</option>
                </select>
              </div>
            </div>
            
            <!-- Дата и время выхода -->
            <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
              <div class="form-group">
                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Дата выхода *</label>
                <input type="date" id="editBreakdownDateFrom" class="form-control" value="${formatDateInput(breakdown.dateFrom)}" required style="width: 100%; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
              </div>
              <div class="form-group">
                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Время выхода *</label>
                <input type="time" id="editBreakdownTimeFrom" class="form-control" value="${formatTimeInput(breakdown.dateFrom)}" required style="width: 100%; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
              </div>
            </div>
            
            <!-- Дата и время устранения -->
            <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
              <div class="form-group">
                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Дата устранения</label>
                <input type="date" id="editBreakdownDateTo" class="form-control" value="${formatDateInput(breakdown.dateTo)}" style="width: 100%; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
              </div>
              <div class="form-group">
                <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Время устранения</label>
                <input type="time" id="editBreakdownTimeTo" class="form-control" value="${formatTimeInput(breakdown.dateTo)}" style="width: 100%; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
              </div>
            </div>
            
            <!-- Авторасчитываемый простой -->
            <div class="form-group" style="margin-bottom: 16px;">
              <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Время простоя (часов) <span style="color: var(--success);">(авто)</span></label>
              <input type="number" id="editBreakdownDowntime" class="form-control" value="${breakdown.downtime}" min="0" step="0.01" readonly style="width: 150px; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-secondary); cursor: not-allowed;">
            </div>
            
            <div class="form-group">
              <label style="display: block; margin-bottom: 6px; font-weight: 500; color: var(--text-secondary);">Причина *</label>
              <textarea id="editBreakdownReason" class="form-control" rows="3" required style="width: 100%; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); resize: vertical; font-family: inherit;">${escapeHtml(breakdown.reason || "")}</textarea>
            </div>
          </form>
        </div>
        </div>
        
        <!-- Кнопки -->
        <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end; padding: 16px 24px; background: var(--bg-secondary); border-top: 1px solid var(--border-light); border-radius: 0 0 var(--radius-lg) var(--radius-lg);">
          <button type="button" id="btnDeleteBreakdown" class="btn btn-danger" style="display: flex; align-items: center; gap: 6px;">🗑️ Удалить</button>
          <button type="button" id="btnCloseBreakdown" class="btn btn-secondary">Закрыть</button>
          <button type="button" id="btnEditBreakdown" class="btn btn-primary" style="display: flex; align-items: center; gap: 6px;">✏️ Редактировать</button>
          <button type="button" id="btnSaveBreakdown" class="btn btn-success" style="display: none;">💾 Сохранить</button>
          <button type="button" id="btnCancelEditBreakdown" class="btn btn-secondary" style="display: none;">❌ Отмена</button>
        </div>
      </div>
    `;

      // Сразу добавляем в DOM и показываем окно
      document.body.appendChild(modal);
      console.log("Модальное окно добавлено в DOM");

      // Загружаем справочники для редактирования
      await this.loadBreakdownEditFormData(breakdown);

      // Убираем индикатор загрузки
      const loadingEl = document.getElementById("breakdownLoading");
      if (loadingEl) loadingEl.style.display = "none";

      // Функция расчета простоя в режиме редактирования
      const calculateEditDowntime = () => {
        const dateFrom = document.getElementById(
          "editBreakdownDateFrom",
        )?.value;
        const timeFrom = document.getElementById(
          "editBreakdownTimeFrom",
        )?.value;
        const dateTo = document.getElementById("editBreakdownDateTo")?.value;
        const timeTo = document.getElementById("editBreakdownTimeTo")?.value;
        const downtimeInput = document.getElementById("editBreakdownDowntime");

        if (!dateFrom || !timeFrom || !downtimeInput) return;

        const startDate = new Date(`${dateFrom}T${timeFrom}`);
        let endDate;

        if (dateTo && timeTo) {
          endDate = new Date(`${dateTo}T${timeTo}`);
        } else if (dateTo) {
          endDate = new Date(`${dateTo}T00:00`);
        } else {
          endDate = new Date();
        }

        const diffMs = endDate - startDate;
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours >= 0) {
          downtimeInput.value = diffHours.toFixed(2);
        } else {
          downtimeInput.value = "0.00";
        }
      };

      // Добавляем обработчики для авторасчета простоя
      document
        .getElementById("editBreakdownDateFrom")
        ?.addEventListener("change", calculateEditDowntime);
      document
        .getElementById("editBreakdownTimeFrom")
        ?.addEventListener("change", calculateEditDowntime);
      document
        .getElementById("editBreakdownDateTo")
        ?.addEventListener("change", calculateEditDowntime);
      document
        .getElementById("editBreakdownTimeTo")
        ?.addEventListener("change", calculateEditDowntime);

      // Обработчики кнопок
      const viewMode = modal.querySelector("#breakdownViewMode");
      const editMode = modal.querySelector("#breakdownEditMode");
      const btnEdit = modal.querySelector("#btnEditBreakdown");
      const btnSave = modal.querySelector("#btnSaveBreakdown");
      const btnDelete = modal.querySelector("#btnDeleteBreakdown");
      const btnClose = modal.querySelector("#btnCloseBreakdown");
      const btnCancel = modal.querySelector("#btnCancelEditBreakdown");

      // Закрыть
      btnClose.addEventListener("click", () => modal.remove());

      // Закрыть по кнопке X
      const btnCloseX = modal.querySelector("#btnCloseModalX");
      if (btnCloseX) btnCloseX.addEventListener("click", () => modal.remove());

      // Удалить
      btnDelete.addEventListener("click", async () => {
        if (confirm("Удалить запись о поломке?")) {
          try {
            await this.storage.deleteBreakdown(breakdown.id);
            this.cachedBreakdowns = null; // Очистить кеш
            modal.remove();
            await this.loadBreakdownsTable();
            alert("Запись удалена");
          } catch (error) {
            alert("Ошибка удаления: " + error.message);
          }
        }
      });

      // Редактировать
      btnEdit.addEventListener("click", () => {
        viewMode.style.display = "none";
        editMode.style.display = "block";
        btnEdit.style.display = "none";
        btnClose.style.display = "none";
        btnDelete.style.display = "none";
        btnSave.style.display = "inline-block";
        btnCancel.style.display = "inline-block";
      });

      // Отмена редактирования
      btnCancel.addEventListener("click", () => {
        viewMode.style.display = "block";
        editMode.style.display = "none";
        btnEdit.style.display = "inline-block";
        btnClose.style.display = "inline-block";
        btnDelete.style.display = "inline-block";
        btnSave.style.display = "none";
        btnCancel.style.display = "none";
      });

      // Сохранить
      btnSave.addEventListener("click", async () => {
        const form = modal.querySelector("#breakdownEditForm");
        if (!form.checkValidity()) {
          form.reportValidity();
          return;
        }

        btnSave.disabled = true;
        btnSave.textContent = "Сохранение...";

        try {
          // Получаем значения дат и времени
          const dateFrom = document.getElementById(
            "editBreakdownDateFrom",
          ).value;
          const timeFrom = document.getElementById(
            "editBreakdownTimeFrom",
          ).value;
          const dateTo = document.getElementById("editBreakdownDateTo").value;
          const timeTo = document.getElementById("editBreakdownTimeTo").value;

          // Форматируем дату и время для сохранения
          const dateFromFormatted =
            dateFrom && timeFrom ? `${dateFrom} ${timeFrom}` : dateFrom;
          const dateToFormatted =
            dateTo && timeTo ? `${dateTo} ${timeTo}` : dateTo || "";

          const updatedData = {
            id: breakdown.id,
            sector: document.getElementById("editBreakdownSector").value,
            equipment: document.getElementById("editBreakdownEquipment").value,
            dateFrom: dateFromFormatted,
            dateTo: dateToFormatted,
            downtime:
              parseFloat(
                document.getElementById("editBreakdownDowntime").value,
              ) || 0,
            reason: document.getElementById("editBreakdownReason").value,
          };

          console.log("Отправка данных на сервер:", updatedData);
          const result = await this.storage.updateBreakdown(updatedData);
          console.log("Результат:", result);

          if (result.result === "success" || result.success) {
            alert("Изменения сохранены!");
            this.cachedBreakdowns = null; // Очистить кеш
            modal.remove();
            await this.loadBreakdownsTable();
          } else {
            alert("Ошибка: " + (result.message || "Неизвестная ошибка"));
          }
        } catch (error) {
          alert("Ошибка сохранения: " + error.message);
        } finally {
          btnSave.disabled = false;
          btnSave.textContent = "💾 Сохранить";
        }
      });

      // Закрытие по клику вне окна
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.remove();
      });

      console.log("Модальное окно создано");
    } catch (error) {
      console.error("Ошибка при создании модального окна:", error);
      alert("Ошибка открытия окна: " + error.message);
    }
  }

  /**
   * Загрузка справочников для формы редактирования
   */
  async loadBreakdownEditFormData(breakdown) {
    const sectorSelect = document.getElementById("editBreakdownSector");
    const equipmentSelect = document.getElementById("editBreakdownEquipment");

    if (!sectorSelect || !equipmentSelect) return;

    // Используем кешированные данные или загружаем если нет
    if (!this.cachedSectors || !this.cachedEquipment) {
      const [sectors, equipment] = await Promise.all([
        this.storage.loadSectors(),
        this.storage.loadEquipment(),
      ]);
      this.cachedSectors = sectors;
      this.cachedEquipment = equipment;
    }

    const sectors = this.cachedSectors;
    const equipment = this.cachedEquipment;

    // Заполняем участки
    sectorSelect.innerHTML = '<option value="">Выберите участок</option>';
    sectors.forEach((sector) => {
      const option = document.createElement("option");
      option.value = sector.name || sector.Участок || sector.id;
      option.textContent = sector.name || sector.Участок || sector.id;
      option.dataset.id = sector.id;
      if ((sector.name || sector.Участок || sector.id) === breakdown.sector) {
        option.selected = true;
      }
      sectorSelect.appendChild(option);
    });

    // Обновление оборудования при изменении участка
    const updateEquipment = () => {
      const sectorName = sectorSelect.value;
      const sectorId =
        sectorSelect.options[sectorSelect.selectedIndex]?.dataset?.id;

      equipmentSelect.innerHTML =
        '<option value="">Выберите оборудование</option>';

      const filteredEquipment = equipment.filter((eq) => {
        const eqSector = eq.sector_id || eq.Участок || eq.sector;
        return eqSector == sectorId || eqSector === sectorName;
      });

      filteredEquipment.forEach((eq) => {
        const option = document.createElement("option");
        option.value = eq.name || eq.Оборудование || eq.id;
        option.textContent = eq.name || eq.Оборудование || eq.id;
        if ((eq.name || eq.Оборудование || eq.id) === breakdown.equipment) {
          option.selected = true;
        }
        equipmentSelect.appendChild(option);
      });
    };

    sectorSelect.addEventListener("change", updateEquipment);
    updateEquipment(); // Инициальная загрузка
  }

  /**
   * Загрузка отчетов по поломкам
   */
  async loadBreakdownReports() {
    // Установка дат по умолчанию - текущая дата с по
    const today = new Date();

    const dateFromEl = document.getElementById("breakdownReportDateFrom");
    const dateToEl = document.getElementById("breakdownReportDateTo");

    if (dateFromEl && !dateFromEl.value) dateFromEl.valueAsDate = today;
    if (dateToEl && !dateToEl.value) dateToEl.valueAsDate = today;

    // Обработчики (добавляем один раз)
    if (!this.breakdownReportsInitialized) {
      const generateBtn = document.getElementById("generateBreakdownReports");
      const resetBtn = document.getElementById("resetBreakdownFilters");

      if (generateBtn) {
        generateBtn.addEventListener("click", () =>
          this.generateBreakdownReports(),
        );
      }

      if (resetBtn) {
        resetBtn.addEventListener("click", () => this.resetBreakdownFilters());
      }

      this.breakdownReportsInitialized = true;
    }

    // Загружаем участки для фильтра (с кешированием)
    await this.loadBreakdownReportSectors();

    // Первичная загрузка
    await this.generateBreakdownReports();
  }

  /**
   * Загрузка участков для отчёта поломок (с кешированием)
   */
  async loadBreakdownReportSectors() {
    const sectorSelect = document.getElementById("breakdownReportSector");
    if (!sectorSelect) return;

    // Используем закешированные данные если есть
    if (!this.cachedSectors) {
      this.cachedSectors = await this.storage.loadSectors();
    }

    const currentValue = sectorSelect.value;
    sectorSelect.innerHTML = '<option value="">Все участки</option>';

    this.cachedSectors.forEach((sector) => {
      const option = document.createElement("option");
      const name = sector.name || sector.Участок || sector.id;
      option.value = name;
      option.textContent = name;
      sectorSelect.appendChild(option);
    });

    sectorSelect.value = currentValue;
  }

  /**
   * Сброс фильтров отчётов по поломкам
   */
  resetBreakdownFilters() {
    const today = new Date();

    const dateFromEl = document.getElementById("breakdownReportDateFrom");
    const dateToEl = document.getElementById("breakdownReportDateTo");
    const sectorEl = document.getElementById("breakdownReportSector");

    if (dateFromEl) dateFromEl.valueAsDate = today;
    if (dateToEl) dateToEl.valueAsDate = today;
    if (sectorEl) sectorEl.value = "";

    this.generateBreakdownReports();
  }

  /**
   * Парсинг даты из русского формата (DD.MM.YYYY HH:mm)
   */
  parseRussianDate(dateStr) {
    if (!dateStr) return null;
    // Формат: 19.03.2026 14:12
    const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s*(\d{2}):(\d{2})/);
    if (match) {
      const [, day, month, year, hour, minute] = match;
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
    }
    // Пробуем стандартный парсер
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Формирование отчетов по поломкам
   */
  async generateBreakdownReports() {
    const dateFromEl = document.getElementById("breakdownReportDateFrom");
    const dateToEl = document.getElementById("breakdownReportDateTo");
    const sectorEl = document.getElementById("breakdownReportSector");

    const dateFrom = dateFromEl?.value;
    const dateTo = dateToEl?.value;
    const sector = sectorEl?.value;

    try {
      // Используем кеш или загружаем
      let breakdowns = this.cachedBreakdowns;
      if (!breakdowns) {
        breakdowns = await this.storage.loadBreakdowns();
        this.cachedBreakdowns = breakdowns;
      }

      // Преобразуем даты фильтров
      const fromDate = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
      const toDate = dateTo ? new Date(dateTo + "T23:59:59") : null;

      // Фильтрация
      const filtered = breakdowns.filter((b) => {
        const bDate = this.parseRussianDate(b.dateFrom);
        if (!bDate) return false;

        if (fromDate && bDate < fromDate) return false;
        if (toDate && bDate > toDate) return false;
        if (sector && b.sector !== sector) return false;
        return true;
      });

      this.renderBreakdownDowntimeChart(filtered);
      this.renderBreakdownStatsTable(filtered);
    } catch (error) {
      console.error("Ошибка загрузки отчета:", error);
    }
  }

  /**
   * График простоев (в рамках 12-часовой смены)
   */
  renderBreakdownDowntimeChart(breakdowns) {
    const ctx = document.getElementById("breakdownDowntimeChart");
    if (!ctx) return;

    // Группируем по оборудованию
    const byEquipment = {};
    breakdowns.forEach((b) => {
      const key = b.equipment;
      if (!byEquipment[key]) byEquipment[key] = 0;
      byEquipment[key] += parseFloat(b.downtime || 0);
    });

    const labels = Object.keys(byEquipment);
    const data = Object.values(byEquipment);

    // Цвета в зависимости от процента (от 12 часов)
    const colors = data.map((hours) => {
      const percentage = hours / 12; // относительно 12-часовой смены
      if (percentage < 0.25) return "#4CAF50"; // зелёный (<3 ч)
      if (percentage < 0.5) return "#FF9800"; // оранжевый (<6 ч)
      return "#F44336"; // красный (>6 ч)
    });

    if (this.charts.breakdownDowntime) {
      this.charts.breakdownDowntime.destroy();
    }

    this.charts.breakdownDowntime = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Время простоя (часов)",
            data: data,
            backgroundColor: colors,
            borderColor: colors,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Простои оборудования",
          },
          annotation: {
            annotations: {
              line1: {
                type: "line",
                yMin: 12,
                yMax: 12,
                borderColor: "rgb(255, 99, 132)",
                borderWidth: 2,
                borderDash: [6, 6],
                label: {
                  content: "12 ч (смена)",
                  enabled: true,
                },
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: Math.max(12, ...data) + 1,
            title: { display: true, text: "Часы" },
          },
        },
      },
      plugins: [createCustomLabelsPlugin()],
    });
  }

  /**
   * Таблица статистики поломок (по оборудованию)
   */
  renderBreakdownStatsTable(breakdowns) {
    const container = document.getElementById("breakdownStatsTable");
    if (!container) return;

    if (breakdowns.length === 0) {
      container.innerHTML =
        '<p class="empty-state">Нет данных за выбранный период</p>';
      return;
    }

    // Статистика по оборудованию
    const byEquipment = {};
    breakdowns.forEach((b) => {
      if (!byEquipment[b.equipment]) {
        byEquipment[b.equipment] = { count: 0, downtime: 0 };
      }
      byEquipment[b.equipment].count++;
      byEquipment[b.equipment].downtime += parseFloat(b.downtime || 0);
    });

    const html = ['<table class="data-table"><thead><tr>'];
    html.push("<th>Оборудование</th>");
    html.push("<th>Кол-во поломок</th>");
    html.push("<th>Общий простой (ч)</th>");
    html.push("<th>Простой (смен)</th>");
    html.push("</tr></thead><tbody>");

    Object.entries(byEquipment).forEach(([equipment, stats]) => {
      const shifts = (stats.downtime / 12).toFixed(2); // Простой в сменах (12 часов)
      html.push("<tr>");
      html.push("<td>" + escapeHtml(equipment) + "</td>");
      html.push("<td>" + stats.count + "</td>");
      html.push("<td>" + stats.downtime.toFixed(1) + "</td>");
      html.push("<td>" + shifts + "</td>");
      html.push("</tr>");
    });

    html.push("</tbody></table>");
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
  if (
    hash === "view" ||
    hash === "reports" ||
    hash === "breakdowns" ||
    hash === "breakdown-reports"
  ) {
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
