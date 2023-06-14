import Button from "../Button";
import { useState, useEffect } from "react";

import asyncPool from "tiny-async-pool";
import useStep from "@/hooks/useStep";
import useFile from "@/hooks/useFile";
import useModel from "@/hooks/useModel";
import fs from "node:fs";
import { motion } from "framer-motion";
import { useTranslate, useAPIKeys } from "@/hooks/useOpenAI";
import { parseSync, stringifySync } from "subtitle";
import { useLocalStorage } from "usehooks-ts";
//@ts-ignore
import assParser from "ass-parser";
//@ts-ignore
import assStringify from "ass-stringify";
//@ts-ignore
async function asyncPoolAll(...args) {
  const results = [];
  //@ts-ignore
  for await (const result of asyncPool(...args)) {
    results.push(result);
  }
  return results;
}
function SubtitlePreview({
  subtitle,
  index,
  parsedSubtitle,
  setParsedSubtitle,
}: {
  subtitle: any;
  index: number;
  parsedSubtitle: any;
  setParsedSubtitle: any;
}) {
  return (
    <div className="flex items-center rounded-sm border border-slate-100">
      <div className="text-sm min-w-[3em] p-1 rounded-l-sm bg-slate-100 h-full flex items-center justify-center">
        {index + 1}
      </div>
      <div className="flex-1 flex flex-col gap-1 rounded-r-sm bg-slate-50 p-1 text-sm">
        <div>{subtitle.data.text}</div>
        <input
          key={index}
          type="text"
          value={subtitle.data.translatedText || ""}
          disabled={subtitle.data.translatedText == "Loading..."}
          className="py-1 w-full bg-transparent border-b mb-[1px] border-slate-300 focus:outline-none focus:border-slate-400 focus:border-b-2 focus:mb-0"
          onChange={(e) => {
            parsedSubtitle[index].data.translatedText = e.target.value;
            setParsedSubtitle([...parsedSubtitle]);
          }}
        />
      </div>
    </div>
  );
}
export default function File() {
  const [step, nextStep, previousStep] = useStep();
  const [keys] = useAPIKeys();
  const [file] = useFile();
  const [parsedSubtitle, setParsedSubtitle] = useState<any[]>([]);
  const [assTemp, setAssTemp] = useState<any[]>([]);

  const [multiLangSave] = useLocalStorage("multi_language_save", "none");

  const [usedInputTokens, setUsedInputTokens] = useState<number>(0);
  const [usedOutputTokens, setUsedOutputTokens] = useState<number>(0);
  const [usedDollars, setUsedDollars] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [model] = useModel();
  const translate = useTranslate();
  useEffect(() => {
    async function loadFile() {
      if (file?.path) {
        console.log(file);
        const fileContent = fs
          .readFileSync(file.path, { encoding: `utf-8` })
          .toString();
        const fileExtension = file?.path.split(".").pop();
        if (["srt", "vtt"].includes(fileExtension || "")) {
          const parsedSrtSubtitle = parseSync(fileContent);
          setParsedSubtitle(parsedSrtSubtitle);
        }
        if (["ass", "ssa"].includes(fileExtension || "")) {
          const parsedAssSubtitle = assParser(fileContent);
          setAssTemp(parsedAssSubtitle);
          setParsedSubtitle(
            parsedAssSubtitle
              .filter((x: any) => x.section === "Events")[0]
              .body.filter(({ key }: any) => key === "Dialogue")
              .map((line: any) => {
                return {
                  type: `cue`,
                  data: {
                    text: line.value.Text,
                    start: line.value.Start,
                    end: line.value.End,
                  },
                };
              })
          );
        }
      }
    }
    loadFile();
  }, [file]);
  async function startTranslation() {
    let subtitle = parsedSubtitle.filter((line) => line.type === "cue");
    const splitEvery = 15;
    let chunks = [];
    let chunk = [];
    for (let i = 0; i < subtitle.length; i++) {
      if (subtitle[i].data?.translatedText) continue;
      chunk.push(subtitle[i]);
      if (chunk.length === splitEvery) {
        chunks.push(chunk);
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    console.log(`Splited into ${chunks.length} chunks`);
    async function translateChunk(block: any[], retry = 0) {
      try {
        if (block.length === 0) return;
        if (block.every((line) => line.data.translatedText)) return;
        let text = block.map((line) => line.data.text);
        let res = await translate(text);
        let { result: translatedText } = JSON.parse(
          res.data.choices[0].message?.function_call?.arguments!
        );
        for (let i = 0; i < translatedText.length; i++) {
          block[i].data.translatedText = translatedText[i];
        }
        setParsedSubtitle([...parsedSubtitle]);
        setProgress(
          (progress) =>
            (parsedSubtitle
              .map((line) => line.data.translatedText)
              .filter((x) => x).length /
              parsedSubtitle.length) *
            100
        );
        let inputToken = res.data?.usage?.prompt_tokens!;
        let inputCost = 0.0015;
        let outputToken = res.data?.usage?.completion_tokens!;
        let outputCost = 0.002;
        if (model === "gpt-4") {
          inputCost = 0.03;
          outputCost = 0.06;
        }
        setUsedInputTokens((usedInputTokens) => usedInputTokens + inputToken);
        setUsedOutputTokens(
          (usedOutputTokens) => usedOutputTokens + outputToken
        );
        setUsedDollars(
          (usedDollars) =>
            usedDollars +
            (inputToken / 1000) * inputCost +
            (outputToken / 1000) * outputCost
        );
      } catch (e) {
        if (retry < 10) {
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
          await sleep((1000 * retry) ^ 2);
          await translateChunk(block, retry + 1);
          console.error(`Retry ${retry} times`);
          console.error(e);
        } else {
          console.error(e);
          // @ts-ignore
          alert(e?.response?.data?.error?.message || e.toString());
        }
      }
    }
    setIsTranslating(true);
    await asyncPoolAll(keys.length * 1.5, chunks, translateChunk);
  }
  function downloadSubtitle() {
    function parseTranslatedText(
      originalSubtitle: string = "",
      translatedText: string = ""
    ) {
      switch (multiLangSave) {
        case "none":
          return translatedText;
        case "translate+original":
          return `${translatedText}\\n${originalSubtitle}`;
        case "original+translate":
          return `${originalSubtitle}\\n${translatedText}`;
      }
    }
    let fileName = file?.path?.split("/").pop();
    let fileExtension = fileName?.split(".").pop();
    let newSubtitle;
    if (["srt", "vtt"].includes(fileExtension || "")) {
      newSubtitle = stringifySync(
        parsedSubtitle.map((x) => {
          return {
            type: x.type,
            data: {
              ...x.data,
              text: parseTranslatedText(x.data.text, x.data.translatedText),
            },
          };
        }),
        { format: "SRT" }
      );
    }

    if (["ass", "ssa"].includes(fileExtension || "")) {
      let temp = structuredClone(assTemp);
      newSubtitle = assStringify(
        temp.map((x) => {
          if (x.section === "Events") {
            x.body = x.body.map((line: any) => {
              if (line.key === "Dialogue") {
                return {
                  key: "Dialogue",
                  value: {
                    ...line.value,
                    Text: parseTranslatedText(
                      line.value.Text,
                      parsedSubtitle.find(
                        (y) => y.data.text === line.value.Text
                      )?.data.translatedText
                    ),
                  },
                };
              }
              return line;
            });
          }
          return x;
        })
      );
    }

    const blob = new Blob([newSubtitle], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "translated.srt";
    a.click();
  }
  if (step !== 3) return null;
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="backdrop-blur-md bg-slate-100 bg-opacity-50 fixed w-[51px] h-full top-0 left-0 flex flex-col"
      >
        <div className="flex-1" />
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          xx:xx
          <br />
          <span className="opacity-50 text-xs">left</span>
        </div>
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          <span className="opacity-50 text-xs">tokens</span>
          <br />
          {usedOutputTokens.toLocaleString()}
          <br />
          <span className="opacity-50 text-xs">output</span>
        </div>
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          <span className="opacity-50 text-xs">tokens</span>
          <br />
          {usedInputTokens.toLocaleString()}
          <br />
          <span className="opacity-50 text-xs">input</span>
        </div>
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          {usedDollars.toFixed(2)}
          <br />
          <span className="opacity-50 text-xs">USD</span>
        </div>
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          {progress.toFixed(1)}
          <br />
          <span className="opacity-50 text-xs">%</span>
        </div>
      </motion.div>
      <div className="flex flex-col w-full h-full">
        <div className="flex-1 overflow-y-scroll h-full flex flex-col gap-1 p-1">
          {parsedSubtitle.map((x, i) => (
            <SubtitlePreview
              subtitle={x}
              index={i}
              parsedSubtitle={parsedSubtitle}
              setParsedSubtitle={setParsedSubtitle}
              key={i}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 p-2">
          <Button onClick={() => previousStep()}>previousStep</Button>
          <Button onClick={() => nextStep()}>Next</Button>
          <Button onClick={() => startTranslation()}>Start</Button>
          <Button onClick={() => downloadSubtitle()}>Save</Button>
        </div>
      </div>
    </>
  );
}
