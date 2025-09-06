import Title from "../Title";
import Button from "../Button";
import InputField from "../InputField";
import { useTranslation } from "react-i18next";
import { useAPIHost, useAPIKeys, useAPIHeaders } from "@/hooks/useOpenAI";
import { useMemo, useState, useEffect } from "react";
export default function API() {
  const { t } = useTranslation();
  const [keys, setKeys] = useAPIKeys();
  const [host, setHost] = useAPIHost();
  const [headers, setHeaders] = useAPIHeaders();
  const noKey = useMemo(() => keys.every((k) => !k), [keys]);
  const [provider, setProvider] = useState<
    "openrouter" | "openai" | "vercel-gateway" | "openai-compatible"
  >("openrouter");
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
  function setHeaderName(i: number, value: string) {
    const newHeaders = structuredClone(headers || []);
    newHeaders[i] = {
      ...(newHeaders[i] || { name: "", value: "" }),
      name: value,
    };
    setHeaders(newHeaders);
  }
  function setHeaderValue(i: number, value: string) {
    const newHeaders = structuredClone(headers || []);
    newHeaders[i] = { ...(newHeaders[i] || { name: "", value: "" }), value };
    setHeaders(newHeaders);
  }
  function addHeader() {
    const newHeaders = structuredClone(headers || []);
    newHeaders.push({ name: "", value: "" });
    setHeaders(newHeaders);
  }
  function removeHeader(i: number) {
    const newHeaders = structuredClone(headers || []);
    newHeaders.splice(i, 1);
    setHeaders(newHeaders);
  }
  function preset(hostUrl: string, keyLabel: string) {
    setHost(hostUrl);
    if (noKey && keys.length === 1 && !keys[0]) {
      // Hint label via placeholder behavior is handled by UI text below
    }
  }
  useEffect(() => {
    switch (provider) {
      case "openrouter":
        preset("https://openrouter.ai/api/v1", "OpenRouter API Key");
        break;
      case "openai":
        preset("https://api.openai.com/v1", "OpenAI API Key");
        break;
      case "vercel-gateway":
        preset("https://ai-gateway.vercel.sh/v1", "AI Gateway Key");
        break;
      case "openai-compatible":
        // do not change host; allow user to edit
        break;
    }
  }, [provider]);
  return (
    <div className="flex flex-col gap-2">
      <Title>{t("api.title")}</Title>
      {noKey && (
        <div className="p-2 rounded bg-yellow-100 text-yellow-900 text-sm">
          {t("api.presets.recommendation")}
        </div>
      )}
      <Title>{t("api.presets.title")}</Title>
      <div>
        <select
          className="p-2 rounded border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
          value={provider}
          onChange={(e) => setProvider(e.target.value as any)}
        >
          <option value="openrouter">{t("api.presets.openrouter")}</option>
          <option value="openai">{t("api.presets.openai")}</option>
          <option value="vercel-gateway">
            {t("api.presets.vercel_gateway")}
          </option>
          <option value="openai-compatible">
            {t("api.presets.openai_compatible")}
          </option>
        </select>
      </div>
      <InputField
        label={t("api.key.name")}
        type="password"
        value={keys[0] || ""}
        onChange={(e: any) => setKey(0, e.target.value)}
      />
      <div
        className="text-sm opacity-80 text-inject"
        dangerouslySetInnerHTML={{ __html: t("api.key.description")! }}
      />
      <div
        className="text-sm opacity-80 text-inject break-all"
        dangerouslySetInnerHTML={{ __html: t("api.key.notify")! }}
      />
      {provider === "openai-compatible" && (
        <InputField
          label={t("api.host.name")}
          description={t("api.host.description")!}
          value={host}
          onChange={(e: any) => setHost(e.target.value)}
        />
      )}
      <Title>{t("api.headers.title")}</Title>
      {(headers || []).map((h, i) => (
        <div className="flex gap-2" key={i}>
          <InputField
            label={i === 0 ? t("api.headers.name") : ""}
            value={h?.name || ""}
            onChange={(e: any) => setHeaderName(i, e.target.value)}
          />
          <InputField
            label={i === 0 ? t("api.headers.value") : ""}
            value={h?.value || ""}
            onChange={(e: any) => setHeaderValue(i, e.target.value)}
          >
            <Button onClick={() => removeHeader(i)} icon="bx-x"></Button>
          </InputField>
        </div>
      ))}
      <Button onClick={() => addHeader()} icon="bx-plus"></Button>
    </div>
  );
}
