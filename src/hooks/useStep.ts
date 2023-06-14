import { useSelector, useDispatch } from "react-redux";
import { nextStep, previousStep } from "@/store/step";
export default function useStep() {
  //@ts-ignore
  const step = useSelector((state) => state.step.value);
  const dispatch = useDispatch();
  const _nextStep = () => dispatch(nextStep());
  const _previousStep = () => dispatch(previousStep());
  return [step, _nextStep, _previousStep];
}
