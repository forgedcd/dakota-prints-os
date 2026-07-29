import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { ToastHost } from './components/kit';
import { AuthProvider } from './lib/store';

// HashRouter: the deployed preview is served from a nested path inside an iframe,
// where path-based routing breaks. On Render at os.dakotaprints.com it behaves the same.
createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <ToastHost>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastHost>
  </HashRouter>,
);
