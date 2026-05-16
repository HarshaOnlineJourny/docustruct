import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  // Redirect authenticated users to dashboard
  if (isAuthenticated) {
    navigate('/dashboard');
    return null;
  }

  const features = [
    {
      title: 'Document Extraction',
      description: 'Extract structured data from any PDF or document type with precision',
      icon: '📄',
    },
    {
      title: 'Reusable Templates',
      description: 'Create templates once, apply to thousands of documents instantly',
      icon: '📋',
    },
    {
      title: 'AI-Powered Intelligence',
      description: 'AI learns from your patterns and improves extraction accuracy over time',
      icon: '✨',
    },
  ];

  return (
    <div className="landing-page">
      {/* Navigation Header */}
      <header className="landing-header">
        <div className="landing-header-content">
          <div className="landing-logo">
            <span style={{ fontSize: '24px', marginRight: '8px' }}>📊</span>
            <span className="landing-logo-text">DocuStruct</span>
          </div>
          <nav className="landing-nav">
            <button
              className="button button-text"
              onClick={() => navigate('/login')}
            >
              Sign In
            </button>
            <button
              className="button button-primary"
              onClick={() => navigate('/signup')}
            >
              Get Started
            </button>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="landing-hero">
        <div className="landing-hero-content">
          <h1 className="landing-headline">
            Turn PDFs into Structured Data
          </h1>
          <p className="landing-subheading">
            DocuStruct extracts information from documents with AI precision.
            Create templates once, apply to thousands of documents instantly.
          </p>
          <button
            className="button button-primary landing-cta"
            onClick={() => navigate('/signup')}
          >
            Get Started Free
          </button>
          <p className="landing-subtext">
            No credit card required. Start extracting data in minutes.
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="landing-features-section">
        <div className="landing-container">
          <h2 className="landing-section-title">Powerful Features</h2>
          <div className="landing-features-grid">
            {features.map((feature, index) => (
              <div key={index} className="landing-feature-card">
                <div className="landing-feature-icon">{feature.icon}</div>
                <h3 className="landing-feature-title">{feature.title}</h3>
                <p className="landing-feature-description">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="landing-cta-section">
        <div className="landing-container">
          <h2 className="landing-cta-title">Ready to get started?</h2>
          <p className="landing-cta-description">
            Join teams using DocuStruct to automate document processing
          </p>
          <button
            className="button button-primary"
            onClick={() => navigate('/signup')}
          >
            Create Free Account
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-content">
            <div className="landing-footer-left">
              <p>&copy; 2026 DocuStruct. All rights reserved.</p>
            </div>
            <div className="landing-footer-right">
              <button
                className="button button-text"
                onClick={() => navigate('/login')}
              >
                Sign In
              </button>
              <button
                className="button button-text"
                onClick={() => navigate('/signup')}
              >
                Sign Up
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
