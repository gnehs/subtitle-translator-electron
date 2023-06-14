import Header from "@/components/Header";
import File from "@/components/translator/File";
import Lang from "@/components/translator/Lang";
import Preview from "@/components/translator/Preview";

import useStep from "@/hooks/useStep";
export default function Translator() {
  return (
    <div className="flex flex-col h-full">
      <Header>Subtitle Translator</Header>
      <div className="flex flex-row h-full items-center justify-center">
        <File />
        <Lang />
        <Preview />
      </div>
    </div>
  );
}
