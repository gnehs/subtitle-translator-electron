import Button from "../Button";
import useStep from "../../hooks/useStep";
export default function File() {
  const [step, nextStep] = useStep();
  if (step !== 3) return null;
  return (
    <>
      <div className="flex flex-col gap-2 h-full">
        <div className="flex flex-row h-full">Preview</div>
        <Button onClick={() => nextStep()}>Next</Button>
      </div>
    </>
  );
}
