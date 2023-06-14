import { useSelector, useDispatch } from "react-redux";
import { setFile } from "@/store/file";
import { useState, useEffect } from "react";
export default function useStep() {
  // Get
  //@ts-ignore
  const file = useSelector((state) => state.file.value);

  // Set
  const dispatch = useDispatch();
  const _setFile = (file: File) =>
    dispatch(setFile({ path: file.path, name: file.name }));

  // Return
  return [file, _setFile];
}
