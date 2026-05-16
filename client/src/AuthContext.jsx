import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('session_token');
    const savedUser = localStorage.getItem('user');
    const savedOrg = localStorage.getItem('organization');

    if (savedToken && savedUser && savedOrg) {
      setSessionToken(savedToken);
      setUser(JSON.parse(savedUser));
      setOrganization(JSON.parse(savedOrg));
    }

    setIsLoading(false);
  }, []);

  const signup = async (orgName, email, password) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: orgName,
          email,
          password,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Signup failed');
      }

      const data = await response.json();
      const token = data.session?.id || data.session_id;

      setSessionToken(token);
      setUser(data.user);
      setOrganization(data.organization);

      localStorage.setItem('session_token', token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('organization', JSON.stringify(data.organization));

      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email, password) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Login failed');
      }

      const data = await response.json();
      const token = data.session?.id || data.session_id;

      setSessionToken(token);
      setUser(data.user);
      setOrganization(data.organization);

      localStorage.setItem('session_token', token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('organization', JSON.stringify(data.organization));

      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setOrganization(null);
    setSessionToken(null);
    setError(null);

    localStorage.removeItem('session_token');
    localStorage.removeItem('user');
    localStorage.removeItem('organization');
  };

  const isAuthenticated = !!sessionToken && !!user && !!organization;

  const value = {
    user,
    organization,
    sessionToken,
    isAuthenticated,
    isLoading,
    error,
    signup,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
