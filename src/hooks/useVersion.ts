import { useState } from "react";
export const useVersion = () => {
  const [version, setVersion] = useState<string>("0.0.0");
  return version;
};
