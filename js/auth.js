/**
 * Модуль авторизации
 * Проверка логина/пароля через Google Sheets
 */
import CONFIG from './config.js';

const AUTH_KEY = 'hermes_auth_session';

class Auth {
  constructor() {
    this.currentUser = null;
    this.loadSession();
  }

  /**
   * Загружает сессию из localStorage
   */
  loadSession() {
    try {
      const session = localStorage.getItem(AUTH_KEY);
      if (session) {
        const data = JSON.parse(session);
        // Проверяем срок действия (24 часа)
        if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
          this.currentUser = data.user;
          return true;
        }
        // Сессия истекла
        localStorage.removeItem(AUTH_KEY);
      }
    } catch (e) {
      localStorage.removeItem(AUTH_KEY);
    }
    return false;
  }

  /**
   * Сохраняет сессию
   */
  saveSession(user) {
    const session = {
      user: user,
      timestamp: Date.now()
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    this.currentUser = user;
  }

  /**
   * Выход из системы
   */
  logout() {
    localStorage.removeItem(AUTH_KEY);
    this.currentUser = null;
    window.location.reload();
  }

  /**
   * Проверяет авторизацию через Google Script
   */
  async login(fio, password) {
    try {
      const callbackName = 'authCallback_' + Date.now();
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(7);
      const url = `${CONFIG.appsScriptUrl}?action=auth&fio=${encodeURIComponent(fio)}&password=${encodeURIComponent(password)}&callback=${callbackName}&t=${timestamp}&r=${random}`;
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout'));
        }, 15000);

        window[callbackName] = (response) => {
          clearTimeout(timeout);
          cleanup();
          
          if (response?.result === 'success' && response.user) {
            this.saveSession(response.user);
            resolve({ success: true, user: response.user });
          } else {
            resolve({ success: false, message: response?.message || 'Неверный логин или пароль' });
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
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Проверяет, авторизован ли пользователь
   */
  isAuthenticated() {
    return !!this.currentUser;
  }

  /**
   * Возвращает текущего пользователя
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Проверяет права администратора
   */
  isAdmin() {
    return this.currentUser?.role === 'admin';
  }
}

const auth = new Auth();
export default auth;
