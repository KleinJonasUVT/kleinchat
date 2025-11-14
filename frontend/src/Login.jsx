import React, { useState } from 'react';
import './Login.css';

function Login({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');


  const handleCredentialResponse = async (response) => {
    try {
      setLoading(true);
      
      const loginResponse = await fetch('http://localhost:5001/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ token: response.credential }),
      });

      if (loginResponse.ok) {
        const data = await loginResponse.json();
        if (data.success && onLogin) {
          onLogin(data.user);
        }
      } else {
        const errorData = await loginResponse.json().catch(() => ({}));
        setError(errorData.error || 'Login failed. Please try again.');
      }
    } catch (err) {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    // Load Google Identity Services on mount
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);

    script.onload = () => {
      if (window.google) {
        const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
        if (!clientId) {
          setError('Google Client ID is not configured. Please set REACT_APP_GOOGLE_CLIENT_ID in your .env file.');
          return;
        }
        
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
        });
        
        // Render the button
        window.google.accounts.id.renderButton(
          document.getElementById('google-signin-button'),
          {
            theme: 'outline',
            size: 'large',
            width: 250,
          }
        );
      }
    };

    return () => {
      // Cleanup
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <img 
            src="/images/jk_svg.svg" 
            alt="JK" 
            className="login-logo"
          />
          <h1>KleinChat</h1>
          <p>Sign in to continue</p>
        </div>
        
        {error && <div className="login-error">{error}</div>}
        
        <div className="login-actions">
          <div id="google-signin-button"></div>
        </div>
      </div>
    </div>
  );
}

export default Login;

