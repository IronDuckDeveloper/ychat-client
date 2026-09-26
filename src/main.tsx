import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { store } from './store'
import './i18n/config';
import './styles/global.scss'
import App from './App.tsx'

// import { enablePush, disablePush } from './lib/push/pushService.ts'
// ;(window as any).enablePush = enablePush
// ;(window as any).disablePush = disablePush

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
)
