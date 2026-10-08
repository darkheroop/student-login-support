import { apiClient } from './client';
import { AdminUser } from '../types';

export const authApi = {
  login: async (username: string, password: string): Promise<AdminUser> => {
    const { data } = await apiClient.post<{ user: AdminUser }>('/api/auth/login', { username, password });
    return data.user;
  },
  logout: async (): Promise<void> => {
    await apiClient.post('/api/auth/logout');
  },
  getMe: async (): Promise<AdminUser> => {
    const { data } = await apiClient.get<{ user: AdminUser }>('/api/auth/me');
    return data.user;
  }
};
