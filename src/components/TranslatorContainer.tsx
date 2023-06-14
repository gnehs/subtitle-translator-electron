import Button from "./Button";
import { useTranslation } from "react-i18next";
import useStep from "../hooks/useStep";
import Title from "./Title";
export default function TranslatorContainer({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  const { t } = useTranslation();
  const [step, nextStep, previousStep] = useStep();
  return (
    <form
      className="flex flex-col gap-2 items-center justify-center w-full max-w-[368px] mx-auto bg-slate-50 border border-slate-200 rounded"
      onSubmit={(e) => {
        e.preventDefault();
        nextStep();
      }}
    >
      <div className="p-2 bg-slate-200 w-full rounded-t">
        <Title>{title}</Title>
      </div>
      <div className="w-full px-2 flex flex-col gap-2">{children}</div>
      <div className="p-2 w-full flex gap-2">
        {step == 2 && (
          <Button className="w-full shadow" onClick={() => previousStep()}>
            Previous
          </Button>
        )}
        <Button submit className="w-full shadow">
          Next
        </Button>
      </div>
    </form>
  );
}
