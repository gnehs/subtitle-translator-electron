import { useSelector, useDispatch } from "react-redux";
import { setFile } from "@/store/file";
export default function useStep() {
  //@ts-ignore
  const file = useSelector((state) => state.file.value);
  const dispatch = useDispatch();
  const _setFile = (file: any) => dispatch(setFile(file));
  return [file, _setFile];
}
