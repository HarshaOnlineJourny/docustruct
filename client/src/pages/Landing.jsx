import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    window.location.href = '/dashboard';
    return null;
  }

  const features = [
    {
      icon: '📄',
      title: 'Document Extraction',
      description: 'Extract structured data from any PDF or document type with AI precision',
    },
    {
      icon: '📋',
      title: 'Reusable Templates',
      description: 'Create templates once, apply to thousands of documents instantly',
    },
    {
      icon: '🧠',
      title: 'AI-Powered Learning',
      description: 'AI learns from your patterns and improves extraction accuracy over time',
    },
  ];

  const stats = [
    { value: '2.1M+', label: 'Pages Processed' },
    { value: '98.4%', label: 'Field Accuracy' },
    { value: '$0.06', label: 'Avg. Cost / 400pp' },
  ];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9f8f6' }}>
      {/* Navigation */}
      <nav style={{
        padding: '20px 40px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #e2e8f0',
        background: 'white',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="3" width="14" height="18" rx="2" stroke="#a5b4fc" strokeWidth="1.6" />
            <path d="M8 8h6M8 12h6M8 16h4" stroke="#a5b4fc" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M14 7l6 3v8a3 3 0 0 1-3 3" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="20" cy="9" r="1.5" fill="#4f46e5" />
          </svg>
          <span style={{ fontSize: '20px', fontWeight: 700, color: '#1a1814' }}>DocuStruct</span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <button
            onClick={() => navigate('/login')}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: 'transparent',
              color: '#4f46e5',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => e.target.style.color = '#4040d0'}
            onMouseLeave={(e) => e.target.style.color = '#4f46e5'}
          >
            Sign In
          </button>
          <button
            onClick={() => navigate('/signup')}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: '#4f46e5',
              color: 'white',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => e.target.style.background = '#4040d0'}
            onMouseLeave={(e) => e.target.style.background = '#4f46e5'}
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section style={{
        padding: '100px 40px',
        textAlign: 'center',
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <h1 style={{
          fontSize: '56px',
          fontWeight: 700,
          lineHeight: 1.2,
          marginBottom: '20px',
          color: '#1a1814',
        }}>
          Turn PDFs into Structured Data
        </h1>
        <p style={{
          fontSize: '18px',
          color: '#64748b',
          lineHeight: 1.6,
          marginBottom: '40px',
          maxWidth: '700px',
          margin: '0 auto 40px',
        }}>
          DocuStruct extracts information from documents with AI precision. Create templates once, apply to thousands of documents instantly.
        </p>

        {/* CTA Buttons */}
        <div style={{ marginBottom: '40px' }}>
          <button
            onClick={() => navigate('/signup')}
            style={{
              padding: '16px 40px',
              background: '#4f46e5',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 600,
              cursor: 'pointer',
              marginRight: '16px',
              transition: 'all 0.3s',
            }}
            onMouseEnter={(e) => e.target.style.background = '#4040d0'}
            onMouseLeave={(e) => e.target.style.background = '#4f46e5'}
          >
            Get Started Free
          </button>
          <button
            onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}
            style={{
              padding: '16px 40px',
              background: 'white',
              color: '#4f46e5',
              border: '2px solid #4f46e5',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.3s',
            }}
            onMouseEnter={(e) => e.target.style.background = '#f0f0ff'}
            onMouseLeave={(e) => e.target.style.background = 'white'}
          >
            Learn More
          </button>
        </div>

        <p style={{
          fontSize: '14px',
          color: '#94a3b8',
        }}>
          No credit card required. Start extracting data in minutes.
        </p>
      </section>

      {/* Stats Section */}
      <section style={{
        background: '#f1f5f9',
        padding: '60px 40px',
        marginTop: '40px',
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '40px',
          textAlign: 'center',
        }}>
          {stats.map((stat, idx) => (
            <div key={idx}>
              <div style={{
                fontSize: '36px',
                fontWeight: 700,
                color: '#4f46e5',
                marginBottom: '8px',
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: '14px',
                color: '#64748b',
                fontWeight: 500,
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section style={{
        padding: '80px 40px',
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <h2 style={{
          fontSize: '40px',
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: '60px',
          color: '#1a1814',
        }}>
          Powerful Features
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '40px',
        }}>
          {features.map((feature, idx) => (
            <div
              key={idx}
              style={{
                padding: '30px',
                background: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                transition: 'all 0.3s',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.1)';
                e.currentTarget.style.transform = 'translateY(-5px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{
                fontSize: '48px',
                marginBottom: '16px',
              }}>
                {feature.icon}
              </div>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 600,
                marginBottom: '12px',
                color: '#1a1814',
              }}>
                {feature.title}
              </h3>
              <p style={{
                fontSize: '14px',
                color: '#64748b',
                lineHeight: 1.6,
              }}>
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonial Section */}
      <section style={{
        background: '#f1f5f9',
        padding: '80px 40px',
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
        }}>
          <h2 style={{
            fontSize: '40px',
            fontWeight: 700,
            textAlign: 'center',
            marginBottom: '60px',
            color: '#1a1814',
          }}>
            Trusted by Industry Leaders
          </h2>
          <div style={{
            background: 'white',
            padding: '40px',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            textAlign: 'center',
            maxWidth: '600px',
            margin: '0 auto',
          }}>
            <p style={{
              fontSize: '16px',
              color: '#64748b',
              lineHeight: 1.8,
              marginBottom: '30px',
              fontStyle: 'italic',
            }}>
              "First run got us to 96% accuracy. The review queue did the rest."
            </p>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
            }}>
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: '#4f46e5',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 600,
              }}>
                AC
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: '#1a1814',
                }}>
                  Adaeze Chukwu
                </div>
                <div style={{
                  fontSize: '13px',
                  color: '#94a3b8',
                }}>
                  Director of Operations · Halstead Brokerage
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section style={{
        padding: '80px 40px',
        textAlign: 'center',
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <h2 style={{
          fontSize: '40px',
          fontWeight: 700,
          marginBottom: '20px',
          color: '#1a1814',
        }}>
          Ready to Transform Your Document Processing?
        </h2>
        <p style={{
          fontSize: '18px',
          color: '#64748b',
          marginBottom: '40px',
        }}>
          Join companies extracting data faster and more accurately.
        </p>
        <button
          onClick={() => navigate('/signup')}
          style={{
            padding: '16px 40px',
            background: '#4f46e5',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.3s',
          }}
          onMouseEnter={(e) => e.target.style.background = '#4040d0'}
          onMouseLeave={(e) => e.target.style.background = '#4f46e5'}
        >
          Get Started Now
        </button>
      </section>

      {/* Footer */}
      <footer style={{
        background: '#1a1814',
        color: 'white',
        padding: '50px 40px 30px',
        marginTop: '60px',
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto 40px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '40px',
          fontSize: '13px',
        }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '16px', fontSize: '14px' }}>Product</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              <li style={{ marginBottom: '8px' }}><a href="#" style={{ color: '#d1d5db', textDecoration: 'none' }}>Features</a></li>
              <li style={{ marginBottom: '8px' }}><a href="#" style={{ color: '#d1d5db', textDecoration: 'none' }}>Pricing</a></li>
              <li><a href="#" style={{ color: '#d1d5db', textDecoration: 'none' }}>Security</a></li>
            </ul>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '16px', fontSize: '14px' }}>Company</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              <li style={{ marginBottom: '8px' }}><a href="#" style={{ color: '#d1d5db', textDecoration: 'none' }}>About</a></li>
              <li style={{ marginBottom: '8px' }}><a href="#" style={{ color: '#d1d5db', textDecoration: 'none' }}>Blog</a></li>
              <li><a href="#" style={{ color: '#d1d5db', textDecoration: 'none' }}>Contact</a></li>
            </ul>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '16px', fontSize: '14px' }}>Legal</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              <li style={{ marginBottom: '8px' }}><a href="#" style={{ color: '#d1d5gb', textDecoration: 'none' }}>Privacy</a></li>
              <li style={{ marginBottom: '8px' }}><a href="#" style={{ color: '#d1d5gb', textDecoration: 'none' }}>Terms</a></li>
              <li><a href="#" style={{ color: '#d1d5gb', textDecoration: 'none' }}>Status</a></li>
            </ul>
          </div>
        </div>
        <div style={{
          borderTop: '1px solid #374151',
          paddingTop: '30px',
          textAlign: 'center',
          fontSize: '12px',
          color: '#9ca3af',
          maxWidth: '1200px',
          margin: '0 auto',
        }}>
          © 2026 DocuStruct, Inc. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
