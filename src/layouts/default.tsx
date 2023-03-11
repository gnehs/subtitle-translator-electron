import Translator from "@/components/translator"
import { ipcRenderer } from 'electron';
import { useEffect, useState } from 'react';
function DefaultLayout() {
  const [version, setVersion] = useState<string | null>(null)
  const [newVersion, setNewVersion] = useState<string | null>(null)
  useEffect(() => {
    ipcRenderer.on('main-process-message', (_event, args) => {
      console.log('[Receive Main-process message]:', args);
      if (args[0] == 'version') {
        setVersion(args[1])
      }
      if (args[0] == 'accentColor') {
        document.documentElement.style.setProperty('--accent-color', `#${args[1]}`)
      }
    });
    fetch('https://api.github.com/repos/gnehs/subtitle-translator-electron/releases/latest').then(res => res.json()).then(res => {
      setNewVersion(res.tag_name)
    })
  }, [])
  return (
    <div className="default-layout">
      <Translator className="content" />
      <div className="footer">
        <div className="content">
          {(version && newVersion && version != newVersion) ?
            <a className="new-version" href="https://github.com/gnehs/subtitle-translator-electron/releases" target="_blank">
              <i className='bx bx-up-arrow-alt' ></i> New version ({version}<i className='bx bx-right-arrow-alt' ></i>{newVersion})
            </a> :
            <span>{version}</span>
          }
          <span> | </span>
          <span>Developed by <a href="https://gnehs.net/" target="_blank">gnehs</a></span>
          <span> | </span>
          <span>Made with <a href="https://pancake.tw/" target="_blank">🥞</a> in Taiwan</span>
        </div>
        <div className="links">
          <a href="https://www.buymeacoffee.com/gnehs" target="_blank">
            <i className='bx bx-coffee-togo' ></i> Buy me a coffee
          </a>
          <a href="https://github.com/gnehs/subtitle-translator-electron" target="_blank">
            <i className='bx bxl-github'></i> GitHub
          </a>
          <a href="https://github.com/gnehs/subtitle-translator-electron/issues" target="_blank">
            <i className='bx bx-bug' ></i> Report a bug
          </a>
        </div>
      </div>

    </div>
  )
}
export default DefaultLayout