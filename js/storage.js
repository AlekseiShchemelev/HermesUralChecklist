/**
 * Модуль работы с Google Sheets (CORS версия)
 */
import CONFIG from './config.js';

// Константы для кэширования
const CACHE_KEY = 'checklist_data_cache';
const CACHE_TIMESTAMP_KEY = 'checklist_cache_timestamp';
const CACHE_DURATION = 5 * 60 * 1000; // 5 минут

export class Storage {
  constructor() {
    this.data = [];
    this.abortController = null;
    this._loadFromCache();
  }
  
  /**
   * Загружает данные из localStorage (быстрый старт)
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
    } catch (e) {
      // Игнорируем ошибки localStorage
    }
    return false;
  }
  
  /**
   * Сохраняет данные в localStorage
   */
  _saveToCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()));
    } catch (e) {
      // Игнорируем ошибки (может быть переполнение)
    }
  }
  
  /**
   * Очищает кэш
   */
  clearCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    } catch (e) {
      // Игнорируем ошибки
    }
    this.data = [];
  }

  /**
   * Загружает данные из Google Sheets (CORS)
   */
  async load(forceRefresh = false) {
    // Если есть свежий кэш и не требуется принудительное обновление
    if (!forceRefresh && this.data.length > 0) {
      return this.data;
    }
    
    // Отменяем предыдущий запрос если есть
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    
    try {
      const response = await fetch(`${CONFIG.appsScriptUrl}?action=get`, {
        method: 'GET',
        headers: { 
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        signal: this.abortController.signal
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.result !== 'success') {
        throw new Error(result.message || 'Server error');
      }
      
      this.data = result.data || [];
      this._saveToCache(this.data);
      return this.data;
      
    } catch (error) {
      if (error.name === 'AbortError') {
        // Request cancelled
        return this.data; // Возвращаем текущие данные
      }
      
      // Fallback на JSONP если CORS не работает
      return this.loadJSONP();
      
    } finally {
      this.abortController = null;
    }
  }
  
  /**
   * JSONP fallback для старых браузеров или если CORS не настроен
   */
  loadJSONP() {
    return new Promise((resolve, reject) => {
      const callbackName = 'gsCallback_' + Date.now();
      const url = `${CONFIG.appsScriptUrl}?action=get&callback=${callbackName}`;
      
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout'));
      }, 10000);
      
      window[callbackName] = (response) => {
        clearTimeout(timeout);
        cleanup();
        
        if (!response) {
          reject(new Error('Empty response'));
          return;
        }
        
        if (response.result === 'success' && Array.isArray(response.data)) {
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
        reject(new Error('Script load error'));
      };
      
      document.head.appendChild(script);
    });
  }

  /**
   * Сохраняет запись в Google Sheets (CORS)
   */
  async save(data) {
    if (!CONFIG.appsScriptUrl) {
      throw new Error('Google Script URL not configured');
    }
    
    const sendData = { ...data };
    
    if (data.isUpdate && data.id) {
      sendData.__update_id = data.id;
    }
    
    // AbortController для таймаута
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 сек
    
    try {
      const response = await fetch(CONFIG.appsScriptUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(sendData),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      
      const result = await response.json();
      
      // Очищаем кэш после успешного сохранения
      this.clearCache();
      
      return result;
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Request timeout (30s)');
      }
      
      // Fallback на no-cors если CORS не работает
      return this.saveNoCors(sendData);
    }
  }
  
  /**
   * Fallback сохранение без CORS (не получаем ответ)
   */
  async saveNoCors(data) {
    await fetch(CONFIG.appsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    // Очищаем кэш
    this.clearCache();
    
    // Возвращаем псевдо-успех (не знаем реальный результат)
    return { result: 'success', message: 'Sent (no-cors mode)' };
  }

  /**
   * Удаляет запись
   */
  async delete(id) {
    if (!CONFIG.appsScriptUrl) {
      throw new Error('Google Script URL not configured');
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    try {
      const response = await fetch(CONFIG.appsScriptUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ __delete_id: id }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      this.clearCache();
      return result;
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Fallback на no-cors
      await fetch(CONFIG.appsScriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ __delete_id: id })
      });
      
      this.clearCache();
      return { result: 'success' };
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
        // Экранируем кавычки и точки с запятой
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
