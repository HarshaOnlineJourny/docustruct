import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function GithubCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      console.error('GitHub auth error:', error);
      navigate('/login?error=' + encodeURIComponent(error));
      return;
    }

    if (code) {
      // Exchange code for token on backend
      (async () => {
        try {
          const response = await fetch('/api/auth/github', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'GitHub authentication failed');
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
          console.error('GitHub callback error:', err);
          navigate('/login?error=' + encodeURIComponent(err.message));
        }
      })();
    }
  }, [searchParams, navigate]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#f9f8f6',
      flexDirection: 'column',
      gap: '16px',
    }}>
      <div style={{ fontSize: '18px', fontWeight: 600, color: '#1a1814' }}>Signing you in with GitHub...</div>
      <div style={{ width: '40px', height: '40px', border: '3px solid #e2e8f0', borderTop: '3px solid #4f46e5', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
