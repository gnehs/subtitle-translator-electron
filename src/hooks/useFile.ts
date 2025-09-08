import { useSelector, useDispatch } from "react-redux";
import { setFiles } from "@/store/file";
import { useState, useEffect } from "react";
export default function useFile() {
  // Get
  //@ts-ignore
  const files = useSelector((state) => state.file.value);

  // Set
  const dispatch = useDispatch();
  const _setFiles = (files: { path: string; name: string }[]) =>
    dispatch(setFiles(files));

  // Return
  return [files, _setFiles];
}
