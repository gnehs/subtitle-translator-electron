import Button from "../Button";
import { useState, useEffect } from "react";
import useStep from "../../hooks/useStep";
import useFile from "@/hooks/useFile";
import fs from "node:fs";
import { Configuration, OpenAIApi } from "openai";
import { parseSync, stringifySync } from "subtitle";
//@ts-ignore
import assParser from "ass-parser";
//@ts-ignore
import assStringify from "ass-stringify";
function SubtitlePreview({ cue, index }: { cue: any; index: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-sm min-w-[3em] text-right">{index}</div>
      <div>{cue.data.text}</div>
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
  });
  if (step !== 3) return null;
  return (
    <div className="flex flex-col gap-2 w-full h-full">
      <div className="flex-1 bg-blue-100 overflow-y-scroll h-full">
        {parsedSubtitle.map((x, i) => (
          <SubtitlePreview cue={x} index={i} />
        ))}
      </div>
      <div className="flex items-center gap-2 p-2">
        <Button onClick={() => previousStep()}>previousStep</Button>
        <Button onClick={() => nextStep()}>Next</Button>
      </div>
    </div>
  );
}
