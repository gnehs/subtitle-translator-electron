import icon from "@/assets/icon.png";
import BuyMeACoffee from "@/components/BuyMeACoffee";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useCommitSha, useVersion } from "@/hooks/useVersion";
import { useTranslation } from "@/i18n";
import { Bug, GitFork } from "lucide-react";

const repositoryUrl = "https://github.com/gnehs/subtitle-translator-electron";

export default function About() {
  const { t } = useTranslation();
  const version = useVersion();
  const commitSha = useCommitSha();
  const commitUrl = `${repositoryUrl}/commit/${commitSha}`;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/30">
      <header className="shrink-0 border-b bg-background/95 px-6 py-4 backdrop-blur">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {t("about.title")}
        </h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
          <Card>
            <CardHeader className="flex flex-row items-center gap-4">
              <img
                src={icon}
                alt="Subtitle Translator"
                className="size-24 shrink-0 drop-shadow-lg"
              />
              <CardTitle>
                <h2>Subtitle Translator</h2>
              </CardTitle>
            </CardHeader>

            <Separator />

            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">
                  {t("about.version")}
                </dt>
                <dd className="font-mono">{version}</dd>
                <dt className="text-muted-foreground">
                  {t("about.commit_sha")}
                </dt>
                <dd className="min-w-0 truncate font-mono">
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
            </CardContent>

            <CardFooter className="flex flex-wrap gap-2">
              <Button asChild>
                <a href={repositoryUrl} target="_blank" rel="noreferrer">
                  <GitFork data-icon="inline-start" aria-hidden="true" />
                  GitHub
                </a>
              </Button>
              <Button asChild variant="outline">
                <a
                  href={`${repositoryUrl}/issues`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Bug data-icon="inline-start" aria-hidden="true" />
                  {t("about.report_issue")}
                </a>
              </Button>
            </CardFooter>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>
                <h2>{t("about.author")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <img
                src="https://avatars.githubusercontent.com/u/16719720?v=4"
                alt="gnehs"
                className="size-14 shrink-0 rounded-full drop-shadow-lg"
              />
              <p className="font-medium">gnehs</p>
            </CardContent>
          </Card>

          <BuyMeACoffee className="m-0" />
        </div>
      </main>
    </div>
  );
}
