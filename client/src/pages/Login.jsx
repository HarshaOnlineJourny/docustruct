import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const validateForm = () => {
    const newErrors = {};

    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    }

    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({});

    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setLoading(true);

    try {
      await login(email, password);
      // Navigate to dashboard on success (handled by AuthContext)
      navigate('/dashboard');
    } catch (err) {
      setErrors({ general: err.message || 'Login failed. Please check your credentials.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        {/* Brand */}
        <div className="auth-brand">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="3" width="14" height="18" rx="2" stroke="#a5b4fc" strokeWidth="1.6" />
            <path d="M8 8h6M8 12h6M8 16h4" stroke="#a5b4fc" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M14 7l6 3v8a3 3 0 0 1-3 3" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="20" cy="9" r="1.5" fill="#4f46e5" />
          </svg>
          <h1>DocuStruct</h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form">
          <h2>Sign in to your account</h2>
          <p className="auth-form-subtitle">
            Welcome back. Enter your details to get started.
          </p>

          {/* General error */}
          {errors.general && (
            <div className="form-alert form-alert-error">
              {errors.general}
            </div>
          )}

          {/* Email */}
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={errors.email ? 'form-input form-input-error' : 'form-input'}
              disabled={loading}
              autoComplete="email"
            />
            {errors.email && (
              <span className="form-error">{errors.email}</span>
            )}
          </div>

          {/* Password */}
          <div className="form-group">
            <div className="form-group-header">
              <label htmlFor="password">Password</label>
              <button
                type="button"
                className="button button-text button-text-small"
                disabled={true}
                title="Password reset coming soon"
              >
                Forgot?
              </button>
            </div>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={errors.password ? 'form-input form-input-error' : 'form-input'}
              disabled={loading}
              autoComplete="current-password"
            />
            {errors.password && (
              <span className="form-error">{errors.password}</span>
            )}
          </div>

          {/* Submit Button */}
          <button type="submit" className="button button-primary button-block" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner"></span>
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="auth-footer">
          Don't have an account?{' '}
          <Link to="/signup" className="button button-text">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
