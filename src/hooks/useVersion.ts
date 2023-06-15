import { useState } from "react";
export const useVersion = () => {
  const [version, setVersion] = useState<string>("1.0.1");
  return version;
};
