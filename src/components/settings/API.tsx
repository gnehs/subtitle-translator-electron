import Title from "../Title";
import Button from "../Button";
import InputField from "../InputField";
import { useTranslation } from "react-i18next";
import { useAPIHost, useAPIKeys } from "@/hooks/useOpenAI";
export default function API() {
  const { t } = useTranslation();
  const [keys, setKeys] = useAPIKeys();
  const [host, setHost] = useAPIHost();
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
          key={i}
        >
          {keys.length > 1 && (
            <Button onClick={() => removeKey(i)} icon="bx-x"></Button>
          )}
        </InputField>
      ))}
      <Button onClick={() => addKey()} icon="bx-plus"></Button>
      <div
        className="text-sm opacity-80 text-inject"
        dangerouslySetInnerHTML={{ __html: t("api.key.description")! }}
      />
      <div
        className="text-sm opacity-80 text-inject"
        dangerouslySetInnerHTML={{ __html: t("api.key.notify")! }}
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
