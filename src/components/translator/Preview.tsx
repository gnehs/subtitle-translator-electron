import Button from "../Button";
import BuyMeACoffee from "@/components/BuyMeACoffee";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import asyncPool from "tiny-async-pool";
import useStep from "@/hooks/useStep";
import useFile from "@/hooks/useFile";
import useModel from "@/hooks/useModel";
import useDelay from "@/hooks/useDelay";
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
  translateSingle,
}: {
  subtitle: any;
  index: number;
  parsedSubtitle: any;
  setParsedSubtitle: any;
  translateSingle: any;
}) {
  return (
    <div className="flex items-center rounded-sm border border-slate-100 bg-slate-50 subtitle-preview__item">
      <div className="text-sm min-w-[3em] p-1 rounded-l-sm bg-slate-100 h-full flex items-center justify-center">
        {index + 1}
      </div>
      <div className="flex-1 flex flex-col gap-1 p-1 text-sm">
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
      <Button
        className="rounded-r-sm h-full"
        onClick={() => {
          translateSingle(subtitle);
        }}
      >
        <i className="bx bx-play"></i>
      </Button>
    </div>
  );
}
function SubtitleFilterItem({
  subtitleFilter,
  setSubtitleFilter,
  value,
}: {
  subtitleFilter: "all" | "translated" | "not_translated";
  setSubtitleFilter: any;
  value: "all" | "translated" | "not_translated";
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`text-center m-0.5 text-xs px-0.5 py-3 rounded-sm cursor-pointer relative transition-colors ${
        subtitleFilter === value ? " text-white" : "hover:bg-slate-200"
      }`}
      onClick={() => {
        setSubtitleFilter(value);
      }}
    >
      {subtitleFilter === value && (
        <motion.div
          layout
          layoutId="subtitleFilter"
          className="absolute top-0 right-0 w-full h-full bg-slate-500 rounded-sm"
        />
      )}
      <div className="relative">{t(`translate.subtitleFilter.${value}`)}</div>
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
  const [progress, setProgress] = useState<number>(0);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [model] = useModel();
  const [delay] = useDelay();
  const {
    translateSubtitleChunk,
    translateSubtitleSingle,
    usedInputTokens,
    usedOutputTokens,
    usedDollars,
  } = useTranslate();
  const { t } = useTranslation();
  useEffect(() => {
    async function loadFile() {
      if (file?.path) {
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
  useEffect(() => {
    if (progress >= 100) {
      setTimeout(() => {
        alert(t("translate.translation_completed"));
      }, 500);
    }
  }, [progress]);
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
    async function translateChunk(block: any[], retryTimes = 0) {
      if (block.length === 0) return;
      if (block.every((line) => line.data.translatedText)) return;
      // delay
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));

      let text = block.map((line) => line.data.text);
      let res;
      try {
        res = await translateSubtitleChunk(text);
        let { result: translatedText } = JSON.parse(
          res.choices[0].message?.function_call?.arguments!
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
        // scroll to item
        let i = parsedSubtitle.findIndex((line) => line === block.at(-1));
        let item = document.querySelector(
          `#subtitle-preview .subtitle-preview__item:nth-child(${i + 1})`
        );
        if (item) {
          item.scrollIntoView({ behavior: "smooth", block: "start" });
        }
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
        //@ts-ignore
        let msg = e?.response?.data?.error?.message;

        if (msg.startsWith("You didn't provide an API key.")) {
          throw new Error("No API key");
        }
        if (msg.startsWith("You have exceeded your")) {
          throw new Error("Exceeded");
        }
      }
    }
    setIsTranslating(true);
    try {
      await asyncPoolAll(keys.length * 1.5, chunks, (x: any) =>
        translateChunk(x, 0)
      );
    } catch (e) {
      console.log(e);
      //@ts-ignore
      if (e.toString() === "Error: No API key") {
        setIsTranslating(false);
        alert(t("translate.no_api_key"));
        location.reload();
      }
      //@ts-ignore
      if (e.toString() === "Error: Exceeded") {
        setIsTranslating(false);
        alert(t("translate.exceeded"));
        location.reload();
      }
    }
    if (parsedSubtitle.filter((line) => !line.data.translatedText).length > 0) {
      if (retryTimes < 3) {
        await startTranslation(retryTimes + 1);
      } else {
        for (let cue of parsedSubtitle.filter(
          (line) => !line.data.translatedText
        )) {
          await translateSingle(cue);
        }
      }
    }
    setIsTranslating(false);
  }
  async function translateSingle(line: any) {
    try {
      let res = await translateSubtitleSingle(line.data.text);
      let translatedText;
      try {
        translatedText = JSON.parse(
          res.choices[0].message?.function_call?.arguments!
        ).result;
      } catch (e) {
        translatedText =
          res.choices[0].message?.function_call?.arguments ||
          res.choices[0].message?.content;
      }
      line.data.translatedText = translatedText;
      setProgress(
        (progress) =>
          (parsedSubtitle
            .map((line) => line.data.translatedText)
            .filter((x) => x).length /
            parsedSubtitle.length) *
          100
      );
    } catch (e) {
      toast.error(t("translate.failed_to_translate", { text: line.data.text }));
      console.error(e);
    }
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
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        className="backdrop-blur-md bg-slate-100 bg-opacity-80 fixed w-[51px] h-full top-0 left-0 flex flex-col"
      >
        <SubtitleFilterItem
          subtitleFilter={subtitleFilter}
          setSubtitleFilter={setSubtitleFilter}
          value="all"
        />
        <SubtitleFilterItem
          subtitleFilter={subtitleFilter}
          setSubtitleFilter={setSubtitleFilter}
          value="not_translated"
        />
        <SubtitleFilterItem
          subtitleFilter={subtitleFilter}
          setSubtitleFilter={setSubtitleFilter}
          value="translated"
        />
        <div className="flex-1" />
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          <span className="opacity-50 text-xs">{t(`translate.tokens`)}</span>
          <br />
          {usedOutputTokens.toLocaleString()}
          <br />
          <span className="opacity-50 text-xs">{t(`translate.output`)}</span>
        </div>
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          <span className="opacity-50 text-xs">{t(`translate.tokens`)}</span>
          <br />
          {usedInputTokens.toLocaleString()}
          <br />
          <span className="opacity-50 text-xs">{t(`translate.input`)}</span>
        </div>
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          {usedDollars.toFixed(2)}
          <br />
          <span className="opacity-50 text-xs">{t(`translate.USD`)}</span>
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
        <div
          className="flex-1 overflow-y-scroll h-full flex flex-col gap-1 p-1 group"
          id="subtitle-preview"
        >
          {parsedSubtitle
            .map((x, i) => ({ index: i, ...x }))
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
            .map((x) => (
              <SubtitlePreview
                subtitle={x}
                index={x.index}
                parsedSubtitle={parsedSubtitle}
                setParsedSubtitle={setParsedSubtitle}
                translateSingle={translateSingle}
                key={x.index}
              />
            ))}
          <div
            className={`${
              !isTranslating && progress >= 100 ? `mt-[160px]` : `mt-16`
            } w-full`}
          />
        </div>
        <div
          className={`${
            !isTranslating && progress >= 100 ? `h-[200px]` : `h-16`
          } w-[calc(100%-52px)] ml-[52px] absolute bottom-0 left-0 bg-opacity-40 backdrop-blur-xl bg-white select-none pointer-events-none`}
          style={{
            WebkitMask:
              !isTranslating && progress >= 100
                ? `linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,1) 45%)`
                : `linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,1) 70%)`,
          }}
        ></div>
        <div className="absolute bottom-0 left-0 w-[calc(100%-52px)] ml-[52px]">
          <div className="flex items-center gap-2 px-2 py-1 w-full">
            {!isTranslating && progress <= 0 && (
              <>
                <Button onClick={() => previousStep()} className="shadow">
                  {t(`translate.back`)}
                </Button>
              </>
            )}
            {isTranslating ? (
              <div className="flex-1 w-full h-2">
                <div className="h-full bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-500"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            ) : (
              <div className="flex-1" />
            )}
            {!isTranslating && progress < 100 && (
              <Button
                onClick={() => startTranslation()}
                variant="primary"
                icon="bx-play"
                className="shadow"
              >
                {t(`translate.start`)}
              </Button>
            )}
            {!isTranslating && progress >= 100 && (
              <Button
                onClick={() => location.reload()}
                icon="bx-refresh"
                className="shadow"
              >
                {t(`translate.reset`)}
              </Button>
            )}
            {!isTranslating && progress >= 90 && (
              <Button
                onClick={() => downloadSubtitle()}
                variant={progress >= 100 ? `primary` : ``}
                icon="bx-save"
                className="shadow"
              >
                {t(`translate.save`)}
              </Button>
            )}
          </div>
          {!isTranslating && progress >= 100 && <BuyMeACoffee />}
        </div>
      </div>
    </>
  );
}
