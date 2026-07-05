import React from 'react';
import ReactDOM from 'react-dom/client';
import { inject } from '@vercel/analytics';
import App from './App.jsx';
import './index.css';

// Privacy-friendly, cookieless page analytics. Enable Web Analytics for the
// project in the Vercel dashboard to start collecting; no-ops until then.
inject();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
