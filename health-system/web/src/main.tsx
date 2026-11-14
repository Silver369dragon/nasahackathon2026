import { createRoot } from 'react-dom/client'
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import App from './App'
import { stationBase } from './api'
import { WallFeed } from './WallFeed'

const wall = stationBase === '/stations/display' && location.pathname === stationBase + '/board' &&
  new URLSearchParams(location.search).get('surface') === 'wall' && window.parent !== window
createRoot(document.getElementById('root')!).render(wall ? <WallFeed /> : <App />)
