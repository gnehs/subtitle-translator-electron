import Header from "@/components/Header";
import Button from "@/components/Button";
import { useCommitSha, useVersion } from "@/hooks/useVersion";
import { useTranslation } from "@/i18n";
import icon from "@/assets/icon.png";
import BuyMeACoffee from "@/components/BuyMeACoffee";
import { Separator } from "@/components/ui/separator";
import { Bug, GitFork } from "lucide-react";

const repositoryUrl = "https://github.com/gnehs/subtitle-translator-electron";

export default function About() {
  const { t } = useTranslation();
  const version = useVersion();
  const commitSha = useCommitSha();
  const commitUrl = `${repositoryUrl}/commit/${commitSha}`;

  return (
    <div className="h-full flex flex-col">
      <Header>{t("about.title")}</Header>
      <div className="p-2 flex flex-col gap-4 items-center">
        <div className="p-2 flex flex-wrap gap-4 w-full max-w-[450px] mt-4">
          <img
            src={icon}
            alt="Subtitle Translator"
            className="size-32 mx-auto drop-shadow-lg"
          />
          <div className="flex-1 min-w-52">
            <h1 className="text-3xl font-bold">Subtitle Translator</h1>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t("about.version")}</dt>
              <dd className="font-mono">{version}</dd>
              <dt className="text-muted-foreground">{t("about.commit_sha")}</dt>
              <dd className="font-mono">
                {commitSha === "unknown" ? (
                  commitSha
                ) : (
                  <a
                    href={commitUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-primary"
                  >
                    {commitSha}
                  </a>
                )}
              </dd>
            </dl>
            <div className="flex flex-wrap gap-2 items-center justify-start mt-4">
              <Button
                href={repositoryUrl}
                target="_blank"
                icon={GitFork}
              >
                GitHub
              </Button>
              <Button
                href="https://github.com/gnehs/subtitle-translator-electron/issues"
                target="_blank"
                icon={Bug}
              >
                {t("about.report_issue")}
              </Button>
            </div>
          </div>
        </div>
        <Separator className="w-full" />
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-bold text-center">{t("about.author")}</h1>
          <img
            src="https://avatars.githubusercontent.com/u/16719720?v=4"
            className="w-16 h-16 mx-auto drop-shadow-lg mt-4 rounded-full"
          />
          <h1 className="text-center">gnehs</h1>
        </div>
      </div>
      <div className="flex-1"></div>
      <BuyMeACoffee />
    </div>
  );
}
