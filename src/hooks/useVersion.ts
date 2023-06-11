import { readFile } from "node:fs/promises";
import { cwd } from "node:process";
import { join } from "node:path";
import { useEffect, useState } from "react";
export const useVersion = () => {
  const [version, setVersion] = useState<string>("0.0.0");
  useEffect(() => {
    readFile(join(cwd(), "./package.json"), { encoding: "utf-8" }).then((x) => {
      const { version } = JSON.parse(x);
      setVersion(version);
    });
  }, []);
  return version;
};
