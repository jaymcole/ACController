import { useState } from 'react'
import DeviceList from './components/DeviceList'
import ScheduleWorkflow from './components/ScheduleWorkflow'
import './App.css'

type View = 'controllers' | 'schedule'

function App() {
  const [view, setView] = useState<View>('controllers')

  return (
    <>
      <nav className="app-nav" aria-label="Primary">
        <button
          type="button"
          className={`app-nav__tab${view === 'controllers' ? ' is-active' : ''}`}
          aria-pressed={view === 'controllers'}
          onClick={() => setView('controllers')}
        >
          Controllers
        </button>
        <button
          type="button"
          className={`app-nav__tab${view === 'schedule' ? ' is-active' : ''}`}
          aria-pressed={view === 'schedule'}
          onClick={() => setView('schedule')}
        >
          Schedule
        </button>
      </nav>

      {view === 'controllers' ? <DeviceList /> : <ScheduleWorkflow />}
    </>
  )
}

export default App
