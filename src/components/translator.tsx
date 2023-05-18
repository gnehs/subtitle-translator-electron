import React from 'react';
import asyncPool from "tiny-async-pool";
import { useState, useEffect, useRef } from 'react';
import { Configuration, OpenAIApi } from 'openai'
import { parseSync, stringifySync } from 'subtitle'
import { Tooltip } from 'react-tooltip'
//@ts-ignore
import assParser from 'ass-parser'
//@ts-ignore
import assStringify from 'ass-stringify'
import './translator.sass'
//@ts-ignore
async function asyncPoolAll(...args) {
  const results = [];
  //@ts-ignore
  for await (const result of asyncPool(...args)) {
    results.push(result);
  }
  return results;
}
function Translator({ className }: { className?: string }) {
  const [isTranslating, setIsTranslating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [usedTokens, setUsedTokens] = useState<number>(0)
  const [usedDollars, setUsedDollars] = useState<number>(0)
  const [parsedSubtitle, setParsedSubtitle] = useState<any[]>([])
  const [assTemp, setAssTemp] = useState<any[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [targetLanguage, setTargetLanguage] = useState('')
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [translationMethod, setTranslationMethod] = useState('gpt-3.5-turbo')
  const translationMethodDialog: any = useRef(null)
  const downloadDialog: any = useRef(null)

  useEffect(() => {
    if (localStorage.getItem('apiKey'))
      setApiKey(localStorage.getItem('apiKey') || '')
    if (localStorage.getItem('targetLanguage'))
      setTargetLanguage(localStorage.getItem('targetLanguage') || '')
    if (localStorage.getItem('translationMethod'))
      setTranslationMethod(localStorage.getItem('translationMethod') || '')
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
          setProgress(0)
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    localStorage.setItem('apiKey', apiKey)
    localStorage.setItem('targetLanguage', targetLanguage)
    localStorage.setItem('translationMethod', translationMethod)
    setIsTranslating(true)
    try {
      const configuration = new Configuration({ apiKey });
      const openai = new OpenAIApi(configuration);
      if (translationMethod === "gpt-3.5-turbo")
        await startTranslationGPT3({ openai })
      if (translationMethod === "gpt-3.5-turbo-economy")
        await startTranslationGPT3Economy({ openai })
      if (translationMethod === "gpt-4-0314")
        await startTranslationGPT4({ openai })
      // done
      setProgress(1)
      setIsTranslating(false)
      alert('Done!')
    } catch (e) {
      console.error(e)
      // @ts-ignore
      alert(e?.response?.data?.error?.message || e.toString())
      setIsTranslating(false)
    }
  }

  async function retry(index: number) {
    localStorage.setItem('apiKey', apiKey)
    localStorage.setItem('targetLanguage', targetLanguage)

    parsedSubtitle[index].data.translatedText = 'Loading...'
    setParsedSubtitle([...parsedSubtitle])

    const input = parsedSubtitle[index].data.text
    const configuration = new Configuration({ apiKey });
    const openai = new OpenAIApi(configuration);
    const completion: any = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Please do not output any text other than the translation. You will receive the subtitles as array that needs to be translated, as well as the previous translation results and next subtitle. Please transliterate the person's name into the local language. Target language: ${targetLanguage}\n\n${additionalNotes}`
        },
        {
          role: "user",
          content: JSON.stringify(input)
        }
      ],
    });
    let result = completion.data.choices[0].message.content
    result = result.replace(/^("|「)|("|」)$/g, '')
    setUsedTokens(usedTokens => usedTokens + completion.data.usage.total_tokens)
    setUsedDollars(usedDollars => usedDollars + (completion.data.usage.total_tokens / 1000 * 0.002))

    parsedSubtitle[index].data.translatedText = result
    setParsedSubtitle([...parsedSubtitle])
  }
  async function startTranslationGPT4({ openai }: { openai: OpenAIApi }) {
    let subtitle = parsedSubtitle.filter(line => line.type === 'cue')
    const splitEvery = 10
    let chunks = []
    let chunk = []
    for (let i = 0; i < subtitle.length; i++) {
      if (subtitle[i].data?.translatedText) continue
      chunk.push(subtitle[i])
      if (chunk.length === splitEvery) {
        chunks.push(chunk)
        chunk = []
      }
    }
    if (chunk.length > 0) {
      chunks.push(chunk)
    }
    console.log(`Splited into ${chunks.length} chunks`)
    await asyncPoolAll(5, chunks, async (chunk: any, i: number) => {
      let input = chunk
        .map((line: any) => line.data.text)
        .filter((x: any) => !x.data?.translatedText)
      if (input.length === 0) return
      const completion: any = await openai.createChatCompletion({
        model: "gpt-4-0314",
        messages: [
          {
            role: "system",
            content: `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Please only output the translation and reply in the same format as the original array. Target language: ${targetLanguage}\n\n${additionalNotes}`
          },
          {
            role: "user",
            content: JSON.stringify(input)
          }
        ],
      });
      let result = completion.data.choices[0].message.content
      result = JSON.parse(result)
      for (let i = 0; i < result.length; i++) {
        chunk[i].data.translatedText = result[i]
      }
      setParsedSubtitle([...parsedSubtitle])
      setUsedTokens(usedTokens => usedTokens + completion.data.usage.total_tokens)
      setUsedDollars(usedDollars => usedDollars + (completion.data.usage.prompt_tokens / 1000 * 0.03))
      setUsedDollars(usedDollars => usedDollars + (completion.data.usage.completion_tokens / 1000 * 0.06))
      setProgress(x => x + 1 / chunks.length)
    })
  }
  async function startTranslationGPT3({ openai }: { openai: OpenAIApi }) {
    let subtitle = parsedSubtitle.filter(line => line.type === 'cue')
    let previousSubtitles: any = []

    for (let i = 0; i < subtitle.length; i++) {
      if (subtitle[i].data?.translatedText) continue
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
      setUsedDollars(usedDollars => usedDollars + (completion.data.usage.total_tokens / 1000 * 0.002))
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
    }
  }
  async function startTranslationGPT3Economy({ openai }: { openai: OpenAIApi }) {
    let subtitle = parsedSubtitle.filter(line => line.type === 'cue')
    await asyncPoolAll(5, subtitle, async (item: any) => {
      if (item.data?.translatedText) return
      let text = item.data.text
      const completion: any = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a program responsible for translating subtitles. Your task is to output the specified target language based on the input text. Please do not create the following subtitles on your own. Please do not output any text other than the translation. Target language:  ${targetLanguage}\n\n${additionalNotes}`
          },
          {
            role: "user",
            content: text
          }
        ],
      });
      let result = completion.data.choices[0].message.content
      setUsedTokens(usedTokens => usedTokens + completion.data.usage.total_tokens)
      setUsedDollars(usedDollars => usedDollars + (completion.data.usage.total_tokens / 1000 * 0.002))
      item.data.translatedText = result
      setProgress(x => x + 1 / subtitle.length)
    })
  }
  function downloadSubtitle({ originalSubtitle = false }) {
    let fileExtension = fileName?.split('.').pop()
    let newSubtitle
    if (['srt', 'vtt'].includes(fileExtension || '')) {
      newSubtitle = stringifySync(parsedSubtitle.map(x => {
        return {
          type: x.type,
          data: {
            ...x.data,
            text:
              x.data.translatedText
              + (originalSubtitle ? '\n' + x.data.text : '')
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
                  Text:
                    parsedSubtitle.find(y => y.data.text === line.value.Text)?.data.translatedText
                    + (originalSubtitle ? '\\N' + line.value.Text : '')
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
    <>
      <form className={`translator ${className}`} onSubmit={handleSubmit}>
        <div className="sidebar">
          <label><i className='bx bx-key' ></i> Open AI API key</label>
          <input type="password" placeholder="sk-abcd1234" value={apiKey} onChange={e => setApiKey(e.target.value)} required data-tooltip-id="open-ai-tooltip" data-tooltip-content="You need to add a payment method to your account, otherwise you might reach the free rate limit (20 requests/min)." />
          <Tooltip id="open-ai-tooltip" />

          <label><i className='bx bx-bot'></i> Translation method</label>
          <div onClick={e => translationMethodDialog.current?.showModal()} className="translationMethod">
            <div className="value">
              {translationMethod}
            </div>
            <div className="icon">
              <i className='bx bx-chevron-down' ></i>
            </div>
          </div>

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
                    <input
                      key={index}
                      type="text"
                      value={subtitle.data.translatedText || ''}
                      disabled={subtitle.data.translatedText == 'Loading...'}
                      onChange={e => {
                        parsedSubtitle[index].data.translatedText = e.target.value
                        setParsedSubtitle([...parsedSubtitle])
                      }} />
                  </div>
                  <div className="subtitle-preview__item__actions">
                    {subtitle.data.translatedText &&
                      <button className="btn" type="button" disabled={subtitle.data.translatedText == 'Loading...'} onClick={() => { retry(index) }}>
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
              <span>{usedTokens.toLocaleString()} tokens used ≈ {usedDollars.toFixed(4)} USD</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar__progress" style={{ width: `${progress * 100}%` }}></div>
            </div>
          </div>
          {progress === 1 &&
            <a className='btn' onClick={reset}><i className='bx bx-reset'></i> Reset</a>
          }
          {progress === 1 &&
            <a className='btn' onClick={e => downloadDialog.current?.showModal()}><i className='bx bx-save' ></i> Save</a>
          }
          {progress !== 1 &&
            <button className="btn" type="submit" disabled={isTranslating}>
              {!isTranslating && <i className='bx bx-play'></i>}{isTranslating ? `Translating...` : `Translate`}
            </button>
          }
        </div>
      </form>
      <dialog ref={translationMethodDialog}>
        <div className="dialog__content">
          <label><i className='bx bx-bot'></i>Translation method</label>
          <form method="dialog">
            <button className='dialog-option' onClick={e => setTranslationMethod('gpt-4-0314')}>
              <div className='tag'>
                <i className='bx bx-like'></i>
                Recommended
              </div>
              <div className='title'>
                <i className={translationMethod === 'gpt-4-0314' ? 'bx bx-check-circle' : 'bx bx-circle'}></i>
                gpt-4-0314
              </div>
              <div className='description'>
                By dividing the subtitles into chunks and sending requests simultaneously, translation can be completed with guaranteed subtitle quality and improved translation speed.
              </div>
              <div className='note'>
                To use the GPT-4-0314 translation method, you need to join the waitlist and receive an invitation to access the GPT-4-0314 model.
              </div>
              <div className='pricing'>
                $0.03/1k prompt tokens
                <br />
                $0.06/1k sampled tokens
              </div>
            </button>
            <button className='dialog-option' onClick={e => setTranslationMethod('gpt-3.5-turbo')}>
              <div className='tag'>
                <i className='bx bx-bot'></i>
                Default
              </div>
              <div className='title'>
                <i className={translationMethod === 'gpt-3.5-turbo' ? 'bx bx-check-circle' : 'bx bx-circle'}></i>
                gpt-3.5-turbo
              </div>
              <div className='description'>
                Less cost, but the quality is not as good as GPT-4-0314.
              </div>
              <div className='pricing'>
                $0.002 / 1K tokens
              </div>
            </button>
            <button className='dialog-option' onClick={e => setTranslationMethod('gpt-3.5-turbo-economy')}>
              <div className='tag'>
                <i className='bx bx-dollar-circle'></i>
                Economy
              </div>
              <div className='title'>
                <i className={translationMethod === 'gpt-3.5-turbo-economy' ? 'bx bx-check-circle' : 'bx bx-circle'}></i>
                gpt-3.5-turbo-economy
              </div>
              <div className='description'>
                This method minimizes token consumption by not sending preceding and following sentences, but it may result in issues such as GPT generating its own text that you will need to fix on your own.
              </div>
              <div className='pricing'>
                $0.002 / 1K tokens
              </div>
            </button>
          </form>
        </div>
      </dialog>
      <dialog ref={downloadDialog}>
        <div className="dialog__content">
          <label><i className='bx bxs-download'></i> Save options</label>
          <form method="dialog">
            <button className='dialog-option' onClick={e => downloadSubtitle({ originalSubtitle: false })}>
              <div className='title'>
                Translated subtitle only
              </div>
              <div className='description'>
                Export the translated subtitle only.
              </div>
            </button>
            <button className='dialog-option' onClick={e => downloadSubtitle({ originalSubtitle: true })}>
              <div className='title'>
                Translated subtitle + original subtitle
              </div>
              <div className='description'>
                Merge the translated subtitle with the original subtitle.
              </div>
            </button>
          </form>
        </div>
      </dialog></>
  )
}
export default Translator