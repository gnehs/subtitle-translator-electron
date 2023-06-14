import Button from "../Button";

import useStep from "@/hooks/useStep";
export default function File() {
  const [step, nextStep] = useStep();
  if (step !== 2) return null;
  return (
    <>
      <div className="flex flex-col gap-2 h-full w-full">
        <div className="flex flex-row h-full">File</div>
        <Button onClick={() => nextStep()}>Next</Button>
      </div>
    </>
  );
}
