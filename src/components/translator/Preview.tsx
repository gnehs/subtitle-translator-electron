import Button from "../Button";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import asyncPool from "tiny-async-pool";
import useStep from "@/hooks/useStep";
import useFile from "@/hooks/useFile";
import useModel from "@/hooks/useModel";
import fs from "node:fs";
import { motion } from "framer-motion";
import { useTranslate, useAPIKeys } from "@/hooks/useOpenAI";
import { parseSync, stringifySync } from "subtitle";
import { useLocalStorage } from "usehooks-ts";
import { toast } from "react-toastify";
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
  const [subtitleFilter, setSubtitleFilter] = useState<
    "all" | "translated" | "not_translated"
  >("all");
  const [usedInputTokens, setUsedInputTokens] = useState<number>(0);
  const [usedOutputTokens, setUsedOutputTokens] = useState<number>(0);
  const [usedDollars, setUsedDollars] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [model] = useModel();
  const { translateSubtitleChunk } = useTranslate();
  const { t } = useTranslation();
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
  function splitIntoChunk(array: any, by = 5) {
    let chunks = [];
    let chunk = [];
    for (let i = 0; i < array.length; i++) {
      if (array[i].data?.translatedText) continue;
      chunk.push(array[i]);
      if (chunk.length === by) {
        chunks.push(chunk);
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    return chunks;
  }
  async function startTranslation(retryTimes: number = 0) {
    let subtitle = parsedSubtitle.filter((line) => line.type === "cue");
    if (retryTimes > 0) {
      subtitle.sort(() => Math.random() - 0.5);
    }
    let chunks = splitIntoChunk(subtitle, Math.round(Math.random() * 10 + 5));
    console.log(`Splited into ${chunks.length} chunks`);
    function updateCost(res: any) {
      let inputToken = res.data?.usage?.prompt_tokens!;
      let inputCost = 0.0015;
      let outputToken = res.data?.usage?.completion_tokens!;
      let outputCost = 0.002;
      if (model === "gpt-4") {
        inputCost = 0.03;
        outputCost = 0.06;
      }
      setUsedInputTokens((usedInputTokens) => usedInputTokens + inputToken);
      setUsedOutputTokens((usedOutputTokens) => usedOutputTokens + outputToken);
      setUsedDollars(
        (usedDollars) =>
          usedDollars +
          (inputToken / 1000) * inputCost +
          (outputToken / 1000) * outputCost
      );
    }
    async function translateChunk(block: any[], retryTimes = 0) {
      if (block.length === 0) return;
      if (block.every((line) => line.data.translatedText)) return;
      let text = block.map((line) => line.data.text);
      let res;
      try {
        res = await translateSubtitleChunk(text);
        updateCost(res);
        let { result: translatedText } = JSON.parse(
          res.data.choices[0].message?.function_call?.arguments!
        );
        if (translatedText.length !== text.length) {
          throw new Error("Translated text length not match");
        }
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
      } catch (e) {
        console.groupCollapsed(
          //@ts-ignore
          e?.response?.data?.error?.message || e.toString()
        );
        console.log(text);
        console.log(res);
        console.error(e);
        //@ts-ignore
        console.error(e?.response);
        console.groupEnd();
      }
    }
    setIsTranslating(true);
    await asyncPoolAll(
      keys.length * 1.5,
      chunks,
      async (x: any) => await translateChunk(x, 0)
    );
    if (parsedSubtitle.filter((line) => !line.data.translatedText).length > 0) {
      if (retryTimes < 3) {
        await startTranslation(retryTimes + 1);
      } else {
        toast.error("Retry failed");
        alert("Retry failed");
      }
    }
    setIsTranslating(false);
  }
  function downloadSubtitle() {
    function parseTranslatedText(
      originalSubtitle: string = "",
      translatedText: string = "",
      splitText: string = "\n"
    ) {
      switch (multiLangSave) {
        case "none":
          return translatedText;
        case "translate+original":
          return `${translatedText}${splitText}${originalSubtitle}`;
        case "original+translate":
          return `${originalSubtitle}${splitText}${translatedText}`;
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
                      )?.data.translatedText,
                      "\\n"
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
        <div
          className={`text-center m-0.5 text-xs px-0.5 py-3 rounded-sm cursor-pointer ${
            subtitleFilter === "all"
              ? "bg-slate-500 text-white"
              : "bg-slate-200"
          }`}
          onClick={() => {
            setSubtitleFilter("all");
          }}
        >
          All
        </div>
        <div
          className={`text-center m-0.5 text-xs px-0.5 py-3 rounded-sm cursor-pointer ${
            subtitleFilter === "not_translated"
              ? "bg-slate-500 text-white"
              : "bg-slate-200"
          }`}
          onClick={() => {
            setSubtitleFilter("not_translated");
          }}
        >
          Remain
        </div>
        <div
          className={`text-center m-0.5 text-xs px-0.5 py-3 rounded-sm cursor-pointer ${
            subtitleFilter === "translated"
              ? "bg-slate-500 text-white"
              : "bg-slate-200"
          }`}
          onClick={() => {
            setSubtitleFilter("translated");
          }}
        >
          Done
        </div>
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
      {isTranslating && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, height: 0 }}
          className="flex justify-center items-center p-2 absolute top-1.5 right-1.5 rounded-md bg-slate-200 bg-opacity-50 w-10 h-10 backdrop-blur z-10"
        >
          <i className="bx bx-loader-alt animate-spin text-2xl"></i>
        </motion.div>
      )}
      <div className="flex flex-col w-full h-full">
        <div className="flex-1 overflow-y-scroll h-full flex flex-col gap-1 p-1">
          {parsedSubtitle
            .filter((x) => {
              switch (subtitleFilter) {
                case "all":
                  return true;
                case "not_translated":
                  return !x.data.translatedText;
                case "translated":
                  return x.data.translatedText;
                default:
                  return true;
              }
            })
            .map((x, i) => (
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
          {!isTranslating && (
            <>
              <Button onClick={() => previousStep()}>
                {t(`translate.back`)}
              </Button>
            </>
          )}
          <div className="flex-1" />
          {!isTranslating && progress < 100 && (
            <Button onClick={() => startTranslation()} variant="primary">
              Start
            </Button>
          )}
          {!isTranslating && progress > 0 && (
            <Button onClick={() => downloadSubtitle()} variant="primary">
              Save
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
