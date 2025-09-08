import { useTranslation } from "react-i18next";
import Title from "./Title";

export default function TranslatorContainer({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2 items-center justify-center w-full mx-auto bg-slate-50">
      <div className="p-2 bg-slate-200 w-full">
        <Title>{title}</Title>
      </div>
      <div className="w-full px-2 flex flex-col gap-2">{children}</div>
    </div>
  );
}
