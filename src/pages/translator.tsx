import Header from "@/components/Header";
import TranslatorPanel from "@/components/TranslatorPanel";
export default function Translator() {
  return (
    <div className="flex flex-col h-full">
      <Header>Subtitle Translator</Header>
      <div className="flex flex-row h-full items-center justify-center overflow-y-scroll">
        <TranslatorPanel />
      </div>
    </div>
  );
}
