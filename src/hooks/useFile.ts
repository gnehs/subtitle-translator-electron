import { useSelector, useDispatch } from "react-redux";
import { setFile } from "@/store/file";
import { useState, useEffect } from "react";
export default function useStep() {
  // Get
  //@ts-ignore
  const fileInfo = useSelector((state) => state.file.value);
  const [file, setFileState] = useState(null);
  useEffect(() => {
    if (fileInfo) {
      fetch(fileInfo.url)
        .then((r) => r.blob())
        .then(
          (blobFile) =>
            new File([blobFile], fileInfo.name, { type: fileInfo.type })
        )
        .then((file) => {
          //@ts-ignore
          setFileState(file);
        });
    }
  }, [fileInfo]);

  // Set
  const dispatch = useDispatch();
  const _setFile = (file: File) => {
    let fileURL = URL.createObjectURL(file);
    dispatch(setFile({ url: fileURL, type: file.type, name: file.name }));
  };

  // Return
  return [file, _setFile!];
}
