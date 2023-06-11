import Title from "../Title";
import SubTitle from "../SubTitle";
import InputField from "../InputField";
import { useTranslation } from "react-i18next";
import { useLocalStorage } from "usehooks-ts";
export default function API() {
  const { t, i18n } = useTranslation();
  const [keys, setKeys] = useLocalStorage("api_keys", [""]);
  const [host, setHost] = useLocalStorage(
    "api_host",
    "https://api.openai.com/v1"
  );
  function setKey(index: number, value: string) {
    const newKeys = structuredClone(keys);
    //@ts-ignore
    newKeys[index] = value;
    setKeys(newKeys);
  }
  function addKey() {
    const newKeys = structuredClone(keys);
    newKeys.push("");
    setKeys(newKeys);
  }
  function removeKey(i: number) {
    const newKeys = structuredClone(keys);
    newKeys.splice(i, 1);
    setKeys(newKeys);
  }
  const model_list = [`gpt-4-0314`, `gpt-3.5-turbo`, `gpt-3.5-turbo-economy`];
  return (
    <div className="flex flex-col gap-2">
      <Title>{t("api.title")}</Title>
      {keys.map((key, i) => (
        <InputField
          label={i === 0 ? t("api.key.name") : ``}
          value={keys[i]}
          onChange={(e: any) => setKey(i, e.target.value)}
        >
          {keys.length > 1 && (
            <button
              className={`p-2 rounded cursor-pointer bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-xl flex items-center justify-center`}
              onClick={() => removeKey(i)}
            >
              <i className="bx bx-x"></i>
            </button>
          )}
        </InputField>
      ))}
      <button
        className={`p-2 rounded cursor-pointer bg-slate-100 hover:bg-slate-200 active:bg-slate-300  text-xl flex items-center justify-center`}
        onClick={() => addKey()}
      >
        <i className="bx bx-plus"></i>
      </button>{" "}
      <div className="text-sm opacity-80">{t("api.key.description")}</div>
      <InputField
        label={t("api.host.name")}
        description={t("api.host.description")!}
        value={host}
        onChange={(e: any) => setHost(e.target.value)}
      />
    </div>
  );
}
