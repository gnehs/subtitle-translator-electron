import { useEffect, useState } from "react";
export const useVersion = () => {
  const [version, setVersion] = useState<string>(
    //@ts-ignore
    process.env.npm_package_version
  );
  return version;
};
