import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class DesktopErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string }> {
  state = { message: '' }

  static getDerivedStateFromError(error: unknown) {
    return {
      message: error instanceof Error ? error.message : 'CrawClaw Desktop UI crashed.',
    }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('CrawClaw Desktop UI crashed', error, info.componentStack)
  }

  render() {
    if (this.state.message) {
      return (
        <main className="desktop-fatal-error" role="alert">
          <strong>桌面界面加载失败</strong>
          <p>{this.state.message}</p>
        </main>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopErrorBoundary>
      <App />
    </DesktopErrorBoundary>
  </React.StrictMode>,
)
