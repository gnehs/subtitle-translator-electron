import Button from "../Button";
import { useState, useEffect } from "react";
import useStep from "../../hooks/useStep";
import useFile from "@/hooks/useFile";
import fs from "node:fs";
import { motion } from "framer-motion";
import { createChatCompletion } from "@/hooks/useOpenAI";
import { parseSync, stringifySync } from "subtitle";
//@ts-ignore
import assParser from "ass-parser";
//@ts-ignore
import assStringify from "ass-stringify";
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

  const [file] = useFile();
  const [parsedSubtitle, setParsedSubtitle] = useState<any[]>([]);
  const [assTemp, setAssTemp] = useState<any[]>([]);
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
          10:25
          <br />
          <span className="opacity-50 text-xs">left</span>
        </div>
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          <span className="opacity-50 text-xs">tokens</span>
          <br />
          100.00
          <br />
          <span className="opacity-50 text-xs">output</span>
        </div>
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          <span className="opacity-50 text-xs">tokens</span>
          <br />
          100.00
          <br />
          <span className="opacity-50 text-xs">input</span>
        </div>
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          100.00
          <br />
          <span className="opacity-50 text-xs">USD</span>
        </div>
        <div className="text-center m-0.5 text-sm bg-slate-200 p-0.5 rounded-sm">
          100
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
            />
          ))}
        </div>
        <div className="flex items-center gap-2 p-2">
          <Button onClick={() => previousStep()}>previousStep</Button>
          <Button onClick={() => nextStep()}>Next</Button>
        </div>
      </div>
    </>
  );
}
