import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AuthProvider } from './auth'
import { RouterProvider } from './router'
import { ToastProvider } from './toasts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </RouterProvider>
  </StrictMode>,
)
