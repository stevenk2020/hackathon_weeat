import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from './i18n';
import { AppProvider } from './services/AppContext';
import { isMock } from './services/config';
import { configureAuthentication } from './services/liveAuth';
import App from './App';
import './styles/tokens.css';
import './styles/app.css';
async function start() {
  if (!isMock) await configureAuthentication();
  createRoot(document.getElementById('root')!).render(<StrictMode><I18nProvider><BrowserRouter><AppProvider><App/></AppProvider></BrowserRouter></I18nProvider></StrictMode>);
}
void start();
