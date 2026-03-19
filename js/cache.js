/**
 * Модуль для работы с IndexedDB
 * Более быстрый и ёмкий чем localStorage
 */
'use strict';

const DB_NAME = 'ChecklistDB';
const DB_VERSION = 1;
const STORE_RECORDS = 'records';
const STORE_METADATA = 'metadata';

export class IndexedCache {
  constructor() {
    this.db = null;
    this.initPromise = null;
    this.maxAge = 5 * 60 * 1000; // 5 минут по умолчанию
  }

  /**
   * Инициализация БД
   */
  async init() {
    if (this.initPromise) return this.initPromise;
    if (this.db) return;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        // IndexedDB error
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Хранилище записей
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          const store = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('timestamp', '_cachedAt', { unique: false });
        }

        // Хранилище метаданных
        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          db.createObjectStore(STORE_METADATA, { keyPath: 'key' });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Сохраняет массив записей
   */
  async setRecords(records) {
    await this.init();
    
    const transaction = this.db.transaction([STORE_RECORDS, STORE_METADATA], 'readwrite');
    const store = transaction.objectStore(STORE_RECORDS);
    const metaStore = transaction.objectStore(STORE_METADATA);

    // Очищаем старые данные
    await store.clear();

    // Добавляем timestamp к каждой записи
    const now = Date.now();
    const recordsWithMeta = records.map(r => ({
      ...r,
      _cachedAt: now
    }));

    // Пакетная вставка
    for (const record of recordsWithMeta) {
      store.put(record);
    }

    // Сохраняем метаданные
    metaStore.put({ key: 'lastUpdate', value: now });
    metaStore.put({ key: 'count', value: records.length });

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Получает все записи
   */
  async getRecords() {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE_RECORDS, 'readonly');
      const store = transaction.objectStore(STORE_RECORDS);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Проверяет валидность кэша
   */
  async isValid(maxAge = this.maxAge) {
    try {
      await this.init();
      
      const meta = await this.getMetadata('lastUpdate');
      if (!meta) return false;

      const age = Date.now() - meta.value;
      return age < maxAge;
    } catch (e) {
      return false;
    }
  }

  /**
   * Получает метаданные
   */
  async getMetadata(key) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE_METADATA, 'readonly');
      const store = transaction.objectStore(STORE_METADATA);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Получает количество записей в кэше
   */
  async getCount() {
    const meta = await this.getMetadata('count');
    return meta?.value || 0;
  }

  /**
   * Очищает кэш
   */
  async clear() {
    await this.init();
    
    const transaction = this.db.transaction([STORE_RECORDS, STORE_METADATA], 'readwrite');
    transaction.objectStore(STORE_RECORDS).clear();
    transaction.objectStore(STORE_METADATA).clear();

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Поиск по индексу (быстрее чем полный перебор)
   */
  async findByDate(dateFrom, dateTo) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE_RECORDS, 'readonly');
      const store = transaction.objectStore(STORE_RECORDS);
      const index = store.index('date');
      
      const results = [];
      const range = IDBKeyRange.bound(dateFrom, dateTo);
      const request = index.openCursor(range);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }
}

// Синглтон для использования в приложении
export const indexedCache = new IndexedCache();

export default indexedCache;
