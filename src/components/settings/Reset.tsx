import Title from "../Title";
import Button from "../Button";
import { useTranslation } from "react-i18next";
export default function Reset() {
  const { t } = useTranslation();
  function resetAll() {
    if (confirm(t(`reset.prompt`)!)) {
      localStorage.clear();
      window.location.reload();
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Title>{t(`reset.title`)}</Title>
      <Button onClick={(e: any) => resetAll()} variant="danger">
        {t(`reset.name`)}
      </Button>
    </div>
  );
}
