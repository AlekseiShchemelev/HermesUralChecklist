/**
 * Модуль работы с Google Sheets
 */
import CONFIG from './config.js';

export class Storage {
  constructor() {
    this.data = [];
  }

  /**
   * Загружает данные из Google Sheets (JSONP)
   */
  async load() {
    const data = await this.loadFromGoogleScript();
    this.data = data;
    return data;
  }

  /**
   * JSONP загрузка
   */
  loadFromGoogleScript() {
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
        // Защита от undefined response
        if (!response) {
          reject(new Error('Empty response from server'));
          return;
        }
        if (response.result === 'success' && Array.isArray(response.data)) {
          resolve(response.data);
        } else {
          reject(new Error(response.message || 'Invalid response format'));
        }
      };
      
      const cleanup = () => {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      };
      
      const script = document.createElement('script');
      script.src = url;
      script.onerror = () => {
        clearTimeout(timeout);
        cleanup();
        reject(new Error('Script error'));
      };
      
      document.head.appendChild(script);
    });
  }

  /**
   * Сохраняет запись в Google Sheets
   */
  async save(data) {
    const sendData = { ...data };
    
    if (data.isUpdate && data.id) {
      sendData.__update_id = data.id;
    }
    
    await fetch(CONFIG.appsScriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendData),
    });
    
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
      body: JSON.stringify({ __delete_id: id }),
    });
    
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
      ...this.data.map(row => headers.map(h => row[h] ?? '').join(';'))
    ].join('\n');
    
    return csv;
  }
}

export default Storage;
