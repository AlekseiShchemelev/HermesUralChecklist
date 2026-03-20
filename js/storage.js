/**
 * Модуль работы с Google Sheets
 * Использует JSONP для GET (надёжно) и no-cors для POST
 */
'use strict';

import CONFIG from './config.js';

// Константы для кэширования
const CACHE_KEY = 'checklist_data_cache';
const CACHE_TIMESTAMP_KEY = 'checklist_cache_timestamp';
const CACHE_DURATION = 5 * 60 * 1000; // 5 минут

export class Storage {
  constructor() {
    this.data = [];
    this._loadFromCache();
  }
  
  /**
   * Загружает данные из localStorage
   */
  _loadFromCache() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
      
      if (cached && timestamp) {
        const age = Date.now() - parseInt(timestamp, 10);
        if (age < CACHE_DURATION) {
          this.data = JSON.parse(cached);
          return true;
        }
      }
    } catch (e) {}
    return false;
  }
  
  _saveToCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()));
    } catch (e) {}
  }
  
  clearCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    } catch (e) {}
    this.data = [];
  }

  /**
   * Загружает данные через JSONP (всегда работает)
   */
  async load(forceRefresh = false) {
    if (!forceRefresh && this.data.length > 0) {
      return this.data;
    }
    
    // Пробуем загрузить с 3 попытками
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.loadJSONP();
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, attempt * 1000));
        }
      }
    }
    // Если есть кэш - используем его
    if (this.data.length > 0) {
      return this.data;
    }
    // Иначе возвращаем пустой массив
    return [];
  }
  
  /**
   * JSONP загрузка с fetch fallback
   */
  async loadJSONP() {
    return new Promise((resolve, reject) => {
      const callbackName = 'gsCallback_' + Date.now();
      if (!CONFIG.appsScriptUrl || !CONFIG.appsScriptUrl.includes('script.google.com')) {
        reject(new Error('Invalid Google Script URL'));
        return;
      }
      
      const url = `${CONFIG.appsScriptUrl}?action=get&callback=${callbackName}`;
      let isHandled = false;
      
      const timeout = setTimeout(() => {
        if (!isHandled) {
          isHandled = true;
          cleanup();
          reject(new Error('Timeout'));
        }
      }, 30000); // Увеличили до 30 секунд
      
      window[callbackName] = (response) => {
        // Защита от двойного вызова
        if (isHandled) return;
        isHandled = true;
        
        clearTimeout(timeout);
        
        if (response?.result === 'success' && Array.isArray(response.data)) {
          this.data = response.data;
          this._saveToCache(response.data);
          cleanup();
          resolve(response.data);
        } else {
          cleanup();
          reject(new Error(response?.message || 'Invalid response'));
        }
      };
      
      const cleanup = () => {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      };
      
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onerror = () => {
        if (!isHandled) {
          isHandled = true;
          clearTimeout(timeout);
          cleanup();
          reject(new Error('Failed to load'));
        }
      };
      
      document.head.appendChild(script);
    });
  }

  /**
   * Сохраняет запись через no-cors (единственный рабочий способ для Google Script)
   */
  async save(data) {
    const sendData = { ...data };
    
    // Если есть id - это обновление существующей записи
    if (data.id) {
      sendData.__update_id = data.id;
    }
    
    // Используем no-cors - единственный способ для Google Script
    await fetch(CONFIG.appsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendData)
    });
    
    // Очищаем кэш
    this.clearCache();
    
    return { result: 'success' };
  }

  /**
   * Удаляет запись
   */
  async delete(id) {
    await fetch(CONFIG.appsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ __delete_id: id })
    });
    
    this.clearCache();
    return { result: 'success' };
  }

  /**
   * Универсальный метод отправки данных на сервер
   */
  async sendData(payload) {
    try {
      // Используем JSONP для GET, но для POST с no-cors ответ недоступен
      // Поэтому просто отправляем и надеемся на успех
      await fetch(CONFIG.appsScriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      // При no-cors мы не можем прочитать ответ, так что предполагаем успех
      return { result: 'success' };
    } catch (error) {
      console.error('Ошибка отправки:', error);
      return { result: 'error', message: error.message || 'Ошибка сети' };
    }
  }

  /**
   * Экспорт в CSV
   */
  exportToCSV() {
    if (this.data.length === 0) return null;
    
    const headers = Object.keys(this.data[0]);
    const csv = [
      headers.join(';'),
      ...this.data.map(row => headers.map(h => {
        const val = row[h] ?? '';
        if (typeof val === 'string' && (val.includes(';') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(';'))
    ].join('\n');
    
    return csv;
  }

  /**
   * Отправка данных о поломке
   */
  async submitBreakdown(data) {
    const payload = {
      action: "addBreakdown",
      sector: data.sector,
      equipment: data.equipment,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo || "",
      downtime: data.downtime,
      reason: data.reason
    };
    
    return this.sendData(payload);
  }

  /**
   * Загрузка списка поломок
   */
  async loadBreakdowns() {
    try {
      const response = await fetch(`${CONFIG.appsScriptUrl}?action=getBreakdowns`);
      const data = await response.json();
      return data.breakdowns || [];
    } catch (error) {
      console.error("Ошибка загрузки поломок:", error);
      return [];
    }
  }

  /**
   * Загрузка списка участков
   */
  async loadSectors() {
    try {
      const response = await fetch(`${CONFIG.appsScriptUrl}?action=getSectors`);
      const data = await response.json();
      return data.sectors || [];
    } catch (error) {
      console.error("Ошибка загрузки участков:", error);
      return [];
    }
  }

  /**
   * Загрузка списка оборудования
   */
  async loadEquipment() {
    try {
      const response = await fetch(`${CONFIG.appsScriptUrl}?action=getEquipment`);
      const data = await response.json();
      return data.equipment || [];
    } catch (error) {
      console.error("Ошибка загрузки поломок:", error);
      return [];
    }
  }

  /**
   * Удаление поломки
   */
  async deleteBreakdown(id) {
    const payload = {
      action: "deleteBreakdown",
      id: id
    };
    
    return this.sendData(payload);
  }
  
  /**
   * Обновление поломки через JSONP GET
   */
  async updateBreakdown(data) {
    return new Promise((resolve, reject) => {
      const callbackName = 'updateCallback_' + Date.now();
      
      // Создаем скрипт для обратного вызова
      window[callbackName] = (response) => {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve(response);
      };
      
      // Формируем URL с параметрами
      const params = new URLSearchParams({
        action: 'updateBreakdown',
        callback: callbackName,
        id: data.id,
        sector: data.sector,
        equipment: data.equipment,
        dateFrom: data.dateFrom,
        dateTo: data.dateTo || '',
        downtime: data.downtime,
        reason: data.reason
      });
      
      const script = document.createElement('script');
      script.src = `${CONFIG.appsScriptUrl}?${params.toString()}`;
      
      script.onerror = () => {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('Ошибка загрузки'));
      };
      
      // Таймаут на случай если callback не вызовется
      setTimeout(() => {
        if (window[callbackName]) {
          delete window[callbackName];
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(new Error('Таймаут запроса'));
        }
      }, 30000);
      
      document.head.appendChild(script);
    });
  }
}

export default Storage;
