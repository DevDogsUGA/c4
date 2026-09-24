import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './index.css';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('testground: #root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
