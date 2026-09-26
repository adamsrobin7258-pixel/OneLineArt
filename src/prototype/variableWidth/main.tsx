import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/theme.css';
import './lab.css';
import { VariableWidthLab } from './VariableWidthLab';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root missing');

createRoot(root).render(
  <StrictMode>
    <VariableWidthLab />
  </StrictMode>,
);
