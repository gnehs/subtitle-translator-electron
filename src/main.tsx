import React from 'react'
import ReactDOM from 'react-dom/client'
import DefaultLayout from './layouts/default'
import 'react-tooltip/dist/react-tooltip.css'
import './samples/node-api'
import 'normalize.css'
import './index.sass'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DefaultLayout />
  </React.StrictMode>,
)

postMessage({ payload: 'removeLoading' }, '*')
