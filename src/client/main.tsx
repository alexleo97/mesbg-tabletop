import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// No StrictMode: its double mount would open and immediately close the room's socket.
createRoot(document.getElementById('root')!).render(<App />);
