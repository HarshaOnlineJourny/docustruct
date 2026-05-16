import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Signup() {
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { signup, isAuthenticated } = useAuth();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const validateForm = () => {
    const newErrors = {};

    if (!orgName.trim()) {
      newErrors.orgName = 'Organization name is required';
    } else if (orgName.trim().length < 2) {
      newErrors.orgName = 'Organization name must be at least 2 characters';
    }

    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
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
      await signup(orgName, email, password);
      // Navigate to dashboard on success (handled by AuthContext)
      navigate('/dashboard');
    } catch (err) {
      setErrors({ general: err.message || 'Signup failed. Please try again.' });
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
          <h2>Create your account</h2>
          <p className="auth-form-subtitle">
            Get started in minutes. No credit card required.
          </p>

          {/* General error */}
          {errors.general && (
            <div className="form-alert form-alert-error">
              {errors.general}
            </div>
          )}

          {/* Organization Name */}
          <div className="form-group">
            <label htmlFor="orgName">Organization name</label>
            <input
              id="orgName"
              type="text"
              placeholder="Acme Corporation"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className={errors.orgName ? 'form-input form-input-error' : 'form-input'}
              disabled={loading}
            />
            {errors.orgName && (
              <span className="form-error">{errors.orgName}</span>
            )}
          </div>

          {/* Email */}
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              placeholder="you@acme.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={errors.email ? 'form-input form-input-error' : 'form-input'}
              disabled={loading}
            />
            {errors.email && (
              <span className="form-error">{errors.email}</span>
            )}
          </div>

          {/* Password */}
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={errors.password ? 'form-input form-input-error' : 'form-input'}
              disabled={loading}
            />
            {errors.password && (
              <span className="form-error">{errors.password}</span>
            )}
            {!errors.password && (
              <span className="form-hint">Min. 8 characters</span>
            )}
          </div>

          {/* Confirm Password */}
          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={errors.confirmPassword ? 'form-input form-input-error' : 'form-input'}
              disabled={loading}
            />
            {errors.confirmPassword && (
              <span className="form-error">{errors.confirmPassword}</span>
            )}
          </div>

          {/* Submit Button */}
          <button type="submit" className="button button-primary button-block" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner"></span>
                Creating account...
              </>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="auth-footer">
          Already have an account?{' '}
          <Link to="/login" className="button button-text">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
