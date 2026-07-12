import { useOutletContext } from "react-router-dom";
import TranslatorPanel from "@/components/TranslatorPanel";

export type TranslatorOutletContext = {
  addTaskRequest: number;
};

export default function Translator() {
  const { addTaskRequest } = useOutletContext<TranslatorOutletContext>();

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <TranslatorPanel addTaskRequest={addTaskRequest} />
    </div>
  );
}
