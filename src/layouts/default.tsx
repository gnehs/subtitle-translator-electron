function DefaultLayout() {
  return (
    <div className="default-layout">
      <div className="navbar">
        <div className="logo">
          Subtitle translator
        </div>
        <div className="links">
          <a href="https://github.com/gnehs/subtitle-translator-electron" target="_blank">
            <i className='bx bxl-github'></i>
          </a>
        </div>
      </div>
      <div className="content">
        hello!
      </div>
      <div className="footer">
        <div className="content">
          Developed by <a href="https://gnehs.net/" target="_blank">gnehs</a> | Made with <a href="https://pancake.tw/" target="_blank">🥞</a> in Taiwan
        </div>
        <div className="links">
          <a href="https://github.com/gnehs/subtitle-translator-electron/issues" target="_blank">
            <i className='bx bx-bug' ></i> Report a bug
          </a>
        </div>
      </div>

    </div>
  )
}
export default DefaultLayout