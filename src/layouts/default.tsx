import Translator from "@/components/translator"
import { ipcRenderer } from 'electron';
import { useEffect, useState } from 'react';
function DefaultLayout() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    ipcRenderer.on('main-process-message', (_event, args) => {
      console.log('[Receive Main-process message]:', args);
      if (args[0] == 'version') {
        setVersion(args[1])
      }
    });
  }, [])
  return (
    <div className="default-layout">
      <Translator className="content" />
      <div className="footer">
        <div className="content">
          v{version} | Developed by <a href="https://gnehs.net/" target="_blank">gnehs</a> | Made with <a href="https://pancake.tw/" target="_blank">🥞</a> in Taiwan
        </div>
        <div className="links">
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