import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installErrorReporter } from './services/errorReporter'
import { cleanupLegacyStorage } from './utils/storageCleanup'
import { captureInstallPrompt } from './utils/installApp'

// Uncaught browser errors are reported to the Pusat Maintenance (AGENTS.md §22)
installErrorReporter()
// Free the browser storage from the large copies older versions kept there (AGENTS.md §28)
cleanupLegacyStorage()
// Keep the browser's install prompt for the "Pasang App" button (desktop Dock / phone home screen)
captureInstallPrompt()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
