/**
 * Модуль работы с Google Sheets
 * Использует JSONP для GET (надёжно) и no-cors для POST
 */
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
      
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout'));
      }, 20000);
      
      window[callbackName] = (response) => {
        clearTimeout(timeout);
        cleanup();
        
        if (response?.result === 'success' && Array.isArray(response.data)) {
          this.data = response.data;
          this._saveToCache(response.data);
          resolve(response.data);
        } else {
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
        clearTimeout(timeout);
        cleanup();
        reject(new Error('Failed to load'));
      };
      
      document.head.appendChild(script);
    });
  }

  /**
   * Сохраняет запись через no-cors (единственный рабочий способ для Google Script)
   */
  async save(data) {
    const sendData = { ...data };
    
    if (data.isUpdate && data.id) {
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
}

export default Storage;
