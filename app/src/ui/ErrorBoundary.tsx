import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State { hasError: boolean; report: string }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, report: '' }

  static getDerivedStateFromError(): State {
    return { hasError: true, report: '' }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const report = JSON.stringify({ message: error.message, stack: error.stack, info: info.componentStack, ts: Date.now() }, null, 2)
    this.setState({ report })
    window.localStorage.setItem('gamno.lastError', report)
  }

  render() {
    if (this.state.hasError) {
      return <main className="page"><article className="panel"><h1>Произошла ошибка</h1><div className="settings-actions"><button type="button" onClick={() => navigator.clipboard.writeText(this.state.report)}>Скопировать отчёт</button><a href="#/system">Открыть Система</a></div></article></main>
    }
    return this.props.children
  }
}
