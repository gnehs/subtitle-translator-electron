import Language from "@/components/settings/Language";
import Model from "@/components/settings/Model";
import API from "@/components/settings/API";
import Save from "@/components/settings/Save";
import Prompt from "@/components/settings/Prompt";
import Reset from "@/components/settings/Reset";
import Delay from "@/components/settings/Delay";
export default function Settings() {
  return (
    <div className="h-[calc(100vh-48px)] overflow-y-auto">
      <div className="p-4 flex flex-col gap-2">
        <Language />
        <API />
        <Delay />
        <Save />
        <Model />
        <Prompt />
        <Reset />
      </div>
    </div>
  );
}
