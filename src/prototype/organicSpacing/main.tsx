import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/theme.css';
import '../variableWidth/lab.css';
import { OrganicSpacingLab } from './OrganicSpacingLab';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root missing');

createRoot(root).render(
  <StrictMode>
    <OrganicSpacingLab />
  </StrictMode>,
);
