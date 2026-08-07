import DeviceList from './components/DeviceList'
import ScheduleWorkflow from './components/ScheduleWorkflow'
import { useHashRoute } from './hooks/useHashRoute'
import './App.css'

// Hash routes → views. Anything unrecognized falls through to Controllers.
const ROUTES = {
  controllers: '#/',
  schedule: '#/schedule',
} as const

function App() {
  const route = useHashRoute()
  const onSchedule = route === '/schedule'

  return (
    <>
      <nav className="app-nav" aria-label="Primary">
        <a
          href={ROUTES.controllers}
          className={`app-nav__tab${!onSchedule ? ' is-active' : ''}`}
          aria-current={!onSchedule ? 'page' : undefined}
        >
          Controllers
        </a>
        <a
          href={ROUTES.schedule}
          className={`app-nav__tab${onSchedule ? ' is-active' : ''}`}
          aria-current={onSchedule ? 'page' : undefined}
        >
          Schedule
        </a>
      </nav>

      {onSchedule ? <ScheduleWorkflow /> : <DeviceList />}
    </>
  )
}

export default App
