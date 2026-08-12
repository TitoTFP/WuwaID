import { useState, useEffect } from 'react';
import { fetchMe, loginUser, loginAdmin, logoutUser } from './api';

export function useAuth() {
  const [role, setRole] = useState<string>(() => localStorage.getItem('wuwaid_role') || 'reader');
  const [username, setUsername] = useState<string>('Guest');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchMe()
      .then((data) => {
        setRole(data.role);
        setUsername(data.username);
      })
      .catch(() => {
        setRole('reader');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleLogin = async (password?: string) => {
    const data = await loginUser(password);
    setRole(data.role);
    setUsername(data.username);
    return data;
  };

  const handleAdminLogin = async (password?: string) => {
    const data = await loginAdmin(password);
    setRole(data.role);
    setUsername(data.username);
    return data;
  };

  const handleLogout = async () => {
    await logoutUser();
    setRole('reader');
    setUsername('Guest');
  };

  return {
    role,
    username,
    loading,
    login: handleLogin,
    adminLogin: handleAdminLogin,
    logout: handleLogout,
  };
}
