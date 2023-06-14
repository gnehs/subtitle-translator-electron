import Title from "../Title";
import Button from "../Button";
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
  return (
    <div className="flex flex-col gap-2">
      <Title>{t("api.title")}</Title>
      {keys.map((key, i) => (
        <InputField
          label={i === 0 ? t("api.key.name") : ``}
          type="password"
          value={keys[i]}
          onChange={(e: any) => setKey(i, e.target.value)}
        >
          {keys.length > 1 && (
            <Button onClick={() => removeKey(i)} icon="bx-x"></Button>
          )}
        </InputField>
      ))}
      <Button onClick={() => addKey()} icon="bx-plus"></Button>
      <div
        className="text-sm opacity-80 text-inject"
        dangerouslySetInnerHTML={{ __html: t("api.key.description") }}
      />
      <InputField
        label={t("api.host.name")}
        description={t("api.host.description")!}
        value={host}
        onChange={(e: any) => setHost(e.target.value)}
      />
    </div>
  );
}
