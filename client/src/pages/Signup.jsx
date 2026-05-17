import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../AuthContext.jsx';

export default function Signup() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

    if (!fullName.trim()) {
      newErrors.fullName = 'Full name is required';
    } else if (fullName.trim().length < 2) {
      newErrors.fullName = 'Full name must be at least 2 characters';
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
      // Use full name as organization name for now
      await signup(fullName, email, password);
      navigate('/dashboard');
    } catch (err) {
      setErrors({ general: err.message || 'Signup failed. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setLoading(true);
    setErrors({});

    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: credentialResponse.credential }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Google signup failed');
      }

      const data = await response.json();
      const token = data.session;

      // Store in localStorage
      localStorage.setItem('session_token', token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('organization', JSON.stringify(data.organization));

      // Redirect to dashboard
      navigate('/dashboard');
    } catch (err) {
      setErrors({ general: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleGithubSignup = () => {
    const clientId = process.env.REACT_APP_GITHUB_CLIENT_ID;
    const redirectUri = `${window.location.origin}/auth/github/callback`;

    if (!clientId) {
      setErrors({ general: 'GitHub OAuth not configured' });
      return;
    }

    const scope = 'user:email';
    const authorizeUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}`;
    window.location.href = authorizeUrl;
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f9f8f6' }}>
      {/* Left Side - Dark Content */}
      <div style={{
        flex: 1,
        background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
        color: 'white',
        padding: '60px 40px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: '100vh',
      }}>
        <div style={{ maxWidth: '480px' }}>
          <div style={{ fontSize: '12px', letterSpacing: '2px', color: 'rgba(255,255,255,0.6)', marginBottom: '20px', textTransform: 'uppercase' }}>
            Get Started - Free
          </div>
          <h1 style={{ fontSize: '48px', fontWeight: 700, lineHeight: '1.2', marginBottom: '30px' }}>
            Turn one sample PDF into <em style={{ fontStyle: 'italic' }}>structured data</em> in <span style={{ color: '#818cf8' }}>90 seconds.</span>
          </h1>

          <div style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            padding: '20px',
            marginTop: '40px',
          }}>
            <p style={{ fontSize: '14px', fontStyle: 'italic', lineHeight: '1.6', marginBottom: '15px' }}>
              "First run got us to 96% accuracy. The review queue did the rest."
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 600,
              }}>
                AC
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>Adaeze Chukwu</div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>Director of Operations · Halstead Brokerage</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '40px', marginTop: '50px', fontSize: '13px' }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>2.1M+</div>
              <div style={{ color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pages Processed</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>98.4%</div>
              <div style={{ color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Field Accuracy</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>$0.06</div>
              <div style={{ color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Avg. Cost / 400 pp</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div style={{
        flex: 1,
        padding: '60px 40px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: '100vh',
        maxWidth: '500px',
        margin: '0 auto',
      }}>
        <div style={{ position: 'absolute', top: '20px', right: '40px', fontSize: '14px', color: '#64748b' }}>
          Already signed up?{' '}
          <Link to="/login" style={{ color: '#4f46e5', textDecoration: 'none', fontWeight: 500 }}>
            Sign in
          </Link>
        </div>

        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '32px', fontWeight: 700, marginBottom: '8px', color: '#1a1814' }}>
            Create your workspace
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b' }}>
            14 days of Team free. No card. Your data, your model keys.
          </p>
        </div>

        {/* OAuth Buttons */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          {process.env.REACT_APP_GOOGLE_CLIENT_ID ? (
            <div style={{ flex: 1 }}>
              <GoogleOAuthProvider clientId={process.env.REACT_APP_GOOGLE_CLIENT_ID}>
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setErrors({ general: 'Google signup failed' })}
                  theme="outline"
                  size="large"
                  width="100%"
                />
              </GoogleOAuthProvider>
            </div>
          ) : (
            <button
              disabled
              style={{
                flex: 1,
                padding: '12px 16px',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                background: '#f3f4f6',
                color: '#9ca3af',
                cursor: 'not-allowed',
                fontSize: '14px',
                fontWeight: 500,
              }}
            >
              Google
            </button>
          )}
          <button
            onClick={handleGithubSignup}
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px 16px',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              background: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'all 0.2s',
              opacity: loading ? 0.5 : 1,
            }}
            onMouseEnter={(e) => !loading && (e.target.style.backgroundColor = '#f8f9fa')}
            onMouseLeave={(e) => !loading && (e.target.style.backgroundColor = 'white')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v 3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </button>
        </div>

        {/* Divider */}
        <div style={{ position: 'relative', marginBottom: '24px' }}>
          <div style={{ borderTop: '1px solid #e2e8f0' }} />
          <div style={{
            position: 'absolute',
            top: '-12px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#f9f8f6',
            padding: '0 8px',
            fontSize: '12px',
            color: '#94a3b8',
            fontWeight: 500,
          }}>
            OR WITH EMAIL
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* General error */}
          {errors.general && (
            <div style={{
              background: '#fee2e2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '20px',
              fontSize: '14px',
              color: '#991b1b',
            }}>
              {errors.general}
            </div>
          )}

          {/* Full Name */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px', color: '#1a1814' }}>
              Full name
            </label>
            <input
              type="text"
              placeholder="Adaeze Chukwu"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px 14px',
                border: errors.fullName ? '1px solid #ef4444' : '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '14px',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            {errors.fullName && (
              <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>{errors.fullName}</div>
            )}
          </div>

          {/* Email */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px', color: '#1a1814' }}>
              Work email
            </label>
            <input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px 14px',
                border: errors.email ? '1px solid #ef4444' : '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '14px',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            {errors.email && (
              <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>{errors.email}</div>
            )}
          </div>

          {/* Password */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px', color: '#1a1814' }}>
              Password
            </label>
            <input
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px 14px',
                border: errors.password ? '1px solid #ef4444' : '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '14px',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            {errors.password && (
              <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>{errors.password}</div>
            )}
          </div>

          {/* Terms */}
          <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <input type="checkbox" id="terms" style={{ cursor: 'pointer', marginTop: '2px' }} required />
            <label htmlFor="terms" style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer', lineHeight: 1.5 }}>
              I agree to the <Link to="#" style={{ color: '#4f46e5', textDecoration: 'none' }}>Terms</Link> and{' '}
              <Link to="#" style={{ color: '#4f46e5', textDecoration: 'none' }}>Privacy Policy</Link>
            </label>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              background: loading ? '#9ca3af' : '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => !loading && (e.target.style.background = '#4b5563')}
            onMouseLeave={(e) => !loading && (e.target.style.background = '#6b7280')}
          >
            {loading ? '⏳ Creating workspace...' : '→ Create workspace'}
          </button>
        </form>
      </div>
    </div>
  );
}
