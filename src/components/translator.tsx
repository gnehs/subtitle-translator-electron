import React from 'react';
import './translator.sass'
function Translator({ className }: { className?: string }) {
  return (
    <div className={`translator ${className}`} >
      <div className="left">
        <label>Open AI API key</label>
        <input type="password" placeholder="Open AI API key" />
        <label>Subtitle file</label>
        <input type="file" />
        <label>Target language</label>
        <input type="text" placeholder="English, 繁體中文, 日本語, etc." />
        <label>Additional notes</label>
        <textarea placeholder="e.g. This is a Star Wars movie." />

      </div>
      <div className="right">right</div>
      <div className="bottom">bottom</div>
    </div>
  )
}
export default Translator