import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { App } from './App.js';
import { StageApp } from './Stage.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('presenter: #root element missing from index.html');

// Role by query param (SHOW_PLAN.md §3, revised): the default route is the
// PRIMARY window (loads data, then flips into the fullscreen stage on
// launch); `?role=control` is the control popup that launch opens; and
// `?role=stage` remains a standalone follower for manual multi-monitor
// setups.
const role = new URLSearchParams(window.location.search).get('role');

createRoot(rootEl).render(
  <StrictMode>
    {role === 'stage' ? <StageApp /> : role === 'control' ? <App popup /> : <App />}
  </StrictMode>,
);
