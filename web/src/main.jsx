import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './lib/notifications.js';
import { applyAppearance } from './lib/settings.js';
import './styles.css';

applyAppearance();
createRoot(document.getElementById('root')).render(<App />);
