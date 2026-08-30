import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Expires': '0',
  }
});

// Add a request interceptor to append the token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mc_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Add a response interceptor to handle expired sessions
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('mc_token');
      localStorage.removeItem('mc_last_refresh_date');
      const currentPath = window.location.pathname;
      if (currentPath !== '/' && currentPath !== '/login' && currentPath !== '/privacy' && currentPath !== '/terms') {
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
