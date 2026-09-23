import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './ui/theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
