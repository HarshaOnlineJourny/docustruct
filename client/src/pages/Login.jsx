import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }

      // Store session token
      localStorage.setItem('session_token', data.session);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('org', JSON.stringify(data.organization));

      // Redirect to dashboard
      navigate('/dashboard');
    } catch (err) {
      console.error('[login]', err);
      setError('Network error. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-brand">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="3" width="14" height="18" rx="2" stroke="#a5b4fc" strokeWidth="1.6" />
            <path d="M8 8h6M8 12h6M8 16h4" stroke="#a5b4fc" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M14 7l6 3v8a3 3 0 0 1-3 3" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="20" cy="9" r="1.5" fill="#4f46e5" />
          </svg>
          <h1>DocuStruct</h1>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <h2>Log in</h2>

          {error && <div className="auth-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Logging in...' : 'Log in'}
          </button>
        </form>

        <p className="auth-footer">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
