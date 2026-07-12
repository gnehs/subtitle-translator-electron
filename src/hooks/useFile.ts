import { useDispatch, useSelector } from "react-redux";
import { setFiles } from "@/store/file";
import type { AppDispatch, RootState } from "@/store";
import type { SubtitleFile } from "@/types/electron-api";

export default function useFile(): [
  SubtitleFile[],
  (files: SubtitleFile[]) => void,
] {
  const files = useSelector((state: RootState) => state.file.value);
  const dispatch = useDispatch<AppDispatch>();

  return [files, (nextFiles) => dispatch(setFiles(nextFiles))];
}
