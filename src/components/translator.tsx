import React from 'react';
import { useState, useEffect } from 'react';
import { Configuration, OpenAIApi } from 'openai'
import { parseSync, stringifySync } from 'subtitle'
import './translator.sass'
function Translator({ className }: { className?: string }) {
  const [isTranslating, setIsTranslating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [usedTokens, setUsedTokens] = useState<number>(0)
  const [parsedSubtitle, setParsedSubtitle] = useState<any[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [targetLanguage, setTargetLanguage] = useState('')
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [apiKey, setApiKey] = useState('')
  useEffect(() => {
    if (localStorage.getItem('apiKey'))
      setApiKey(localStorage.getItem('apiKey') || '')
    if (localStorage.getItem('targetLanguage'))
      setTargetLanguage(localStorage.getItem('targetLanguage') || '')
  }, [])
  function reset() {
    location.reload()
  }
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setFileName(file.name)
      const reader = new FileReader()
      reader.onload = function (e) {
        if (e.target?.result) {
          const parsedSubtitle = parseSync(e.target.result as string)
          setParsedSubtitle(parsedSubtitle)
        }
      }
      reader.readAsText(file)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTranslation()
  }
  async function startTranslation() {
    localStorage.setItem('apiKey', apiKey)
    localStorage.setItem('targetLanguage', targetLanguage)
    // alert('start')
    setIsTranslating(true)
    // setProgress(0.5)

    const configuration = new Configuration({ apiKey });
    const openai = new OpenAIApi(configuration);

    let subtitle = parsedSubtitle.filter(line => line.type === 'cue')
    type Input = {
      Input: string
      Next?: string
    }
    let previousSubtitles: any = []

    for (let i = 0; i < subtitle.length; i++) {
      // for (let i = 0; i < 10; i++) {
      let text = subtitle[i].data.text
      let input: { Input: string; Next?: string; } = { Input: text }
      if (subtitle[i + 1]) {
        input.Next = subtitle[i + 1].data.text
      }
      const completion: any = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Please do not output any text other than the translation. You will receive the subtitles as array that needs to be translated, as well as the previous translation results and next subtitle. If you need to merge the subtitles with the following line, simply repeat the translation. Please transliterate the person's name into the local language. Target language: ${targetLanguage}\n\n${additionalNotes}`
          },
          ...previousSubtitles.slice(-4),
          {
            role: "user",
            content: JSON.stringify(input)
          }
        ],
      });
      let result = completion.data.choices[0].message.content
      setUsedTokens(usedTokens => usedTokens + completion.data.usage.total_tokens)
      try {
        result = JSON.parse(result).Input
      } catch (e) {
        try {
          result = result.match(/"Input":"(.*?)"/)[1]
        } catch (e) {
          console.error(e)
          console.error(result.red)
        }
      }
      previousSubtitles.push({ role: "user", content: JSON.stringify(input) })
      previousSubtitles.push({ role: 'assistant', content: JSON.stringify({ ...input, Input: result }) })

      subtitle[i].data.translatedText = result
      setProgress(i / subtitle.length)
    }
    setProgress(1)
    downloadSubtitle()
    setIsTranslating(false)
  }
  function downloadSubtitle() {

    let newSubtitle = stringifySync(parsedSubtitle.map(x => {
      return {
        type: x.type,
        data: {
          ...x.data,
          text: x.data.translatedText
        }
      }
    }), { format: 'SRT' })
    const blob = new Blob([newSubtitle], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'translated.srt'
    a.click()
  }

  return (
    <form className={`translator ${className}`} onSubmit={handleSubmit}>
      <div className="sidebar">
        <label>Open AI API key</label>
        <input type="password" placeholder="sk-abcd1234" value={apiKey} onChange={e => setApiKey(e.target.value)} required />
        <label>Subtitle file</label>
        <input type="file" placeholder="Subtitle file" onChange={handleFileChange} accept=".srt,.vtt" required />
        <label>Target language</label>
        <input type="text" placeholder="English, 繁體中文, 日本語, etc." value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)} required />
        <label>Additional notes</label>
        <textarea placeholder="e.g. This is a Star Wars movie." value={additionalNotes} onChange={e => setAdditionalNotes(e.target.value)} />
      </div>
      <div className="subtitle-preview-container">
        <label>Subtitle Preview</label>
        {!parsedSubtitle.length && <div className="subtitle-preview">No subtitle file selected.</div>}
        {parsedSubtitle.length != 0 &&
          <div className="subtitle-preview">
            {parsedSubtitle.map((subtitle, index) =>
              <div key={index} className="subtitle-preview__item">
                <div className="subtitle-preview__item__index">{index + 1}</div>
                <div className="subtitle-preview__item__text">{subtitle.data.text}</div>
                <div className="subtitle-preview__item__text--translated">{subtitle.data?.translatedText || '...'}</div>
              </div>
            )}
          </div>
        }
      </div>
      <div className="bottom">
        <div className="progress-bar-container">
          <div className="progress-bar">
            <div className="progress-bar__progress" style={{ width: `${progress * 100}%` }}></div>
          </div>
          <div className="progress-bar__text">{(progress * 100).toFixed(0)}% | {usedTokens.toLocaleString()} tokens used ≈ {(usedTokens / 1000 * 0.002).toFixed(4)} USD</div>
        </div>
        {progress === 1 &&
          <a className='btn' onClick={reset}><i className='bx bx-reset'></i> Reset</a>
        }
        {progress === 1 &&
          <a className='btn' onClick={downloadSubtitle}><i className='bx bx-save' ></i> Save</a>
        }
        {progress !== 1 &&
          <button className='btn' type="submit" disabled={isTranslating}>
            {!isTranslating && <i className='bx bx-play'></i>}{isTranslating ? `Translating...` : `Translate`}
          </button>
        }
      </div>
    </form>
  )
}
export default Translator