import React from 'react';
import { useState, useEffect } from 'react';
import { Configuration, OpenAIApi } from 'openai'
import { parseSync, stringifySync } from 'subtitle'
import { Tooltip } from 'react-tooltip'
//@ts-ignore
import assParser from 'ass-parser'
//@ts-ignore
import assStringify from 'ass-stringify'
import './translator.sass'
function Translator({ className }: { className?: string }) {
  const [isTranslating, setIsTranslating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [usedTokens, setUsedTokens] = useState<number>(0)
  const [parsedSubtitle, setParsedSubtitle] = useState<any[]>([])
  const [assTemp, setAssTemp] = useState<any[]>([])
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
      let fileExtension = file.name.split('.').pop()
      setFileName(file.name)
      const reader = new FileReader()
      reader.onload = function (e) {
        if (e.target?.result) {
          if (['srt', 'vtt'].includes(fileExtension || '')) {
            const parsedSrtSubtitle = parseSync(e.target.result as string)
            setParsedSubtitle(parsedSrtSubtitle)
          }
          if (['ass', 'ssa'].includes(fileExtension || '')) {
            const parsedAssSubtitle = assParser(e.target.result as string)
            setAssTemp(parsedAssSubtitle)
            setParsedSubtitle(parsedAssSubtitle.filter((x: any) => x.section === 'Events')[0].body
              .filter(({ key }: any) => key === 'Dialogue')
              .map((line: any) => {
                return {
                  type: `cue`,
                  data: {
                    text: line.value.Text,
                    start: line.value.Start,
                    end: line.value.End
                  }
                }
              })
            )
          }

        }
      }
      reader.readAsText(file)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTranslation()
  }

  async function retry(index: number) {
    parsedSubtitle[index].data.translatedText = '⋯'

    const input = parsedSubtitle[index].data.text
    const configuration = new Configuration({ apiKey });
    const openai = new OpenAIApi(configuration);
    const completion: any = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Please do not output any text other than the translation. You will receive the subtitles as array that needs to be translated, as well as the previous translation results and next subtitle. If you need to merge the subtitles with the following line, simply repeat the translation. Please transliterate the person's name into the local language. Target language: ${targetLanguage}\n\n${additionalNotes}`
        },
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
    }
    catch (e) {
      try {
        result = result.match(/"Input":"(.*?)"/)?.[1] || result
      }
      catch (e) {
        console.error(e)
      }
    }
    parsedSubtitle[index].data.translatedText = result
  }
  async function startTranslation() {
    localStorage.setItem('apiKey', apiKey)
    localStorage.setItem('targetLanguage', targetLanguage)
    setIsTranslating(true)

    const configuration = new Configuration({ apiKey });
    const openai = new OpenAIApi(configuration);

    let subtitle = parsedSubtitle.filter(line => line.type === 'cue')
    type Input = {
      Input: string
      Next?: string
    }
    let previousSubtitles: any = []

    for (let i = 0; i < subtitle.length; i++) {
      if (subtitle[i].data?.translatedText) continue
      let text = subtitle[i].data.text
      let input: { Input: string; Next?: string; } = { Input: text }
      if (subtitle[i + 1]) {
        input.Next = subtitle[i + 1].data.text
      }
      try {
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
            result = result.match(/"Input":"(.*?)"/)?.[1] || result
          } catch (e) {
            console.error(e)
            console.error(result.red)
          }
        }
        previousSubtitles.push({ role: "user", content: JSON.stringify(input) })
        previousSubtitles.push({ role: 'assistant', content: JSON.stringify({ ...input, Input: result }) })

        subtitle[i].data.translatedText = result
        setProgress(i / subtitle.length)

        // scroll to item
        let item = document.querySelector(`#subtitle-preview .subtitle-preview__item:nth-child(${i + 1})`)
        if (item) {
          item.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      } catch (e) {
        // @ts-ignore
        alert(e?.response?.data?.error?.message || e.toString())
        setIsTranslating(false)
        return
      }
    }
    setProgress(1)
    setIsTranslating(false)
    alert('Done!')
  }
  function downloadSubtitle() {
    let fileExtension = fileName?.split('.').pop()
    let newSubtitle
    if (['srt', 'vtt'].includes(fileExtension || '')) {
      newSubtitle = stringifySync(parsedSubtitle.map(x => {
        return {
          type: x.type,
          data: {
            ...x.data,
            text: x.data.translatedText
          }
        }
      }), { format: 'SRT' })
    }
    if (['ass', 'ssa'].includes(fileExtension || '')) {
      let temp = structuredClone(assTemp)
      newSubtitle = assStringify(temp.map(x => {
        if (x.section === 'Events') {
          x.body = x.body.map((line: any) => {
            if (line.key === 'Dialogue') {
              return {
                key: 'Dialogue',
                value: {
                  ...line.value,
                  Text: parsedSubtitle.find(y => y.data.text === line.value.Text)?.data.translatedText
                }
              }
            }
            return line
          })
        }
        return x
      }))
    }

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
        <label><i className='bx bx-key' ></i> Open AI API key</label>
        <input type="password" placeholder="sk-abcd1234" value={apiKey} onChange={e => setApiKey(e.target.value)} required data-tooltip-id="open-ai-tooltip" data-tooltip-content="You need to add a payment method to your account, otherwise you might reach the free rate limit (20 requests/min)." />
        <Tooltip id="open-ai-tooltip" />

        <label><i className='bx bx-file-blank' ></i> Subtitle file</label>
        <input type="file" placeholder="Subtitle file" onChange={handleFileChange} accept=".srt,.vtt,.ass,.ssa" required />

        <label><i className='bx bxs-right-arrow-square' ></i> Target language</label>
        <input type="text" placeholder="English, 繁體中文, 日本語, etc." value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)} required />

        <label><i className='bx bx-plus' ></i> Additional notes</label>
        <textarea placeholder="e.g. This is a Star Wars movie." value={additionalNotes} onChange={e => setAdditionalNotes(e.target.value)} />
      </div>
      <div className="subtitle-preview-container">
        {!parsedSubtitle.length && <label><i className='bx bx-list-ul' ></i> Subtitle Preview</label>}
        {!parsedSubtitle.length && <div className="subtitle-preview">No subtitle file selected.</div>}
        {parsedSubtitle.length != 0 &&
          <div className="subtitle-preview" id='subtitle-preview'>
            {parsedSubtitle.map((subtitle, index) =>
              <div key={index} className="subtitle-preview__item">
                <div className="subtitle-preview__item__index">{index + 1}</div>
                <div className="subtitle-preview__item__text">{subtitle.data.text}</div>
                <div className="subtitle-preview__item__text--translated">
                  {subtitle.data?.translatedText ?
                    <input key={index} type="text" value={subtitle.data.translatedText} onChange={e => {
                      parsedSubtitle[index].data.translatedText = e.target.value
                      setParsedSubtitle([...parsedSubtitle])
                    }} />
                    : '⋯'}
                </div>
                <div className="subtitle-preview__item__actions">
                  {subtitle.data.translatedText &&
                    <button className="btn" disabled={subtitle.data.translatedText == '⋯'} onClick={() => { retry(index) }}>
                      <i className='bx bx-refresh' ></i>
                    </button>
                  }
                </div>
              </div>
            )}
          </div>
        }
      </div>
      <div className="bottom">
        <div className="progress-bar-container">
          <div className="progress-bar__text">
            <span>{(progress * 100).toFixed(0)}%</span>
            <span>{usedTokens.toLocaleString()} tokens used ≈ {(usedTokens / 1000 * 0.002).toFixed(4)} USD</span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar__progress" style={{ width: `${progress * 100}%` }}></div>
          </div>
        </div>
        {progress === 1 &&
          <a className='btn' onClick={reset}><i className='bx bx-reset'></i> Reset</a>
        }
        {progress === 1 &&
          <a className='btn' onClick={downloadSubtitle}><i className='bx bx-save' ></i> Save</a>
        }
        {progress !== 1 &&
          <button className="btn" type="submit" disabled={isTranslating}>
            {!isTranslating && <i className='bx bx-play'></i>}{isTranslating ? `Translating...` : `Translate`}
          </button>
        }
      </div>
    </form>
  )
}
export default Translator